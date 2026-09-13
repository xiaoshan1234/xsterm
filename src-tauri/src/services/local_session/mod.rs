//! Local PTY session — xsterm's "spawn a shell on the local machine"
//! business module.
//!
//! ## Module layout
//!
//! | File           | Responsibility                                                                |
//! |----------------|-------------------------------------------------------------------------------|
//! | [`bytes`]      | Pure byte helpers: [`drain_should_break`](bytes::drain_should_break), [`utf8_safe_prefix_len`](bytes::utf8_safe_prefix_len). |
//! | [`resolution`] | Pre-spawn pure-function helpers: shell path resolution, working-directory, shell flag application, WSL detection. |
//! | [`spawn`]      | PTY output forwarder ([`spawn_output_forwarder`](spawn::spawn_output_forwarder)): thread + drain budget + UTF-8 boundary. |
//! | (this file)    | Public API: [`create_local_session`]. Submodule declarations. |
//!
//! ## Public API
//!
//! - [`create_local_session`] — main entry point used by `SessionManager`
//!   to spawn a local shell and register the per-session output forwarder.
//!
//! Everything else is `pub(super)` — callable from the parent `local_session`
//! module's siblings (`mod`, `bytes`, `resolution`, `spawn`, `tests`) but
//! not part of the crate's public surface.
//!
//! ## Relationship to `infrastructure::pty`
//!
//! Mirrors the local-session / pty split used elsewhere in this crate:
//!
//! - `services/local_session/` (this module) owns the **business /
//!   orchestration** side — config resolution, command building, output
//!   forwarding, session lifecycle.
//! - `infrastructure/pty.rs` owns the **transport abstraction** —
//!   [`PtySystem`](crate::infrastructure::pty::PtySystem) trait and the
//!   [`portable_pty`] implementation.
//!
//! Same pattern as `services/tmux/` + `infrastructure/tmux/backend.rs`.

mod bytes;
mod resolution;
mod spawn;

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Duration;

use portable_pty::PtySize;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{
    spawn_writer_thread, LocalSession, LocalSessionHandles, PtySystem,
};
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};

use resolution::{
    apply_shell_flags, extract_shell_name, is_wsl_exe, parse_shell_command, resolve_session_name,
    resolve_shell_path, resolve_working_directory,
};
use spawn::spawn_output_forwarder;

/// Spawn a local PTY session and register its output forwarder.
///
/// The session is registered with the supplied `session_id` and its
/// initial metadata (shell path, working directory, capability flags)
/// is captured into a [`SessionInfo`] for the frontend to consume.
///
/// Flow:
/// 1. Resolve shell path / extra args / display name / cwd via
///    [`resolution`] helpers.
/// 2. Open a PTY pair of the configured size via
///    [`PtySystem::openpty`].
/// 3. Build a [`portable_pty::CommandBuilder`] with the shell,
///    pre-baked args, user `args`, env config (with WSL-aware
///    `WSLENV` injection for the user-env keys), `TERM`, `LC_ALL`,
///    and `cwd`.
/// 4. Spawn the child, split the master into writer + reader,
///    spin up the writer thread via
///    [`spawn_writer_thread`](crate::infrastructure::pty::spawn_writer_thread)
///    and the output forwarder via
///    [`spawn_output_forwarder`](spawn::spawn_output_forwarder).
/// 5. Optionally schedule a deferred `startup_command` after
///    `startup_delay_ms`.
///
/// Returns the wired-up [`LocalSession`] that the `SessionManager`
/// stores in its `sessions` map.
pub fn create_local_session(
    pty_system: &dyn PtySystem,
    config: LocalSessionConfig,
    backend: Arc<dyn AppBackend>,
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
    // WSL: `cmd.env("TERM", …)` only places it in `wsl.exe`'s own env block.
    // wsl.exe does NOT forward arbitrary vars to the inner Linux bash unless
    // they're listed in WSLENV with the `/w` (Windows → WSL) flag. Without
    // this, WSL bash inherits TERM from the Windows parent (or not at all)
    // and the user's Terminal Type / Charset settings are silently ignored.
    if is_wsl_exe(&shell_exe) {
        let mut entries: Vec<&str> = Vec::new();
        if config.term_type.is_some() {
            entries.push("TERM/w");
        }
        if config.charset.is_some() {
            entries.push("LC_ALL/w");
        }
        if !entries.is_empty() {
            let new_entries = entries.join(":");
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
    cmd.cwd(&cwd);

    let child = pair.spawn(cmd).map_err_string()?;
    let writer = pair.master_writer().map_err_string()?;
    let reader = pair.master_reader().map_err_string()?;

    let (writer_tx, writer_thread) = spawn_writer_thread(writer);

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
