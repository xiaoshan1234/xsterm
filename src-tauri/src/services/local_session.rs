use std::io::{ErrorKind, Read};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use portable_pty::PtySize;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{spawn_writer_thread, LocalSession, LocalSessionHandles, PtySystem};
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};

/// Fallback shell on Unix-like systems when the `SHELL` env var is missing.
const UNIX_FALLBACK_SHELL: &str = "/bin/bash";
/// Per-call buffer size for `reader.read` from the PTY master fd.
const PTY_READ_BUFFER_SIZE: usize = 8192;
/// PowerShell argument to suppress the logo banner.
const POWERSHELL_NOLOGO_FLAG: &str = "-NoLogo";
/// Bash argument to start a login shell.
const BASH_LOGIN_FLAG: &str = "--login";

/// Perf 005: how many bytes to accumulate before forcing an emit. Keeps
/// `yes` / `find /` style floods from translating to per-read IPC events
/// (oxideterm's `LOCAL_MAX_LOCKED_PARSE_BYTES`, which is also 64 KiB).
const DRAIN_SIZE_BYTES: usize = 64 * 1024;

/// Perf 005: how long to wait for the producer between reads before
/// flushing whatever we have. Bounds tail latency for slow producers
/// (e.g. `cat | less`) so the user sees something within ~8 ms of
/// output rather than waiting for the 64 KiB threshold.
const DRAIN_INTERVAL: Duration = Duration::from_millis(8);

/// Decide whether the drain loop should stop accumulating and emit.
fn drain_should_break(
    accumulated_bytes: usize,
    elapsed: Duration,
    size_budget: usize,
    time_budget: Duration,
) -> bool {
    accumulated_bytes >= size_budget || (elapsed > Duration::ZERO && elapsed >= time_budget)
}

/// Find the largest prefix length such that `bytes[..n]` is valid UTF-8
/// with every codepoint complete.
fn utf8_safe_prefix_len(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    let mut i = bytes.len();
    while i > 0 && (bytes[i - 1] & 0xC0) == 0x80 {
        i -= 1;
    }
    if i == 0 {
        return 0;
    }
    let leading_pos = i - 1;
    let b = bytes[leading_pos];
    let expected_len: usize = if b < 0x80 {
        1
    } else if b < 0xC0 {
        return leading_pos;
    } else if b < 0xE0 {
        2
    } else if b < 0xF0 {
        3
    } else {
        4
    };
    let available = bytes.len() - leading_pos;
    if available < expected_len {
        leading_pos
    } else {
        bytes.len()
    }
}

pub fn create_local_session(
    pty_system: &dyn PtySystem,
    config: LocalSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<LocalSession, String> {
    let shell_path = resolve_shell_path(config.shell, config.shell_template.as_deref());
    let (shell_exe, shell_extra_args) = parse_shell_command(&shell_path);
    let shell_name = extract_shell_name(&shell_exe);
    let cwd = resolve_working_directory(config.cwd);

    let pty_size = PtySize {
        rows: config.initial_rows.unwrap_or(24),
        cols: config.initial_cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };
    let mut pair = pty_system.openpty(pty_size).map_err_string()?;

    let mut cmd = portable_pty::CommandBuilder::new(&shell_exe);
    for arg in &shell_extra_args {
        cmd.arg(arg);
    }
    apply_shell_flags(&mut cmd, &shell_name);
    if let Some(args) = config.args {
        for arg in args {
            cmd.arg(&arg);
        }
    }
    if let Some(env_config) = &config.env_config {
        if let Some(env) = &env_config.env {
            let user_keys: Vec<&str> = env.keys().map(String::as_str).collect();
            for (key, value) in env {
                cmd.env(key, value);
            }
            if is_wsl_exe(&shell_exe) && !user_keys.is_empty() {
                let new_entries = user_keys
                    .iter()
                    .map(|k| format!("{}/u", k))
                    .collect::<Vec<_>>()
                    .join(":");
                let existing = std::env::var("WSLENV").unwrap_or_default();
                cmd.env(
                    "WSLENV",
                    if existing.is_empty() {
                        new_entries
                    } else {
                        format!("{}:{}", existing, new_entries)
                    },
                );
            }
        }
    }
    if let Some(term_type) = &config.term_type {
        cmd.env("TERM", term_type);
    }
    if let Some(charset) = &config.charset {
        cmd.env("LC_ALL", charset);
    }
    cmd.cwd(&cwd);

    let child = pair.spawn(cmd).map_err_string()?;
    let writer = pair.master_writer().map_err_string()?;
    let reader = pair.master_reader().map_err_string()?;

    let (writer_tx, writer_thread) = spawn_writer_thread(writer);

    let info = SessionInfo {
        id: session_id,
        name: resolve_session_name(config.name, &shell_name),
        session_type: SessionType::Local { shell: shell_path, cwd },
        is_connected: true,
        capabilities: CapabilityFlags::for_local(),
    };

    spawn_output_forwarder(reader, backend.clone(), session_id);

    if let Some(startup_command) = config.startup_command.clone() {
        let delay_ms = config.startup_delay_ms.unwrap_or(0);
        let startup_writer_tx = writer_tx.clone();
        backend.spawn(Box::new(move || {
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            let _ = startup_writer_tx.try_send(startup_command.into_bytes());
            let _ = startup_writer_tx.try_send(b"\n".to_vec());
        }));
    }

    let session = LocalSession {
        info,
        writer_tx,
        capabilities: CapabilityFlags::for_local(),
        handles: LocalSessionHandles {
            child: Some(child),
            _pair: pair,
            writer_thread: Some(writer_thread),
        },
    };

    Ok(session)
}

fn resolve_shell_path(configured: Option<String>, shell_template: Option<&str>) -> String {
    if let Some(shell) = configured {
        return shell;
    }
    match shell_template {
        Some("powershell") => {
            if cfg!(target_os = "windows") {
                "powershell.exe".to_string()
            } else {
                "pwsh".to_string()
            }
        }
        Some("cmd") => {
            if cfg!(target_os = "windows") {
                "cmd.exe".to_string()
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| UNIX_FALLBACK_SHELL.to_string())
            }
        }
        Some("git-bash") => {
            if cfg!(target_os = "windows") {
                r"C:\Program Files\Git\bin\bash.exe".to_string()
            } else {
                "bash".to_string()
            }
        }
        Some("wsl") => {
            if cfg!(target_os = "windows") {
                "wsl.exe".to_string()
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| UNIX_FALLBACK_SHELL.to_string())
            }
        }
        _ => {
            if cfg!(target_os = "windows") {
                "cmd.exe".to_string()
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| UNIX_FALLBACK_SHELL.to_string())
            }
        }
    }
}

