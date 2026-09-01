use std::io::{ErrorKind, Read};
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
///
/// Exposed (not nested inside the function) so it can be unit-tested in
/// isolation. Returns true when either the size budget OR the time budget
/// has been reached. The `elapsed == 0` fast path means the very first
/// read can never immediately satisfy the time budget — the burst must
/// contain at least one byte before the timer starts ticking.
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
///
/// UTF-8 codepoints are 1-4 bytes; the leading byte's high bits encode
/// the expected length, and continuation bytes (`10xxxxxx`) must follow.
/// If the trailing bytes form an incomplete codepoint, return the offset
/// of that leading byte so the caller can carry it over to the next read.
///
/// Also defends against:
/// - Stray continuation bytes (carry everything before them)
/// - Buffer that is entirely continuation bytes (return 0)
fn utf8_safe_prefix_len(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    // Walk back past continuation bytes to find the most recent leading byte.
    let mut i = bytes.len();
    while i > 0 && (bytes[i - 1] & 0xC0) == 0x80 {
        i -= 1;
    }
    if i == 0 {
        return 0; // entire buffer is continuation bytes — carry everything
    }
    let leading_pos = i - 1;
    let b = bytes[leading_pos];
    let expected_len: usize = if b < 0x80 {
        1
    } else if b < 0xC0 {
        // Stray continuation byte at a "leading" position — broken input.
        // Emit everything before it; the frontend's decoder will produce a
        // replacement character for the broken byte.
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
        // Incomplete trailing codepoint — back up to before this leading byte
        leading_pos
    } else {
        bytes.len()
    }
}

/// Create a new local shell session backed by a PTY.
///
/// Determines the shell and working directory from `config`, opens a PTY,
/// spawns the shell, and starts a background thread that forwards PTY output
/// to the frontend via `backend`.
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

    // Apply T6 + T-size fields to PTY creation.
    // - `initial_rows` / `initial_cols` replace the previous hardcoded 24x80
    //   default. `unwrap_or(24)` / `unwrap_or(80)` preserve the existing
    //   fallback when the config leaves these unset.
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
            // T-wsl: forward user-defined env vars across Win32→WSL boundary.
            // wsl.exe inherits our process env but does NOT propagate vars to
            // the inner Linux shell unless each name is listed in WSLENV.
            // Microsoft Learn (wsl/filesystems): "WSLENV is a colon-delimited
            // list of environment variables that should be included when
            // launching WSL processes from Win32".
            let user_keys: Vec<&str> = env.keys().map(String::as_str).collect();
            for (key, value) in env {
                cmd.env(key, value);
            }
            // Only inject WSLENV when spawning wsl.exe — other shells use
            // standard OS env inheritance and don't need it.
            if is_wsl_exe(&shell_exe) && !user_keys.is_empty() {
                // /u = Win32→WSL only (don't round-trip into Windows tools
                // launched later from inside WSL). Preserve any pre-existing
                // WSLENV so user/system forwarding config isn't clobbered.
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
    // T6 `term_type` → TERM env var (advertises terminal capabilities to the
    // spawned shell, e.g. xterm-256color for color support).
    if let Some(term_type) = &config.term_type {
        cmd.env("TERM", term_type);
    }
    // T6 `charset` → LC_ALL env var (locale setting the child shell inherits;
    // e.g. "en_US.UTF-8" enables UTF-8 input/output).
    if let Some(charset) = &config.charset {
        cmd.env("LC_ALL", charset);
    }
    cmd.cwd(&cwd);

    let child = pair.spawn(cmd).map_err_string()?;
    let writer = pair.master_writer().map_err_string()?;
    let reader = pair.master_reader().map_err_string()?;

    // Perf 011: hand the PTY master writer off to a dedicated writer thread.
    // The IPC handler (`LocalSession::write`) and any background task
    // (e.g. startup_command below) communicate with the thread via a
    // bounded `mpsc::SyncSender`. The IPC layer never performs a blocking
    // syscall — that was the root cause of UI freezes during large pastes.
    let (writer_tx, writer_thread) = spawn_writer_thread(writer);

    let info = SessionInfo {
        id: session_id,
        name: resolve_session_name(config.name, &shell_name),
        session_type: SessionType::Local { shell: shell_path, cwd },
        is_connected: true,
        capabilities: CapabilityFlags::for_local(),
    };

    spawn_output_forwarder(reader, backend.clone(), session_id);

    // T6 `startup_command` + `startup_delay_ms` → fire-and-forget background
    // task that writes the startup command (followed by `\n`) to the PTY after
    // the configured delay. The closure runs on a `std::thread` (via
    // `AppBackend::spawn`), so `std::thread::sleep` is the natural fit.
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

/// Determine the shell executable path from config or environment defaults.
///
/// Priority:
/// 1. Explicit `shell` path (when shell_template is "custom" or shell is set).
/// 2. Resolve from `shell_template` (e.g. "powershell" -> "powershell.exe").
/// 3. Fall back to OS default (cmd.exe on Windows, $SHELL on Unix).
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

/// Split a shell path into the executable and any inline arguments.
///
/// Example: `"/bin/bash -l"` becomes `("/bin/bash", ["-l"])`.
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

/// Resolve the session display name: prefer an explicit user-supplied name,
/// fall back to the auto-derived `default_name` when missing or empty.
fn resolve_session_name(configured: Option<String>, default_name: &str) -> String {
    match configured {
        Some(name) if !name.trim().is_empty() => name,
        _ => default_name.to_string(),
    }
}

/// Resolve the working directory from config or environment defaults.
fn resolve_working_directory(configured: Option<String>) -> String {
    configured.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            resolve_windows_home()
        } else {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        }
    })
}

