#![cfg(target_os = "windows")]
//! Creation of elevated (run-as-administrator) local sessions on Windows.
//!
//! Elevated counterpart of [`create_local_session`](super::local_session::create_local_session):
//! resolves shell/cwd/env the same way, then delegates process creation to
//! [`ElevatedSession::spawn`](crate::infrastructure::elevated_session::ElevatedSession::spawn),
//! which launches the elevated helper via `ShellExecuteEx("runas")`.
//!
//! Limitation vs. the regular local path: `startup_command` /
//! `startup_delay_ms` are not applied to elevated sessions (the PTY writer
//! lives in the helper process and is not exposed here).

use std::collections::HashMap;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::elevated_session::ElevatedSession;
use crate::models::session::{LocalSessionConfig, SessionType};
use crate::services::local_session::{
    extract_shell_name, parse_shell_command, resolve_session_name, resolve_shell_path,
    resolve_working_directory, shell_flag_args,
};

/// Create a local shell session whose shell runs as administrator.
pub fn create_elevated_local_session(
    config: LocalSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<ElevatedSession, String> {
    let shell_path = resolve_shell_path(config.shell, config.shell_template.as_deref());
    let (shell_exe, mut shell_args) = parse_shell_command(&shell_path);
    let shell_name = extract_shell_name(&shell_exe);
    shell_args.extend(shell_flag_args(&shell_name));
    if let Some(args) = config.args {
        shell_args.extend(args);
    }
    let cwd = resolve_working_directory(config.cwd);

    let cols = config.initial_cols.unwrap_or(80);
    let rows = config.initial_rows.unwrap_or(24);

    tracing::info!(
        "Creating elevated local session {}: shell={} args={:?} cwd={} size={}x{}",
        session_id,
        shell_exe,
        shell_args,
        cwd,
        cols,
        rows
    );

    let mut env: HashMap<String, String> = HashMap::new();
    if let Some(env_config) = &config.env_config {
        if let Some(vars) = &env_config.env {
            env.extend(vars.clone());
        }
    }

    let mut session = ElevatedSession::spawn(
        &shell_exe,
        &shell_args,
        &cwd,
        &env,
        config.term_type.as_deref(),
        config.charset.as_deref(),
        cols,
        rows,
        session_id,
        backend,
    )?;

    session.info.name = resolve_session_name(config.name, &shell_name);
    session.info.session_type = SessionType::Local { shell: shell_path, cwd };
    Ok(session)
}
