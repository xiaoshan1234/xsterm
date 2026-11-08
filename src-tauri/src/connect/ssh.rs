//! SSH shell session creation on top of xscore's `SshConnection`.

use std::sync::Arc;

use xscore::platform::ssh::{SshConnection, SshOptions};
use xscore::platform::Size;

use crate::connect::app_backend::AppBackend;
use crate::connect::forward::spawn_output_forwarder;
use crate::connect::session::{BoundSession, TerminalTransport};
use crate::connect::tmux::ssh_options_from_config;
use crate::shared::capabilities::CapabilityFlags;
use crate::shared::session::{SSHSessionConfig, SessionInfo, SessionType};

pub(crate) async fn create_ssh_session(
    config: SSHSessionConfig,
    backend: Arc<dyn AppBackend>,
    session_id: u32,
) -> Result<BoundSession, String> {
    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();
    let default_name = format!("{username}@{host}");

    let info = SessionInfo {
        id: session_id,
        name: resolve_session_name(config.name.clone(), &default_name),
        session_type: SessionType::Ssh {
            host: host.clone(),
            port,
            user: username.clone(),
        },
        is_connected: true,
        capabilities: CapabilityFlags::for_ssh(),
        tmux_pane_id: None,
        tmux_controller_id: None,
        tmux_window_id: None,
        is_hidden: false,
    };

    let (identity, password) = match config.auth_type.as_str() {
        "password" => (None, config.password.clone()),
        "key" => {
            if config.key_file.is_none() {
                return Err("key_file required when auth_type is \"key\"".to_string());
            }
            (config.key_file.clone(), None)
        }
        other => return Err(format!("unknown ssh auth_type: {other}")),
    };

    let mut env: Vec<(String, String)> = Vec::new();
    if let Some(charset) = config.charset.as_deref() {
        if !charset.is_empty() {
            env.push(("LC_ALL".to_string(), charset.to_string()));
        }
    }

    let cols = config.initial_cols.unwrap_or(80).min(u16::MAX as u32) as u16;
    let rows = config.initial_rows.unwrap_or(24).min(u16::MAX as u32) as u16;
    let options: SshOptions = ssh_options_from_config(&config);

    let conn = Arc::new(SshConnection::with_options(
        username, host, port, identity, password, env, options,
    ));
    let rx = conn
        .connect(Size::new(cols, rows))
        .await
        .map_err(|e| format!("SSH connection failed: {e}"))?;

    spawn_output_forwarder(rx, backend, session_id);

    Ok(BoundSession {
        info,
        capabilities: CapabilityFlags::for_ssh(),
        transport: TerminalTransport::Ssh(conn),
        ssh_config: Some(config),
    })
}

fn resolve_session_name(configured: Option<String>, default_name: &str) -> String {
    match configured {
        Some(name) if !name.trim().is_empty() => name,
        _ => default_name.to_string(),
    }
}
