use serde::{Deserialize, Serialize};
use tauri::Emitter;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::thread;

// Re-export types from submodules for backwards compatibility
pub use crate::local_session::{Child, LocalSession, PtyPair, PtySystem};
pub use crate::ssh_session::{SshBackend, SshBackendImpl, SshChannel, StreamIO};

pub use crate::local_session::NativePtySystem;
pub use crate::ssh_session::SshSessionWrapper;

use crate::local_session::{NativePtySystem as DefaultPtySystem, PtyPair as LocalPtyPairTrait};

pub trait AppBackend: Send + Sync + Clone {
    fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String>;
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);
}

#[derive(Clone)]
pub struct RealAppBackend {
    app: Arc<tauri::AppHandle>,
}

impl RealAppBackend {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app: Arc::new(app) }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String> {
        let json: serde_json::Value = serde_json::from_slice(payload)
            .map_err(|e| e.to_string())?;
        self.app.emit(event, json).map_err(|e| e.to_string())
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(f);
    }
}

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

enum Session {
    Local(crate::local_session::LocalSession),
    Ssh(crate::ssh_session::SshSessionWrapper),
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
    pty_system: Box<dyn crate::local_session::PtySystem>,
    ssh_backend: Box<dyn crate::ssh_session::SshBackend>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(NativePtySystem::new()),
            ssh_backend: Box::new(SshBackendImpl::new()),
        }
    }

    pub fn create_local(&mut self, config: LocalSessionConfig, backend: impl AppBackend + 'static) -> Result<SessionInfo, String> {
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

        let mut pair = self
            .pty_system
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = portable_pty::CommandBuilder::new("powershell.exe");
            c.args(["-NoLogo", "-NoProfile"]);
            c
        } else {
            let mut c = portable_pty::CommandBuilder::new(&shell_path);
            if shell_path.contains("bash") {
                c.arg("--login");
            }
            c
        };

        cmd.cwd(&cwd);

        let child = pair.spawn(cmd).map_err(|e| e.to_string())?;
        let writer = pair.master_writer().map_err(|e| e.to_string())?;
        let reader = pair.master_reader().map_err(|e| e.to_string())?;

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

        let session = Session::Local(crate::local_session::LocalSession { info: info.clone(), writer });
        self.sessions.insert(id, session);

        let backend_clone = backend.clone();
        backend.spawn(Box::new(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            loop {
                if let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        let payload = serde_json::to_vec(&id).unwrap();
                        let _ = backend_clone.emit("session-closed", &payload);
                        break;
                    }
                    let data = buf[..n].to_vec();
                    let payload = serde_json::to_vec(&(&id, &data[..])).unwrap();
                    if let Err(e) = backend_clone.emit("session-output", &payload) {
                        eprintln!("Failed to emit: {}", e);
                        break;
                    }
                }
            }
        }));

        let _ = child;
        Ok(info)
    }

    pub fn create_ssh(&mut self, config: SSHSessionConfig, backend: impl AppBackend + 'static) -> Result<SessionInfo, String> {
        let channel = self.ssh_backend.connect(
            &config.host,
            config.port,
            &config.auth,
            &config.username,
        )?;

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

        let channel_arc = Arc::new(Mutex::new(channel));
        let session = Session::Ssh(crate::ssh_session::SshSessionWrapper {
            info: info.clone(),
            channel: channel_arc.clone(),
        });
        self.sessions.insert(id, session);

        let backend_clone = backend.clone();
        let channel_for_thread = channel_arc.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match channel_for_thread.lock().unwrap().read(&mut buf) {
                    Ok(0) => {
                        let payload = serde_json::to_vec(&id).unwrap();
                        let _ = backend_clone.emit("session-closed", &payload);
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let payload = serde_json::to_vec(&(&id, &data[..])).unwrap();
                        if let Err(_e) = backend_clone.emit("session-output", &payload) {
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
                s.channel.lock().unwrap().write(data).map_err(|e| e.to_string())?;
                s.channel.lock().unwrap().flush().map_err(|e| e.to_string())?;
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

// ============================================================================
// SessionManager Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use mockall::{mock, predicate::*};
    use std::io::Read;

    struct MockReadReturningZero;
    impl Read for MockReadReturningZero {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }

    struct MockWrite;
    impl Write for MockWrite {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    mock! {
        pub PtyPairM {
            fn spawn(&mut self, cmd: portable_pty::CommandBuilder) -> Result<Box<dyn Child>, String>;
            fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String>;
            fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
        }
    }

    impl PtyPair for MockPtyPairM {
        fn spawn(&mut self, cmd: portable_pty::CommandBuilder) -> Result<Box<dyn Child>, String> {
            self.spawn(cmd)
        }
        fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String> {
            self.master_writer()
        }
        fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
            self.master_reader()
        }
    }

    mock! {
        pub ChildM {
            fn kill(self: Box<Self>) -> Result<(), String>;
        }
    }

    impl Child for MockChildM {
        fn kill(self: Box<Self>) -> Result<(), String> {
            self.kill()
        }
    }

    mock! {
        pub PtySystemM {
            fn openpty(&self, size: portable_pty::PtySize) -> Result<Box<dyn PtyPair>, String>;
        }
    }

    impl PtySystem for MockPtySystemM {
        fn openpty(&self, size: portable_pty::PtySize) -> Result<Box<dyn PtyPair>, String> {
            self.openpty(size)
        }
    }

    mock! {
        pub SshChannelM {
            fn request_pty(&mut self, term: &str, cols: u16, rows: u16) -> Result<(), String>;
            fn shell(&mut self) -> Result<(), String>;
            fn tcp_stream(&self) -> Box<dyn StreamIO>;
        }
    }

    impl Read for MockSshChannelM {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }

    impl Write for MockSshChannelM {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl SshChannel for MockSshChannelM {
        fn request_pty(&mut self, term: &str, cols: u16, rows: u16) -> Result<(), String> {
            self.request_pty(term, cols, rows)
        }
        fn shell(&mut self) -> Result<(), String> {
            self.shell()
        }
        fn tcp_stream(&self) -> Box<dyn StreamIO> {
            self.tcp_stream()
        }
    }

    mock! {
        pub SshBackendM {
            fn connect(
                &self,
                host: &str,
                port: u16,
                auth: &SSHAuth,
                username: &str,
            ) -> Result<Box<dyn SshChannel + Send>, String>;
        }
    }

    impl SshBackend for MockSshBackendM {
        fn connect(
            &self,
            host: &str,
            port: u16,
            auth: &SSHAuth,
            username: &str,
        ) -> Result<Box<dyn SshChannel + Send>, String> {
            self.connect(host, port, auth, username)
        }
    }

    #[derive(Clone)]
    pub struct TestAppBackend {
        pub emit_result: Result<(), String>,
    }

    impl Default for TestAppBackend {
        fn default() -> Self {
            Self {
                emit_result: Ok(()),
            }
        }
    }

    impl AppBackend for TestAppBackend {
        fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String> {
            let _ = event;
            let _ = payload;
            self.emit_result.clone()
        }
        fn spawn(&self, _f: Box<dyn FnOnce() + Send>) {
        }
    }

    #[test]
    fn create_local_with_default_config_creates_session_with_is_connected_true() {
        let mut mock_pty_system = MockPtySystemM::new();

        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig { shell: None, cwd: None };
        let result = manager.create_local(config, mock_backend);

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        assert!(info.name.contains("bash") || info.name.contains("sh"));
    }

    #[test]
    fn create_local_with_custom_shell_session_name_contains_shell_name() {
        let mut mock_pty_system = MockPtySystemM::new();

        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig {
            shell: Some("/usr/bin/zsh".to_string()),
            cwd: None,
        };
        let result = manager.create_local(config, mock_backend);

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.name.contains("zsh"));
    }

    #[test]
    fn create_local_with_custom_cwd_session_has_correct_cwd() {
        let mut mock_pty_system = MockPtySystemM::new();

        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig {
            shell: None,
            cwd: Some("/tmp".to_string()),
        };
        let result = manager.create_local(config, mock_backend);

        assert!(result.is_ok());
        let info = result.unwrap();
        match info.session_type {
            SessionType::Local { shell: _, cwd } => {
                assert_eq!(cwd, "/tmp");
            }
            _ => panic!("Expected Local session type"),
        }
    }

    #[test]
    fn create_local_when_pty_open_fails_returns_err() {
        let mut mock_pty_system = MockPtySystemM::new();

        mock_pty_system.expect_openpty()
            .returning(|_| Err("PTY open failed".to_string()));

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig { shell: None, cwd: None };
        let result = manager.create_local(config, mock_backend);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PTY open failed");
    }

    // ===== Tests for write, close, list methods =====

    #[test]
    fn test_write_nonexistent_session_returns_err() {
        let mut manager = SessionManager::new();
        let result = manager.write(999, b"test");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session not found");
    }

    #[test]
    fn test_write_to_local_session_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig { shell: None, cwd: None };
        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok());

        let info = result.unwrap();
        let write_result = manager.write(info.id, b"test data");
        assert!(write_result.is_ok());
    }

    #[test]
    fn test_close_nonexistent_session_returns_ok() {
        let mut manager = SessionManager::new();
        let result = manager.close(999);
        // Current implementation returns Ok, not Err
        assert!(result.is_ok());
    }

    #[test]
    fn test_close_existing_session_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig { shell: None, cwd: None };
        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok());

        let close_result = manager.close(result.unwrap().id);
        assert!(close_result.is_ok());
    }

    #[test]
    fn test_list_returns_all_session_infos() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig { shell: None, cwd: None };
        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok());

        let info = result.unwrap();
        manager.close(info.id).unwrap();

        let sessions = manager.list();
        assert!(sessions.iter().find(|s| s.id == info.id).is_none());
    }

    #[test]
    fn test_list_empty_manager_returns_empty_vec() {
        let manager = SessionManager::new();
        let sessions = manager.list();
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_list_with_sessions_returns_correct_sessions() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system.expect_openpty()
            .returning(|_| {
                let mut pair = MockPtyPairM::new();
                pair.expect_spawn()
                    .returning(|_| Ok(Box::new(MockChildM::new())));
                pair.expect_master_writer()
                    .returning(|| Ok(Box::new(MockWrite)));
                pair.expect_master_reader()
                    .returning(|| Ok(Box::new(MockReadReturningZero)));
                Ok(Box::new(pair))
            });

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(SshBackendImpl::new()),
        };

        let config = LocalSessionConfig { shell: None, cwd: None };
        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok());

        let sessions = manager.list();
        assert_eq!(sessions.len(), 1);
    }

    // ===== Tests for resize method =====

    #[test]
    fn test_resize_returns_ok() {
        let mut manager = SessionManager::new();
        let result = manager.resize(0, 24, 80);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resize_nonexistent_session_returns_ok() {
        let mut manager = SessionManager::new();
        let result = manager.resize(999, 24, 80);
        assert!(result.is_ok());
    }

    // ===== Tests for create_ssh method =====

    #[test]
    fn create_ssh_password_success() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect()
            .returning(|_, _, _, _| Ok(Box::new(MockSshChannelM::new()) as Box<dyn SshChannel + Send>));

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let config = SSHSessionConfig {
            host: "localhost".to_string(),
            port: 22,
            username: "testuser".to_string(),
            auth: SSHAuth::Password { password: "testpass".to_string() },
        };

        let result = manager.create_ssh(config, mock_backend);

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        assert_eq!(info.name, "SSH testuser@localhost");
        match info.session_type {
            SessionType::Ssh { host, port, user } => {
                assert_eq!(host, "localhost");
                assert_eq!(port, 22);
                assert_eq!(user, "testuser");
            }
            _ => panic!("Expected SSH session type"),
        }
    }

    #[test]
    fn create_ssh_keyfile_success() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect()
            .returning(|_, _, _, _| Ok(Box::new(MockSshChannelM::new()) as Box<dyn SshChannel + Send>));

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let config = SSHSessionConfig {
            host: "example.com".to_string(),
            port: 2222,
            username: "admin".to_string(),
            auth: SSHAuth::KeyFile {
                key_file: "/home/user/.ssh/id_rsa".to_string(),
                passphrase: Some("passphrase".to_string()),
            },
        };

        let result = manager.create_ssh(config, mock_backend);

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        assert_eq!(info.name, "SSH admin@example.com");
        match info.session_type {
            SessionType::Ssh { host, port, user } => {
                assert_eq!(host, "example.com");
                assert_eq!(port, 2222);
                assert_eq!(user, "admin");
            }
            _ => panic!("Expected SSH session type"),
        }
    }

    #[test]
    fn create_ssh_connection_error() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect()
            .returning(|_, _, _, _| Err("Failed to connect".to_string()));

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let config = SSHSessionConfig {
            host: "invalid-host".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: SSHAuth::Password { password: "pass".to_string() },
        };

        let result = manager.create_ssh(config, mock_backend);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Failed to connect");
    }

    #[test]
    fn create_ssh_auth_error() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect()
            .returning(|_, _, _, _| Err("SSH auth failed".to_string()));

        let mock_backend = TestAppBackend::default();

        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let config = SSHSessionConfig {
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: SSHAuth::KeyFile {
                key_file: "/path/to/bad/key".to_string(),
                passphrase: None,
            },
        };

        let result = manager.create_ssh(config, mock_backend);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "SSH auth failed");
    }
}
