//! Unit tests for the local-session module. Grouped here so the
//! production modules (`mod`, `bytes`, `resolution`, `spawn`) stay
//! focused on behaviour, not on fixture scaffolding.

use std::io::Read;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Barrier, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::infrastructure::app_backend::AppBackend;

use super::bytes::{drain_should_break, utf8_safe_prefix_len};
use super::spawn::{spawn_output_forwarder, DRAIN_INTERVAL, DRAIN_SIZE_BYTES};

// -------------------------------------------------------------------------
// drain_should_break helpers
// -------------------------------------------------------------------------

#[test]
fn drain_should_break_returns_false_on_empty_burst() {
    assert!(!drain_should_break(
        0,
        Duration::ZERO,
        DRAIN_SIZE_BYTES,
        DRAIN_INTERVAL,
    ));
}

#[test]
fn drain_should_break_on_size_budget() {
    assert!(drain_should_break(
        DRAIN_SIZE_BYTES,
        Duration::ZERO,
        DRAIN_SIZE_BYTES,
        DRAIN_INTERVAL,
    ));
    assert!(drain_should_break(
        DRAIN_SIZE_BYTES + 1,
        Duration::ZERO,
        DRAIN_SIZE_BYTES,
        DRAIN_INTERVAL,
    ));
}

#[test]
fn drain_should_break_on_time_budget() {
    assert!(drain_should_break(
        1024,
        DRAIN_INTERVAL,
        DRAIN_SIZE_BYTES,
        DRAIN_INTERVAL,
    ));
    assert!(!drain_should_break(
        1024,
        DRAIN_INTERVAL - Duration::from_micros(1),
        DRAIN_SIZE_BYTES,
        DRAIN_INTERVAL,
    ));
}

#[test]
fn drain_should_break_on_time_budget_regardless_of_byte_count() {
    assert!(drain_should_break(
        0,
        DRAIN_INTERVAL,
        DRAIN_SIZE_BYTES,
        DRAIN_INTERVAL,
    ));
}

// -------------------------------------------------------------------------
// utf8_safe_prefix_len helpers
// -------------------------------------------------------------------------

#[test]
fn utf8_safe_prefix_len_for_ascii_returns_full_length() {
    assert_eq!(utf8_safe_prefix_len(b"hello world"), 11);
}

#[test]
fn utf8_safe_prefix_len_for_2byte_codepoint_returns_full_length() {
    assert_eq!(utf8_safe_prefix_len(&[0xC3, 0xA9]), 2);
    assert_eq!(utf8_safe_prefix_len(b"a\xC3\xA9b"), 4);
}

#[test]
fn utf8_safe_prefix_len_for_3byte_codepoint_returns_full_length() {
    assert_eq!(utf8_safe_prefix_len(b"a\xE4\xB8\xAD"), 4);
}

#[test]
fn utf8_safe_prefix_len_for_4byte_codepoint_returns_full_length() {
    assert_eq!(utf8_safe_prefix_len(b"a\xF0\x9F\x98\x80"), 5);
}

#[test]
fn utf8_safe_prefix_len_trims_incomplete_trailing_codepoint() {
    assert_eq!(utf8_safe_prefix_len(&[0xC3]), 0);
    assert_eq!(utf8_safe_prefix_len(&[0xE4, 0xB8]), 0);
    assert_eq!(utf8_safe_prefix_len(&[0xF0, 0x9F, 0x98]), 0);
}

#[test]
fn utf8_safe_prefix_len_preserves_complete_prefix_then_trims() {
    assert_eq!(utf8_safe_prefix_len(b"ab\xC3"), 2);
}

#[test]
fn utf8_safe_prefix_len_trims_at_stray_leading_byte_after_complete_codepoint() {
    assert_eq!(utf8_safe_prefix_len(&[0x61, 0x62, 0xC3]), 2);
}

#[test]
fn utf8_safe_prefix_len_returns_zero_for_empty_input() {
    assert_eq!(utf8_safe_prefix_len(&[]), 0);
}

#[test]
fn utf8_safe_prefix_len_returns_zero_for_all_continuation_bytes() {
    assert_eq!(utf8_safe_prefix_len(&[0x80, 0x80, 0x80]), 0);
}

// -------------------------------------------------------------------------
// spawn_output_forwarder tests
// -------------------------------------------------------------------------

/// A minimal AppBackend for unit tests — records emits via Arc+Mutex+Condvar.
#[derive(Clone)]
struct RecordingBackend {
    events: Arc<(Mutex<Vec<(String, serde_json::Value)>>, Condvar)>,
}

impl RecordingBackend {
    fn new() -> Self {
        Self {
            events: Arc::new((Mutex::new(Vec::new()), Condvar::new())),
        }
    }

    /// Block until at least one emit has been recorded, then return all.
    fn wait_for_emits(&self, timeout: Duration) -> Vec<(String, serde_json::Value)> {
        let (lock, cvar) = &*self.events;
        let mut events = lock.lock().unwrap();
        while events.is_empty() {
            let (guard, wait_result) = cvar.wait_timeout(events, timeout).unwrap();
            events = guard;
            if wait_result.timed_out() {
                return Vec::new();
            }
        }
        events.clone()
    }
}

