use std::io::Read;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{default_pty_size, LocalSession, LocalSessionHandles, PtySystem};
use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};

/// Default shell on Windows when no shell is configured.
const WINDOWS_DEFAULT_SHELL: &str = "powershell.exe";
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
) -> Result<(LocalSession, LocalSessionHandles), String> {
    let shell_path = resolve_shell_path(config.shell);
    let (shell_exe, shell_extra_args) = parse_shell_command(&shell_path);
    let shell_name = extract_shell_name(&shell_exe);
    let cwd = resolve_working_directory(config.cwd);

    let mut pair = pty_system
        .openpty(default_pty_size())
        .map_err_string()?;

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
    cmd.cwd(&cwd);

    let child = pair.spawn(cmd).map_err_string()?;
    let writer = pair.master_writer().map_err_string()?;
    let reader = pair.master_reader().map_err_string()?;

    let info = SessionInfo {
        id: session_id,
        name: shell_name,
        session_type: SessionType::Local { shell: shell_path, cwd },
        is_connected: true,
    };

    spawn_output_forwarder(reader, backend, session_id);

    let handles = LocalSessionHandles { child: Some(child), _pair: pair };

    Ok((LocalSession { info, writer }, handles))
}

/// Determine the shell executable path from config or environment defaults.
fn resolve_shell_path(configured: Option<String>) -> String {
    configured.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            WINDOWS_DEFAULT_SHELL.to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| UNIX_FALLBACK_SHELL.to_string())
        }
    })
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

/// Extract the file name component from a shell path.
fn extract_shell_name(shell_exe: &str) -> String {
    shell_exe
        .split(['/', '\\'])
        .next_back()
        .unwrap_or(shell_exe)
        .to_string()
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
fn spawn_output_forwarder(
    mut reader: Box<dyn Read + Send>,
    backend: impl AppBackend + 'static,
    session_id: u32,
) {
    let backend_clone = backend.clone();
    backend.spawn(Box::new(move || {
        let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF: the shell process exited.
                    let payload = serde_json::to_vec(&session_id).unwrap();
                    let _ = backend_clone.emit("session-closed", &payload);
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];
                    let payload = serde_json::to_vec(&(session_id, data)).unwrap();
                    if let Err(e) = backend_clone.emit("session-output", &payload) {
                        eprintln!("Failed to emit session output: {}", e);
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    }));
}
