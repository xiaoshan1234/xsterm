//! Minimal SSH exec helper used for image uploads.
//!
//! Session transport (shell and tmux) lives in xscore; xscore does not expose a
//! generic exec channel, so image upload keeps this tiny russh exec path.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use tokio::net::{TcpSocket, TcpStream};

use crate::shared::error::StringError;
use crate::shared::session::SshConfig;

struct ClientHandler;

impl russh::client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn open_configured_tcp_stream(config: &SshConfig) -> Result<TcpStream, String> {
    let nodelay = config.tcp_nodelay.unwrap_or(true);
    let keepalive = config.so_keepalive.unwrap_or(false);

    let mut addrs: Vec<SocketAddr> = tokio::net::lookup_host((config.host.as_str(), config.port))
        .await
        .map_err(|e| {
            format!(
                "DNS resolution failed for {}:{}: {e}",
                config.host, config.port
            )
        })?
        .collect();
    addrs.sort_by_key(|a| match a {
        SocketAddr::V4(_) => 0,
        SocketAddr::V6(_) => 1,
    });

    let mut last_error = None;
    for addr in addrs {
        let socket = match addr {
            SocketAddr::V4(_) => TcpSocket::new_v4(),
            SocketAddr::V6(_) => TcpSocket::new_v6(),
        };
        let socket = match socket {
            Ok(socket) => socket,
            Err(e) => {
                last_error = Some(e.to_string());
                continue;
            }
        };
        let _ = socket.set_nodelay(nodelay);
        let _ = socket.set_keepalive(keepalive);
        match socket.connect(addr).await {
            Ok(stream) => return Ok(stream),
            Err(e) => last_error = Some(e.to_string()),
        }
    }

    Err(format!(
        "SSH TCP connection to {}:{} failed: {}",
        config.host,
        config.port,
        last_error.unwrap_or_else(|| "no addresses succeeded".to_string())
    ))
}

async fn authenticate(
    handle: &mut russh::client::Handle<ClientHandler>,
    config: &SshConfig,
) -> Result<(), String> {
    match config.auth_type.as_str() {
        "password" => {
            let password = config.password.as_deref().unwrap_or("");
            let ok = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err_string()?
                .success();
            if !ok {
                return Err("password authentication rejected".to_string());
            }
        }
        "key" => {
            let key_file = config
                .key_file
                .as_deref()
                .ok_or_else(|| "key_file required when auth_type is \"key\"".to_string())?;
            let key_data = std::fs::read_to_string(key_file)
                .map_err(|e| format!("failed to read key file '{key_file}': {e}"))?;
            let key = decode_secret_key(&key_data, config.passphrase.as_deref())
                .map_err(|e| format!("failed to decode key '{key_file}': {e}"))?;
            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            let ok = handle
                .authenticate_publickey(&config.username, key_with_hash)
                .await
                .map_err_string()?
                .success();
            if !ok {
                return Err("public key authentication rejected".to_string());
            }
        }
        other => return Err(format!("unknown ssh auth_type: {other}")),
    }
    Ok(())
}

async fn exec_ssh_command(
    config: &SshConfig,
    command: &str,
    stdin_data: Vec<u8>,
) -> Result<(), String> {
    let mut ssh_config = russh::client::Config::default();
    if let Some(secs) = config.keepalive_interval {
        ssh_config.keepalive_interval = Some(Duration::from_secs(secs as u64));
    }
    if config.enable_compression.unwrap_or(false) {
        ssh_config.preferred = russh::Preferred::COMPRESSED;
    }
    let ssh_config = Arc::new(ssh_config);

    let stream = open_configured_tcp_stream(config).await?;
    let mut handle = russh::client::connect_stream(ssh_config, stream, ClientHandler)
        .await
        .map_err(|e| {
            format!(
                "SSH connection to {}:{} failed: {e}",
                config.host, config.port
            )
        })?;
    authenticate(&mut handle, config).await?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("failed to open SSH session channel: {e}"))?;
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("SSH exec failed: {e}"))?;

    if !stdin_data.is_empty() {
        channel
            .data(&stdin_data[..])
            .await
            .map_err(|e| format!("failed to send stdin data: {e}"))?;
    }
    channel
        .eof()
        .await
        .map_err(|e| format!("failed to close stdin: {e}"))?;

    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                if exit_status != 0 {
                    return Err(format!("remote command exited with status {exit_status}"));
                }
                break;
            }
            Some(russh::ChannelMsg::Close) | Some(russh::ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    Ok(())
}

/// Upload `data` to `remote_path` via a fresh SSH exec channel (`cat > path`).
pub async fn upload_file_via_ssh(
    config: &SshConfig,
    remote_path: &str,
    data: Vec<u8>,
) -> Result<(), String> {
    let command = format!("cat > {remote_path}");
    exec_ssh_command(config, &command, data).await
}