impl AppBackend for RecordingBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        let (lock, cvar) = &*self.events;
        lock.lock()
            .unwrap()
            .push((event.to_string(), payload.clone()));
        cvar.notify_one();
        Ok(())
    }

    fn emit_binary(&self, _bytes: Vec<u8>) -> Result<(), String> {
        Ok(())
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        // Matches RealAppBackend: runs on a real background thread.
        std::thread::spawn(f);
    }
}

/// A mock `Read` that returns `Ok(1)` on the first call, waits on
/// `barrier`, then blocks forever on the second call.
///
/// The barrier ensures the reader sends the first byte *before* the drain
/// loop enters `recv_timeout`, eliminating the race where the 8 ms timeout
/// fires before any data has been sent (causing an empty burst and no emit).
struct SlowReader {
    first_call: AtomicBool,
    barrier: Arc<Barrier>,
}

impl SlowReader {
    fn new(barrier: Arc<Barrier>) -> Self {
        Self {
            first_call: AtomicBool::new(true),
            barrier,
        }
    }
}

impl Read for SlowReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self
            .first_call
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            buf[0] = b'a';
            Ok(1)
        } else {
            // Wait for the main drain loop to be inside recv_timeout before
            // blocking. This ensures the timer fires *after* we have already
            // sent the data, so the drain loop definitely has something to
            // emit. See the test comment for the full synchronization plan.
            self.barrier.wait();
            // Now block indefinitely (simulating a 1-second pause between
            // keystrokes). Duration::MAX is interruptible and won't panic
            // on Drop, unlike a true syscall blocking read.
            std::thread::sleep(Duration::MAX);
            Ok(0)
        }
    }
}

#[test]
fn forwarder_flushes_first_char_before_second_arrives() {
    // Regression test for the blocking-read bug:
    //
    //   Bug: reader.read() blocked indefinitely in the inner drain loop,
    //   so the 8 ms time check never fired until the 2nd byte arrived.
    //   User types 'a' → nothing shown. Types 'b' → 'ab' shown.
    //
    //   Fix: reader runs on a dedicated thread; the drain loop uses
    //   recv_timeout(DRAIN_INTERVAL) which fires regardless of input.
    //
    // Synchronization plan (using a Barrier):
    //
    //   Reader thread                 Main drain loop (in forwarder thread)
    //   ---------------               ------------------------------------
    //   read() returns Ok(1)          channel created + recv_timeout started
    //   send(chunk) → channel         recv_timeout running
    //   barrier.wait() ──────┐        ┌─ barrier.wait()
    //                        │        │
    //   (both threads here before proceeding)
    //
    //   After barrier:                After barrier:
    //   read() blocks forever         recv_timeout already received chunk
    //                                 drain fires (1 byte ≥ time budget)
    //                                 emit "a"
    //
    // The barrier guarantees the chunk is already in the channel before
    // recv_timeout starts, so the drain loop has data to emit.
    //
    // Test: SlowReader+Barrier returns 'a' on first call, waits on barrier,
    // then blocks. Assert the forwarder emits 'a' within DRAIN_INTERVAL + 50ms.

    // 2-party barrier: reader thread + forwarder main loop.
    let barrier = Arc::new(Barrier::new(2));
    let barrier_clone = Arc::clone(&barrier);

    let backend = RecordingBackend::new();
    let reader = Box::new(SlowReader::new(barrier_clone));
    let session_id = 1;

    let start = Instant::now();
    spawn_output_forwarder(reader, Arc::new(backend.clone()), session_id);

    // The forwarder is now running on a real background thread (because
    // RecordingBackend::spawn uses std::thread::spawn). We can safely
    // return from this function and wait for the event.
    //
    // Wait for the emit. It must arrive within the drain interval plus
    // a modest scheduling margin (50 ms). The original blocking-read bug
    // would cause this to wait forever — the 2nd read never returns in
    // this test because SlowReader blocks indefinitely at the barrier.
    let deadline = DRAIN_INTERVAL + Duration::from_millis(50);
    let events = backend.wait_for_emits(deadline);

    let elapsed = start.elapsed();

    assert!(
        !events.is_empty(),
        "Expected at least one emit within {:?}, but nothing arrived after {:?}",
        deadline,
        elapsed,
    );

    let (event, payload) = &events[0];
    assert_eq!(
        event.as_str(),
        "session-output",
        "Expected session-output event, got {:?}",
        event
    );

    // Payload is [session_id, data] per the emit contract.
    let arr = payload.as_array().expect("payload must be a JSON array");
    assert_eq!(arr.len(), 2, "payload must be [session_id, data]");
    assert_eq!(arr[0].as_i64().unwrap() as u32, session_id);
    let data = arr[1].as_array().expect("data must be a byte array");
    assert_eq!(data.len(), 1, "expected exactly 1 byte in first emit");
    assert_eq!(
        data[0].as_i64().unwrap() as u8,
        b'a',
        "expected byte b'a', got {:?}",
        data[0]
    );

    // Must have fired within the drain interval — not waiting for the
    // second (indefinitely blocked) read.
    assert!(
        elapsed < Duration::from_millis(50),
        "Emit arrived in {:?} — drain timer did not fire in time",
        elapsed
    );
}