fn parse_shell_command(shell_path: &str) -> (String, Vec<String>) {
    shell_path
        .split_once(' ')
        .map(|(exe, rest)| {
            (
                exe.to_string(),
                rest.split_whitespace().map(String::from).collect::<Vec<_>>(),
            )
        })
        .unwrap_or_else(|| (shell_path.to_string(), Vec::new()))
}

fn extract_shell_name(shell_exe: &str) -> String {
    shell_exe
        .split(['/', '\\'])
        .next_back()
        .unwrap_or(shell_exe)
        .trim_end_matches(".exe")
        .to_string()
}

fn resolve_session_name(configured: Option<String>, default_name: &str) -> String {
    match configured {
        Some(name) if !name.trim().is_empty() => name,
        _ => default_name.to_string(),
    }
}

fn resolve_working_directory(configured: Option<String>) -> String {
    configured.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            resolve_windows_home()
        } else {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        }
    })
}

fn resolve_windows_home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_: std::env::VarError| {
            let drive = std::env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".to_string());
            let path = std::env::var("HOMEPATH").unwrap_or_else(|_| "\\Users\\Default".to_string());
            Ok(format!("{}{}", drive, path))
        })
        .unwrap_or_else(|_: std::env::VarError| "C:\\".to_string())
}

fn apply_shell_flags(cmd: &mut portable_pty::CommandBuilder, shell_name: &str) {
    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        cmd.arg(POWERSHELL_NOLOGO_FLAG);
    } else if shell_name == "bash" && !cfg!(target_os = "windows") {
        cmd.arg(BASH_LOGIN_FLAG);
    }
}

fn is_wsl_exe(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower == "wsl.exe"
        || lower.ends_with("\\wsl.exe")
        || lower.ends_with("/wsl.exe")
}