/// Resolve the Windows home directory from environment variables.
fn resolve_windows_home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_: std::env::VarError| {
            let drive = std::env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".to_string());
            let path = std::env::var("HOMEPATH").unwrap_or_else(|_| "\\Users\\Default".to_string());
            Ok(format!("{}{}", drive, path))
        })
        .unwrap_or_else(|_: std::env::VarError| "C:\\".to_string())
}

/// Apply shell-specific flags to suppress banners or start a login shell.
fn apply_shell_flags(cmd: &mut portable_pty::CommandBuilder, shell_name: &str) {
    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        cmd.arg(POWERSHELL_NOLOGO_FLAG);
    } else if shell_name == "bash" && !cfg!(target_os = "windows") {
        cmd.arg(BASH_LOGIN_FLAG);
    }
}

/// True if `path` resolves to `wsl.exe`. Accepts bare `"wsl.exe"` and full
/// paths (e.g. `C:\Windows\System32\wsl.exe`). Case-insensitive.
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
    mut reader: Box<dyn Read + Send>,
    backend: impl AppBackend + 'static,
    session_id: u32,
) {
    let backend_clone = backend.clone();
    backend.spawn(Box::new(move || {
        let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
        let mut seen_data = false;
        let mut remainder: Vec<u8> = Vec::new();

        'outer: loop {
            let mut accumulated: Vec<u8> = Vec::with_capacity(DRAIN_SIZE_BYTES);
            let mut burst_start: Option<Instant> = None;
            let mut eof_seen = false;

            // Inner loop: drain reads until either budget is hit.
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        eof_seen = true;
                        break;
                    }
                    Ok(n) => {
                        let now = Instant::now();
                        let burst_start = burst_start.get_or_insert(now);

                        if !remainder.is_empty() {
                            accumulated.extend_from_slice(&remainder);
                            remainder.clear();
                        }
                        accumulated.extend_from_slice(&buf[..n]);

                        if drain_should_break(
                            accumulated.len(),
                            now.duration_since(*burst_start),
                            DRAIN_SIZE_BYTES,
                            DRAIN_INTERVAL,
                        ) {
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
                        let _ = backend_clone.emit(
                            "session-disconnected",
                            &serde_json::json!(session_id),
                        );
                        break 'outer;
                    }
                }
            }

            // Trim to a UTF-8 safe boundary; carry any trailing partial
            // codepoint into the next burst.
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
                    std::thread::sleep(std::time::Duration::from_millis(100));
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

    #[test]
    fn drain_should_break_returns_false_on_empty_burst() {
        // The very first read: elapsed == 0 and no bytes — must NOT break,
        // otherwise we'd emit an empty event for every PTY open.
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
        // Slightly over is fine — the >= check is inclusive.
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
        // Just under — still emit.
        assert!(!drain_should_break(
            1024,
            DRAIN_INTERVAL - Duration::from_micros(1),
            DRAIN_SIZE_BYTES,
            DRAIN_INTERVAL,
        ));
    }

    #[test]
    fn drain_should_break_on_time_budget_regardless_of_byte_count() {
        // The caller (drain loop) is responsible for not emitting an empty
        // payload — this helper's contract is purely "size OR time", and
        // a slow producer hitting the time budget with zero bytes is a valid
        // signal to break out so we can poll again.
        assert!(drain_should_break(
            0,
            DRAIN_INTERVAL,
            DRAIN_SIZE_BYTES,
            DRAIN_INTERVAL,
        ));
    }

    #[test]
    fn utf8_safe_prefix_len_for_ascii_returns_full_length() {
        let s = b"hello world";
        assert_eq!(utf8_safe_prefix_len(s), s.len());
    }

    #[test]
    fn utf8_safe_prefix_len_for_2byte_codepoint_returns_full_length() {
        // "é" = 0xC3 0xA9
        assert_eq!(utf8_safe_prefix_len(&[0xC3, 0xA9]), 2);
        assert_eq!(utf8_safe_prefix_len(b"a\xC3\xA9b"), 4);
    }

    #[test]
    fn utf8_safe_prefix_len_for_3byte_codepoint_returns_full_length() {
        // "中" = 0xE4 0xB8 0xAD
        let s = b"a\xE4\xB8\xAD";
        assert_eq!(utf8_safe_prefix_len(s), 4);
    }

    #[test]
    fn utf8_safe_prefix_len_for_4byte_codepoint_returns_full_length() {
        // "😀" = 0xF0 0x9F 0x98 0x80
        let s = b"a\xF0\x9F\x98\x80";
        assert_eq!(utf8_safe_prefix_len(s), 5);
    }

    #[test]
    fn utf8_safe_prefix_len_trims_incomplete_trailing_codepoint() {
        // "é" but only 1 byte — incomplete; back up to 0.
        assert_eq!(utf8_safe_prefix_len(&[0xC3]), 0);
        // "中" but only 2 bytes — incomplete; back up to 0.
        assert_eq!(utf8_safe_prefix_len(&[0xE4, 0xB8]), 0);
        // "😀" but only 3 bytes — incomplete; back up to 0.
        assert_eq!(utf8_safe_prefix_len(&[0xF0, 0x9F, 0x98]), 0);
    }

    #[test]
    fn utf8_safe_prefix_len_preserves_complete_prefix_then_trims() {
        // "abé" but trailing 0xC3 is incomplete — boundary should be 2.
        assert_eq!(utf8_safe_prefix_len(b"ab\xC3"), 2);
    }

    #[test]
    fn utf8_safe_prefix_len_trims_at_stray_leading_byte_after_complete_codepoint() {
        // "ab" (complete) + leading 0xC3 (start of a 2-byte sequence but
        // missing its continuation). The function trims back to before the
        // incomplete 0xC3, returning 2.
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
}
