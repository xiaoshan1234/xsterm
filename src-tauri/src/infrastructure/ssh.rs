use std::sync::{mpsc as sync_mpsc, Arc};
use std::thread;

use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::CryptoVec;
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::infrastructure::app_backend::AppBackend;
use crate::models::session::{
    SSHAuth, SSHSessionConfig, SessionInfo, SessionType, SshConnectResult, SshSessionWrapper,
};

pub trait SshChannel: Send {}

pub trait SshBackend: Send {
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<SshConnectResult, String>;
}

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

pub struct RusshBackend;

impl RusshBackend {
    pub fn new() -> Self {
        Self
    }
}

impl SshBackend for RusshBackend {
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<SshConnectResult, String> {
        let (result_tx, result_rx) = sync_mpsc::channel::<Result<(), String>>();
        let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        let host = host.to_string();
        let username = username.to_string();
        let auth_clone = auth.clone();

        thread::spawn(move || {
            let rt = Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to create runtime");

            rt.block_on(async move {
                let config = Arc::new(russh::client::Config {
                    ..Default::default()
                });

                let mut handle = match russh::client::connect(config, (host.as_str(), port), ClientHandler).await {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = result_tx.send(Err(format!("SSH connection failed: {}", e)));
                        return;
                    }
                };

                let auth_ok = match &auth_clone {
                    SSHAuth::Password { password } => {
                        handle.authenticate_password(&username, password).await
                            .map(|r| r.success())
                            .map_err(|e| format!("SSH auth error: {}", e))
                    }
                    SSHAuth::KeyFile { key_file, passphrase } => {
                        let key_data = match std::fs::read_to_string(key_file) {
                            Ok(d) => d,
                            Err(e) => {
                                let _ = result_tx.send(Err(format!("Failed to read key file: {}", e)));
                                return;
                            }
                        };
                        let key = match decode_secret_key(&key_data, passphrase.as_deref()) {
                            Ok(k) => k,
                            Err(e) => {
                                let _ = result_tx.send(Err(format!("Failed to decode key: {}", e)));
                                return;
                            }
                        };
                        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
                        handle.authenticate_publickey(&username, key_with_hash).await
                            .map(|r| r.success())
                            .map_err(|e| format!("SSH auth error: {}", e))
                    }
                };

                match auth_ok {
                    Ok(true) => {}
                    Ok(false) => {
                        let _ = result_tx.send(Err("SSH authentication failed".to_string()));
                        return;
                    }
                    Err(e) => {
                        let _ = result_tx.send(Err(e));
                        return;
                    }
                }

                let mut channel = match handle.channel_open_session().await {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = result_tx.send(Err(format!("Failed to open channel: {}", e)));
                        return;
                    }
                };

                if let Err(e) = channel.request_pty(false, "xterm", 80, 24, 0, 0, &[]).await {
                    let _ = result_tx.send(Err(format!("PTY request failed: {}", e)));
                    return;
                }

                if let Err(e) = channel.request_shell(false).await {
                    let _ = result_tx.send(Err(format!("Shell start failed: {}", e)));
                    return;
                }

                let _ = result_tx.send(Ok(()));

                let channel_id = channel.id();
                loop {
                    tokio::select! {
                        msg = channel.wait() => {
                            match msg {
                                Some(russh::ChannelMsg::Data { data }) => {
                                    let _ = read_tx.send(Some(data.as_ref().to_vec()));
                                }
                                Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                                    let _ = read_tx.send(Some(data.as_ref().to_vec()));
                                }
                                Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                                    let _ = read_tx.send(None);
                                    break;
                                }
                                _ => {}
                            }
                        }
                        data = write_rx.recv() => {
                            match data {
                                Some(d) => {
                                    if handle.data(channel_id, CryptoVec::from_slice(&d)).await.is_err() {
                                        break;
                                    }
                                }
                                None => break,
                            }
                        }
                    }
                }
            });
        });

        result_rx.recv().map_err(|_| "SSH thread panicked")??;

        Ok(SshConnectResult {
            channel: Box::new(BridgedChannel),
            write_tx,
            read_rx,
        })
    }
}

struct BridgedChannel;

impl SshChannel for BridgedChannel {}

pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    let SshConnectResult {
        channel,
        write_tx,
        read_rx,
    } = ssh_backend.connect(&config.host, config.port, &config.auth, &config.username)?;

    let info = SessionInfo {
        id: session_id,
        name: format!("SSH {}@{}", config.username, config.host),
        session_type: SessionType::Ssh {
            host: config.host,
            port: config.port,
            user: config.username,
        },
        is_connected: true,
    };

    let _channel = Arc::new(std::sync::Mutex::new(channel));
    let wrapper = SshSessionWrapper { info, write_tx };

    let backend_clone = backend.clone();
    thread::spawn(move || loop {
        match read_rx.recv() {
            Ok(Some(data)) => {
                let payload = serde_json::to_vec(&(&session_id, &data[..])).unwrap();
                if let Err(_e) = backend_clone.emit("session-output", &payload) {
                    break;
                }
            }
            Ok(None) | Err(_) => {
                let payload = serde_json::to_vec(&session_id).unwrap();
                let _ = backend_clone.emit("session-closed", &payload);
                break;
            }
        }
    });

    Ok(wrapper)
}

pub use RusshBackend as SshBackendImpl;
