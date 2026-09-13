//! Pure-function helpers used by [`super::mod::create_local_session`]
//! to resolve shell / cwd / session-name fields from a
//! [`LocalSessionConfig`](crate::models::session::LocalSessionConfig)
//! before the actual PTY is spawned.
//!
//! Everything in this file is `pub(super)` because the callers live
//! in the parent `local_session` module — these helpers are not part
//! of the crate's public API.

use portable_pty::CommandBuilder;

/// Fallback shell on Unix-like systems when the `SHELL` env var is missing.
pub(super) const UNIX_FALLBACK_SHELL: &str = "/bin/bash";
/// PowerShell argument to suppress the logo banner.
pub(super) const POWERSHELL_NOLOGO_FLAG: &str = "-NoLogo";
/// Bash argument to start a login shell.
pub(super) const BASH_LOGIN_FLAG: &str = "--login";

/// Resolve which shell executable to spawn, given the user-supplied
/// `shell` override and the optional `shell_template` hint.
///
/// Priority: explicit `shell` wins; otherwise the template (or its
/// Unix/Windows default) wins; otherwise a per-OS fallback (`cmd.exe`
/// on Windows, `$SHELL` / `/bin/bash` on Unix).
pub(super) fn resolve_shell_path(
    configured: Option<String>,
    shell_template: Option<&str>,
) -> String {
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

/// Split a shell path of the form `"exe arg1 arg2"` into the executable
/// and its pre-baked argument list. Pure function — does not invoke any
/// shell parser.
pub(super) fn parse_shell_command(shell_path: &str) -> (String, Vec<String>) {
    shell_path
        .split_once(' ')
        .map(|(exe, rest)| {
            (
                exe.to_string(),
                rest.split_whitespace()
                    .map(String::from)
                    .collect::<Vec<_>>(),
            )
        })
        .unwrap_or_else(|| (shell_path.to_string(), Vec::new()))
}

/// Derive a friendly display name from the shell executable's path
/// (e.g. `C:\WINDOWS\System32\cmd.exe` → `cmd`).
pub(super) fn extract_shell_name(shell_exe: &str) -> String {
    shell_exe
        .split(['/', '\\'])
        .next_back()
        .unwrap_or(shell_exe)
        .trim_end_matches(".exe")
        .to_string()
}

/// Resolve the session display name: prefer an explicit user-supplied
/// name, fall back to the auto-derived `default_name` when missing or empty.
pub(super) fn resolve_session_name(configured: Option<String>, default_name: &str) -> String {
    match configured {
        Some(name) if !name.trim().is_empty() => name,
        _ => default_name.to_string(),
    }
}

/// Resolve the working directory the shell should be spawned in.
pub(super) fn resolve_working_directory(configured: Option<String>) -> String {
    configured.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            resolve_windows_home()
        } else {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        }
    })
}

/// Read `USERPROFILE` (Windows) and assemble a home path; falls back to
/// `HOMEDRIVE` + `HOMEPATH`, then `C:\`.
pub(super) fn resolve_windows_home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_: std::env::VarError| {
            let drive = std::env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".to_string());
            let path = std::env::var("HOMEPATH").unwrap_or_else(|_| "\\Users\\Default".to_string());
            Ok(format!("{}{}", drive, path))
        })
        .unwrap_or_else(|_: std::env::VarError| "C:\\".to_string())
}

/// Append shell-specific flags to a [`CommandBuilder`] before spawn
/// — `-NoLogo` for PowerShell / pwsh; `--login` for bash on Unix.
pub(super) fn apply_shell_flags(cmd: &mut CommandBuilder, shell_name: &str) {
    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        cmd.arg(POWERSHELL_NOLOGO_FLAG);
    } else if shell_name == "bash" && !cfg!(target_os = "windows") {
        cmd.arg(BASH_LOGIN_FLAG);
    }
}

/// True if the resolved shell is `wsl.exe` (Windows path or POSIX
/// variant). Used to drive the WSL-specific `WSLENV` injection logic
/// in the spawn flow.
pub(super) fn is_wsl_exe(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower == "wsl.exe" || lower.ends_with("\\wsl.exe") || lower.ends_with("/wsl.exe")
}
