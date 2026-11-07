//! Unit tests for the local-session module. Grouped here so the
//! production modules (`mod`, `bytes`, `resolution`, `spawn`) stay
//! focused on behaviour, not on fixture scaffolding.

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::infrastructure::app_backend::AppBackend;
use tokio::sync::mpsc::unbounded_channel;

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

#[test]
fn forwarder_emits_data_promptly() {
    let backend = RecordingBackend::new();
    let (tx, rx) = unbounded_channel::<Vec<u8>>();
    let session_id = 1;

    spawn_output_forwarder(rx, Arc::new(backend.clone()), session_id);

    tx.send(vec![b'a']).unwrap();

    let deadline = DRAIN_INTERVAL + Duration::from_millis(50);
    let events = backend.wait_for_emits(deadline);

    assert!(
        !events.is_empty(),
        "expected a session-output emit within {deadline:?}"
    );

    let (event, payload) = &events[0];
    assert_eq!(event.as_str(), "session-output");

    let arr = payload.as_array().expect("payload must be a JSON array");
    assert_eq!(arr.len(), 2, "payload must be [session_id, data]");
    assert_eq!(arr[0].as_i64().unwrap() as u32, session_id);
    let data = arr[1].as_array().expect("data must be a byte array");
    assert_eq!(data.len(), 1, "expected exactly 1 byte");
    assert_eq!(data[0].as_i64().unwrap() as u8, b'a');
}
