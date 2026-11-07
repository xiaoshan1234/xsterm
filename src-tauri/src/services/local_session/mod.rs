//! Local PTY session 鈥?spawn a local shell via the vendored `xscore` crate.

mod bytes;
mod resolution;
mod spawn;

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Duration;

use xscore::platform::{LocalPty, Size};

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::LocalSession;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};

use resolution::{
    apply_shell_flags, extract_shell_name, is_wsl_exe, parse_shell_command, resolve_session_name,
    resolve_shell_path, resolve_working_directory,
};
use spawn::spawn_output_forwarder;

/// Spawn a local shell session and register its output forwarder.
///
/// The returned [`LocalSession`] is what [`SessionManager`] stores in its
/// registry. The actual PTY transport is owned by [`LocalPty`].
///
/// [`SessionManager`]: crate::services::session_manager::SessionManager
pub fn create_local_session(
    config: LocalSessionConfig,
    backend: Arc<dyn AppBackend>,
    session_id: u32,
) -> Result<LocalSession, String> {
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

    let pty = Arc::new(LocalPty::new(shell_exe, shell_args, Some(cwd.clone()), env));
    let rx = pty.spawn(Size::new(cols, rows)).map_err_string()?;

    let info = SessionInfo {
        id: session_id,
        name: resolve_session_name(config.name, &shell_name),
        session_type: SessionType::Local {
            shell: shell_path,
            cwd,
        },
        is_connected: true,
        capabilities: CapabilityFlags::for_local(),
        tmux_pane_id: None,
        tmux_controller_id: None,
        tmux_window_id: None,
        is_hidden: false,
    };

    spawn_output_forwarder(rx, backend.clone(), session_id);

    if let Some(startup_command) = config.startup_command.clone() {
        let delay_ms = config.startup_delay_ms.unwrap_or(0);
        let startup_pty = Arc::clone(&pty);
        backend.spawn(Box::new(move || {
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            let _ = startup_pty.write(startup_command.as_bytes());
            let _ = startup_pty.write(b"\n");
        }));
    }

    Ok(LocalSession::new(info, pty))
}
