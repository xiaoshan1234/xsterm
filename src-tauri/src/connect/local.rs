//! Local shell session creation on top of xscore's `LocalPty`.

use std::sync::Arc;
use std::time::Duration;

use xscore::platform::{LocalPty, Size};

use crate::connect::app_backend::AppBackend;
use crate::connect::forward::spawn_output_forwarder;
use crate::connect::session::{BoundTerminal, TerminalTransport};
use crate::shared::capabilities::CapabilityFlags;
use crate::shared::session::{LocalTerminalConfig, TerminalInfo, TerminalKind};

const UNIX_FALLBACK_SHELL: &str = "/bin/bash";
const POWERSHELL_NOLOGO_FLAG: &str = "-NoLogo";
const BASH_LOGIN_FLAG: &str = "--login";

pub(crate) fn create_local_terminal(
    config: LocalTerminalConfig,
    backend: Arc<dyn AppBackend>,
    session_id: u32,
) -> Result<BoundTerminal, String> {
    let shell_path = resolve_shell_path(config.shell, config.shell_template.as_deref());
    let (shell_exe, mut shell_args) = parse_shell_command(&shell_path);
    let shell_name = extract_shell_name(&shell_exe);
    let cwd = resolve_working_directory(config.cwd);

    apply_shell_flags(&mut shell_args, &shell_name);
    if let Some(args) = config.args {
        shell_args.extend(args);
    }

    let mut env: Vec<(String, String)> = Vec::new();
    let mut wsl_entries: Vec<String> = Vec::new();
    if let Some(env_config) = &config.env_config {
        if let Some(user_env) = &env_config.env {
            for (key, value) in user_env {
                env.push((key.clone(), value.clone()));
            }
            if is_wsl_exe(&shell_exe) && !user_env.is_empty() {
                wsl_entries.extend(user_env.keys().map(|k| format!("{k}/u")));
            }
        }
    }
    if let Some(term_type) = &config.term_type {
        env.push(("TERM".into(), term_type.clone()));
        if is_wsl_exe(&shell_exe) {
            wsl_entries.push("TERM/w".to_string());
        }
    }
    if let Some(charset) = &config.charset {
        env.push(("LC_ALL".into(), charset.clone()));
        if is_wsl_exe(&shell_exe) {
            wsl_entries.push("LC_ALL/w".to_string());
        }
    }
    if !wsl_entries.is_empty() {
        let new_entries = wsl_entries.join(":");
        let existing = std::env::var("WSLENV").unwrap_or_default();
        env.push((
            "WSLENV".into(),
            if existing.is_empty() {
                new_entries
            } else {
                format!("{existing}:{new_entries}")
            },
        ));
    }

    let cols = config.initial_cols.unwrap_or(80);
    let rows = config.initial_rows.unwrap_or(24);
    let is_wsl = is_wsl_exe(&shell_exe);

    let pty = Arc::new(LocalPty::new(shell_exe, shell_args, Some(cwd.clone()), env));
    let rx = pty
        .spawn(Size::new(cols, rows))
        .map_err(|e| e.to_string())?;

    let kind = if is_wsl {
        TerminalKind::Wsl { distribution: None }
    } else {
        TerminalKind::Local {
            shell: shell_path,
            cwd,
        }
    };

    let info = TerminalInfo {
        id: session_id,
        name: resolve_session_name(config.name, &shell_name),
        kind,
        is_connected: true,
        capabilities: CapabilityFlags::for_local(),
        tmux_window_id: None,
        tmux_session_name: None,
        is_hidden: false,
    };

    spawn_output_forwarder(rx, backend.clone(), session_id);

    if let Some(startup_command) = config.startup_command {
        let delay_ms = config.startup_delay_ms.unwrap_or(0);
        let startup_pty = Arc::clone(&pty);
        tokio::spawn(async move {
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
            let _ = startup_pty.write(startup_command.as_bytes());
            let _ = startup_pty.write(b"\n");
        });
    }

    Ok(BoundTerminal {
        info,
        capabilities: CapabilityFlags::for_local(),
        transport: TerminalTransport::Local(pty),
        ssh_config: None,
    })
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
                rest.split_whitespace().map(String::from).collect(),
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
            Ok(format!("{drive}{path}"))
        })
        .unwrap_or_else(|_: std::env::VarError| "C:\\".to_string())
}

fn apply_shell_flags(args: &mut Vec<String>, shell_name: &str) {
    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        args.push(POWERSHELL_NOLOGO_FLAG.to_string());
    } else if shell_name == "bash" && !cfg!(target_os = "windows") {
        args.push(BASH_LOGIN_FLAG.to_string());
    }
}

fn is_wsl_exe(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower == "wsl.exe" || lower.ends_with("\\wsl.exe") || lower.ends_with("/wsl.exe")
}
