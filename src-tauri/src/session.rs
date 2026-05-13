use serde::{Deserialize, Serialize};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use ssh2::Session as SshSession;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionType {
    #[serde(rename = "local")]
    Local {
        shell: String,
        cwd: String,
    },
    #[serde(rename = "ssh")]
    Ssh {
        host: String,
        port: u16,
        user: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSessionConfig {
    pub shell: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHSessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(flatten)]
    pub auth: SSHAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "auth_type")]
pub enum SSHAuth {
    #[serde(rename = "password")]
    Password { password: String },
    #[serde(rename = "key")]
    KeyFile { key_file: String, passphrase: Option<String> },
}

struct LocalSession {
    info: SessionInfo,
    writer: Box<dyn Write + Send>,
}

struct SshSessionWrapper {
    info: SessionInfo,
    channel: ssh2::Channel,
    #[allow(dead_code)]
    stream: TcpStream,
}

enum Session {
    Local(LocalSession),
    Ssh(SshSessionWrapper),
}

impl Session {
    fn info(&self) -> &SessionInfo {
        match self {
            Session::Local(s) => &s.info,
            Session::Ssh(s) => &s.info,
        }
    }
}

pub struct SessionManager {
    sessions: HashMap<u32, Session>,
    next_id: u32,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn create_local(&mut self, config: LocalSessionConfig, app: AppHandle) -> Result<SessionInfo, String> {
        let pty_system = native_pty_system();

        let shell_path = config.shell.unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "powershell.exe".to_string()
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
            }
        });

        let shell_name = shell_path.split('/').last().unwrap_or(&shell_path).to_string();

        let cwd = config.cwd.unwrap_or_else(|| {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        });

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = CommandBuilder::new("powershell.exe");
            c.args(["-NoLogo", "-NoProfile"]);
            c
        } else {
            let mut c = CommandBuilder::new(&shell_path);
            if shell_path.contains("bash") {
                c.arg("--login");
            }
            c
        };

        cmd.cwd(&cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let id = self.next_id;
        self.next_id += 1;

        let name = format!("Local ({})", shell_name);
        let shell_for_info = shell_path.clone();
        let cwd_for_info = cwd.clone();

        let info = SessionInfo {
            id,
            name,
            session_type: SessionType::Local { shell: shell_for_info, cwd: cwd_for_info },
            is_connected: true,
        };

        let session = Session::Local(LocalSession { info: info.clone(), writer });
        self.sessions.insert(id, session);

        let app_clone = app.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            loop {
                if let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        let _ = app_clone.emit("session-closed", id);
                        break;
                    }
                    let data = buf[..n].to_vec();
                    if let Err(e) = app_clone.emit("session-output", (&id, &data[..])) {
                        eprintln!("Failed to emit: {}", e);
                        break;
                    }
                }
            }
        });

        let _ = child;
        Ok(info)
    }

    pub fn create_ssh(&mut self, config: SSHSessionConfig, app: AppHandle) -> Result<SessionInfo, String> {
        let tcp = TcpStream::connect(format!("{}:{}", config.host, config.port))
            .map_err(|e| format!("Failed to connect: {}", e))?;

        let mut ssh_session = SshSession::new().map_err(|e| format!("SSH session error: {}", e))?;
        ssh_session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        ssh_session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        match config.auth {
            SSHAuth::Password { password } => {
                ssh_session.userauth_password(&config.username, &password)
                    .map_err(|e| format!("SSH auth failed: {}", e))?;
            }
            SSHAuth::KeyFile { key_file, passphrase } => {
                ssh_session.userauth_pubkey_file(
                    &config.username,
                    None,
                    std::path::Path::new(&key_file),
                    passphrase.as_deref(),
                )
                .map_err(|e| format!("SSH key auth failed: {}", e))?;
            }
        }

        if !ssh_session.authenticated() {
            return Err("SSH authentication failed".to_string());
        }

        let mut channel = ssh_session.channel_session().map_err(|e| e.to_string())?;
        channel.request_pty("xterm", None, None).map_err(|e| format!("PTY request failed: {}", e))?;

        channel.shell().map_err(|e| format!("Shell start failed: {}", e))?;

        let id = self.next_id;
        self.next_id += 1;

        let name = format!("SSH {}@{}", config.username, config.host);
        let host_for_info = config.host.clone();
        let user_for_info = config.username.clone();

        let info = SessionInfo {
            id,
            name,
            session_type: SessionType::Ssh {
                host: host_for_info,
                port: config.port,
                user: user_for_info,
            },
            is_connected: true,
        };

        let session = Session::Ssh(SshSessionWrapper {
            info: info.clone(),
            channel,
            stream: tcp,
        });
        self.sessions.insert(id, session);

        let app_clone = app.clone();
        let channel = match self.sessions.get(&id) {
            Some(Session::Ssh(s)) => s.channel.clone(),
            _ => return Err("Session not found".to_string()),
        };

        thread::spawn(move || {
            let mut channel = channel;
            let mut buf = [0u8; 8192];
            loop {
                match channel.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_clone.emit("session-closed", id);
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        if let Err(e) = app_clone.emit("session-output", (&id, &data[..])) {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(info)
    }

    pub fn write(&mut self, id: u32, data: &[u8]) -> Result<(), String> {
        match self.sessions.get_mut(&id) {
            Some(Session::Local(s)) => {
                s.writer.write_all(data).map_err(|e| e.to_string())?;
                s.writer.flush().map_err(|e| e.to_string())?;
                Ok(())
            }
            Some(Session::Ssh(s)) => {
                s.channel.write(data).map_err(|e| e.to_string())?;
                s.channel.flush().map_err(|e| e.to_string())?;
                Ok(())
            }
            None => Err("Session not found".to_string()),
        }
    }

    pub fn resize(&mut self, _id: u32, _rows: u16, _cols: u16) -> Result<(), String> {
        Ok(())
    }

    pub fn close(&mut self, id: u32) -> Result<(), String> {
        self.sessions.remove(&id);
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info().clone()).collect()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}