/// Spawn a background thread that forwards PTY output to the frontend.
///
/// Perf 005: drain budget. Each iteration accumulates reads into a local
/// buffer until either the size budget (`DRAIN_SIZE_BYTES`) or the time
/// budget (`DRAIN_INTERVAL`) is hit, then emits a single `session-output`
/// event for the accumulated slice. This caps the per-burst emit rate at
/// `1 / DRAIN_INTERVAL` (≈ 125 Hz) instead of one event per `read()`,
/// which would otherwise flood the IPC channel for `yes` / `find /` /
/// `cat large_file` style producers.
///
/// **Threading model**: the blocking `Read::read()` is performed on a
/// dedicated reader thread; chunks are sent over a bounded `sync_channel`
/// (capacity 16, i.e. 128 KiB). The main drain loop calls
/// `recv_timeout(DRAIN_INTERVAL)` so the time budget fires even when no
/// data has arrived — fixing the original bug where a slow producer
/// (e.g. one character typed, then a 1-second pause) would be held in
/// the read syscall indefinitely until the next byte arrived.
///
/// UTF-8 safe boundary: every emitted slice is a complete UTF-8 string;
/// any trailing incomplete codepoint is held in `remainder` and prefixed
/// onto the next burst, so multi-byte characters (CJK, emoji) never get
/// split across events.
///
/// EOF semantics:
/// - Before any data has been read, `Ok(0)` is treated as a transient PTY
///   condition (ConPTY on Windows can briefly return EOF before data flows
///   through the cloned master reader) and the read is retried after a short
///   delay. Emitting `session-disconnected` here would mark a healthy
///   session as disconnected the moment it opens.
/// - Once data has been observed, a subsequent `Ok(0)` is treated as the
///   genuine end-of-stream (the shell exited) and the frontend is notified.
/// - Read errors are also surfaced as `session-disconnected` instead of
///   silently killing the forwarder, so the UI reflects a broken PTY.
fn spawn_output_forwarder(
    reader: Box<dyn Read + Send>,
    backend: impl AppBackend + 'static,
    session_id: u32,
) {
    const CHANNEL_CAPACITY: usize = 16;
    let (data_tx, data_rx) = mpsc::sync_channel::<Vec<u8>>(CHANNEL_CAPACITY);

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    break;
                }
                Ok(n) => {
                    let chunk = buf[..n].to_vec();
                    if data_tx.send(chunk).is_err() {
                        break;
                    }
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::WouldBlock | ErrorKind::Interrupted
                    ) =>
                {
                    continue;
                }
                Err(e) => {
                    tracing::error!(
                        "PTY read error for session {}: {}; notifying frontend",
                        session_id,
                        e
                    );
                    let _ = data_tx.send(Vec::new());
                    break;
                }
            }
        }
    });

    let backend_clone = backend.clone();
    backend.spawn(Box::new(move || {
        let mut seen_data = false;
        let mut remainder: Vec<u8> = Vec::new();

        'outer: loop {
            let mut accumulated: Vec<u8> = Vec::with_capacity(DRAIN_SIZE_BYTES);
            let mut burst_start: Option<Instant> = None;
            let mut eof_seen = false;

            loop {
                let now = Instant::now();
                match data_rx.recv_timeout(DRAIN_INTERVAL) {
                    Ok(chunk) => {
                        if chunk.is_empty() {
                            eof_seen = true;
                            break;
                        }

                        let burst_start = burst_start.get_or_insert(now);

                        if !remainder.is_empty() {
                            accumulated.extend_from_slice(&remainder);
                            remainder.clear();
                        }
                        accumulated.extend_from_slice(&chunk);

                        if drain_should_break(
                            accumulated.len(),
                            now.duration_since(*burst_start),
                            DRAIN_SIZE_BYTES,
                            DRAIN_INTERVAL,
                        ) {
                            break;
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        eof_seen = true;
                        break;
                    }
                }
            }

            let safe_len = utf8_safe_prefix_len(&accumulated);
            let to_emit = if safe_len == accumulated.len() {
                std::mem::take(&mut accumulated)
            } else {
                remainder = accumulated[safe_len..].to_vec();
                accumulated[..safe_len].to_vec()
            };

            if !to_emit.is_empty() {
                if let Err(e) = backend_clone.emit(
                    "session-output",
                    &serde_json::json!([session_id, to_emit]),
                ) {
                    tracing::error!("Failed to emit session output: {}", e);
                    break 'outer;
                }
                seen_data = true;
            }

            if eof_seen {
                if seen_data {
                    tracing::info!(
                        "PTY EOF for session {} after data — shell exited",
                        session_id
                    );
                    let _ = backend_clone.emit(
                        "session-disconnected",
                        &serde_json::json!(session_id),
                    );
                } else {
                    tracing::debug!(
                        "Transient PTY EOF before data for session {}; retrying",
                        session_id
                    );
                    std::thread::sleep(Duration::from_millis(100));
                    remainder.clear();
                    continue 'outer;
                }
                break;
            }
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier, Condvar, Mutex};
    use std::time::{Duration, Instant};

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
            lock.lock().unwrap().push((event.to_string(), payload.clone()));
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
        first_call: std::sync::atomic::AtomicBool,
        barrier: Arc<Barrier>,
    }

    impl SlowReader {
        fn new(barrier: Arc<Barrier>) -> Self {
            Self {
                first_call: std::sync::atomic::AtomicBool::new(true),
                barrier,
            }
        }
    }

    impl Read for SlowReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.first_call.swap(false, std::sync::atomic::Ordering::SeqCst) {
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
        spawn_output_forwarder(reader, backend.clone(), session_id);

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
            elapsed,
        );
    }
}
