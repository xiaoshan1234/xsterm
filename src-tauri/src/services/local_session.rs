use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::PtySize;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{LocalSession, LocalSessionHandles, PtySystem};
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};

/// Fallback shell on Unix-like systems when the `SHELL` env var is missing.
const UNIX_FALLBACK_SHELL: &str = "/bin/bash";
/// Buffer size for reading PTY output.
const PTY_READ_BUFFER_SIZE: usize = 8192;
/// PowerShell argument to suppress the logo banner.
const POWERSHELL_NOLOGO_FLAG: &str = "-NoLogo";
/// Bash argument to start a login shell.
const BASH_LOGIN_FLAG: &str = "--login";

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
            for (key, value) in env {
                cmd.env(key, value);
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

    // Wrap the writer in Arc<Mutex<_>> so that both the foreground
    // `SessionBackend::write` path and the optional `startup_command` background
    // task can share the same PTY writer without conflicting.
    let writer = Arc::new(Mutex::new(writer));

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
        let startup_writer = Arc::clone(&writer);
        backend.spawn(Box::new(move || {
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            if let Ok(mut w) = startup_writer.lock() {
                let _ = w.write_all(startup_command.as_bytes());
                let _ = w.write_all(b"\n");
                // No flush: same rationale as LocalSession::write (Perf 002).
            }
        }));
    }

    let session = LocalSession {
        info,
        writer,
        capabilities: CapabilityFlags::for_local(),
        handles: LocalSessionHandles { child: Some(child), _pair: pair },
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

/// Spawn a background thread that forwards PTY output to the frontend.
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
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    if seen_data {
                        tracing::info!(
                            "PTY EOF for session {} after data — shell exited",
                            session_id
                        );
                        let _ = backend_clone.emit(
                            "session-disconnected",
                            &serde_json::json!(session_id),
                        );
                        break;
                    }
                    tracing::debug!(
                        "Transient PTY EOF before data for session {}; retrying",
                        session_id
                    );
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Ok(n) => {
                    seen_data = true;
                    let data = &buf[..n];
                    if let Err(e) = backend_clone.emit(
                        "session-output",
                        &serde_json::json!([session_id, data]),
                    ) {
                        tracing::error!("Failed to emit session output: {}", e);
                        break;
                    }
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
                    break;
                }
            }
        }
    }));
}
