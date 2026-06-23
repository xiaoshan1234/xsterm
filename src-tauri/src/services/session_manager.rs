use std::collections::HashMap;
use std::io::Write;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{LocalSession, LocalSessionHandles, NativePtySystem, PtySystem};
use crate::infrastructure::ssh::{create_ssh_session as infra_create_ssh, SshBackend, SshBackendImpl, SshSessionWrapper};
use crate::tmux::session::{create_ssh_tmux_session, create_tmux_session, TmuxSession, TmuxSessionHandles};
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo, SshTmuxSessionConfig, TmuxSessionConfig};
use crate::tmux::commands::{resize_pane, send_keys};
use crate::services::local_session::create_local_session;

/// Internal enum representing an active session, either local, SSH, or tmux.
enum Session {
    Local(LocalSession, LocalSessionHandles),
    Ssh(SshSessionWrapper),
    Tmux(TmuxSession, #[allow(dead_code)] TmuxSessionHandles),
    SshTmux(TmuxSession),
}

impl Session {
    fn info(&self) -> &SessionInfo {
        match self {
            Session::Local(s, _) => &s.info,
            Session::Ssh(s) => &s.info,
            Session::Tmux(s, _) => &s.info,
            Session::SshTmux(s) => &s.info,
        }
    }
}

/// Manages the lifecycle of all terminal sessions.
pub struct SessionManager {
    sessions: HashMap<u32, Session>,
    next_id: u32,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Box<dyn SshBackend>,
}

impl SessionManager {
    /// Create a new session manager with default platform backends.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(NativePtySystem::new()),
            ssh_backend: Box::new(SshBackendImpl::new()),
        }
    }

    /// Create a new local shell session.
    pub fn create_local(
        &mut self,
        config: LocalSessionConfig,
        backend: impl AppBackend + 'static,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();

        let (session, handles) = create_local_session(
            self.pty_system.as_ref(),
            config,
            backend,
            id,
        )?;

        let info = session.info.clone();
        self.sessions.insert(id, Session::Local(session, handles));
        Ok(info)
    }

    /// Create a new tmux control mode session.
    pub fn create_tmux(
        &mut self,
        config: TmuxSessionConfig,
        backend: impl AppBackend + 'static,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();

        let (session, handles) = create_tmux_session(
            self.pty_system.as_ref(),
            config,
            backend,
            id,
        )?;

        let info = session.info.clone();
        self.sessions.insert(id, Session::Tmux(session, handles));
        Ok(info)
    }

    /// Create a new SSH session.
    pub fn create_ssh(
        &mut self,
        config: SSHSessionConfig,
        backend: impl AppBackend + 'static,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();

        let wrapper = infra_create_ssh(
            self.ssh_backend.as_ref(),
            config,
            backend,
            id,
        )?;

        let info = wrapper.info.clone();
        self.sessions.insert(id, Session::Ssh(wrapper));
        Ok(info)
    }

    pub fn create_ssh_tmux(
        &mut self,
        config: SshTmuxSessionConfig,
        backend: impl AppBackend + 'static,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();

        let session = create_ssh_tmux_session(
            self.ssh_backend.as_ref(),
            config,
            backend,
            id,
        )?;

        let info = session.info.clone();
        self.sessions.insert(id, Session::SshTmux(session));
        Ok(info)
    }

    /// Write input data to the session with the given `id`.
    pub fn write(&mut self, id: u32, data: &[u8]) -> Result<(), String> {
        match self.sessions.get_mut(&id) {
            Some(Session::Local(s, _)) => {
                s.writer.write_all(data).map_err(|e| e.to_string())?;
                s.writer.flush().map_err(|e| e.to_string())?;
                Ok(())
            }
            Some(Session::Ssh(s)) => {
                s.write_tx.send(data.to_vec())
                    .map_err(|_| format!("SSH channel closed for session {}", id))?;
                Ok(())
            }
            Some(Session::Tmux(_, _)) | Some(Session::SshTmux(_)) => Err(format!(
                "Session {} is a tmux session; use write_tmux_command instead",
                id
            )),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Resize the PTY of the session with the given `id`.
    pub fn resize(&mut self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        match self.sessions.get(&id) {
            Some(Session::Local(_, handles)) => handles.resize(rows, cols),
            Some(Session::Ssh(_)) => Ok(()),
            Some(Session::Tmux(_, _)) | Some(Session::SshTmux(_)) => Err(format!(
                "Session {} is a tmux session; use resize_tmux_pane instead",
                id
            )),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Write a tmux control mode command to the session with the given `id`.
    pub fn write_tmux_command(&mut self, id: u32, command: &str) -> Result<(), String> {
        match self.sessions.get_mut(&id) {
            Some(Session::Tmux(session, _)) | Some(Session::SshTmux(session)) => {
                session.write_command(command)
            }
            Some(_) => Err(format!("Session {} is not a tmux session", id)),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Send a tmux resize-pane command for the given pane.
    pub fn resize_tmux_pane(
        &mut self,
        id: u32,
        pane_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), String> {
        let command = resize_pane(pane_id, rows, cols);
        self.write_tmux_command(id, &command)
    }

    /// Send a tmux send-keys command for the given pane.
    pub fn send_keys_to_tmux_pane(
        &mut self,
        id: u32,
        pane_id: &str,
        keys: &str,
    ) -> Result<(), String> {
        let command = send_keys(pane_id, keys);
        self.write_tmux_command(id, &command)
    }

    pub fn capture_tmux_pane(
        &mut self,
        id: u32,
        pane_id: &str,
    ) -> Result<(), String> {
        match self.sessions.get(&id) {
            Some(Session::Tmux(session, _)) | Some(Session::SshTmux(session)) => {
                const CAPTURE_HISTORY_LINES: usize = 250;
                session.request_capture_pane(pane_id, CAPTURE_HISTORY_LINES)
            }
            Some(_) => Err(format!("Session {} is not a tmux session", id)),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Close and remove the session with the given `id`.
    pub fn close(&mut self, id: u32) -> Result<(), String> {
        self.sessions.remove(&id);
        Ok(())
    }

    /// Return metadata for all active sessions.
    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info().clone()).collect()
    }

    /// Allocate the next unique session id.
    fn allocate_session_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::boxed_local)]

    use super::*;
    use crate::infrastructure::pty::{Child, PtyPair};
    use crate::infrastructure::ssh::{SshBackend, SshChannel, SshConnectResult};
    use crate::models::session::{SSHAuth, SessionType};
    use mockall::{mock, predicate::*};
    use std::io::{Read, Write};
    use std::sync::mpsc as sync_mpsc;

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
            fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
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
        fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
            self.resize(rows, cols)
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
        fn try_wait(&mut self) -> Result<Option<portable_pty::ExitStatus>, String> {
            Ok(None)
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
        pub SshChannelM {}
    }

    impl SshChannel for MockSshChannelM {}

    mock! {
        pub SshBackendM {
            fn connect(
                &self,
                host: &str,
                port: u16,
                auth: &SSHAuth,
                username: &str,
            ) -> Result<SshConnectResult, String>;
            fn connect_exec(
                &self,
                host: &str,
                port: u16,
                auth: &SSHAuth,
                username: &str,
                command: &str,
            ) -> Result<SshConnectResult, String>;
        }
    }

    impl SshBackend for MockSshBackendM {
        fn connect(
            &self,
            host: &str,
            port: u16,
            auth: &SSHAuth,
            username: &str,
        ) -> Result<SshConnectResult, String> {
            self.connect(host, port, auth, username)
        }

        fn connect_exec(
            &self,
            host: &str,
            port: u16,
            auth: &SSHAuth,
            username: &str,
            command: &str,
        ) -> Result<SshConnectResult, String> {
            self.connect_exec(host, port, auth, username, command)
        }
    }

    #[derive(Clone)]
    pub struct TestAppBackend {
        pub emit_result: Result<(), String>,
    }

    impl Default for TestAppBackend {
        fn default() -> Self {
            Self { emit_result: Ok(()) }
        }
    }

    impl AppBackend for TestAppBackend {
        fn emit(&self, _event: &str, _payload: &[u8]) -> Result<(), String> {
            self.emit_result.clone()
        }
        fn spawn(&self, _f: Box<dyn FnOnce() + Send>) {}
    }

    fn build_mock_manager(mock_pty_system: MockPtySystemM) -> SessionManager {
        SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(MockSshBackendM::new()),
        }
    }

    fn expect_openpty(mock_pty_system: &mut MockPtySystemM) {
        mock_pty_system.expect_openpty().returning(|_| {
            let mut pair = MockPtyPairM::new();
            pair.expect_spawn().returning(|_| Ok(Box::new(MockChildM::new())));
            pair.expect_master_writer().returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader().returning(|| Ok(Box::new(MockReadReturningZero)));
            pair.expect_resize().returning(|_, _| Ok(()));
            Ok(Box::new(pair))
        });
    }

    #[test]
    fn create_local_with_default_config_creates_session_with_is_connected_true() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        assert!(info.name.contains("bash") || info.name.contains("sh"));
    }

    #[test]
    fn create_local_with_custom_shell_session_name_contains_shell_name() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig { shell: Some("/usr/bin/zsh".to_string()), cwd: None, args: None },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.name.contains("zsh"));
    }

    #[test]
    fn create_local_with_custom_cwd_session_has_correct_cwd() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig { shell: None, cwd: Some("/tmp".to_string()), args: None },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        match info.session_type {
            SessionType::Local { cwd, .. } => assert_eq!(cwd, "/tmp"),
            _ => panic!("Expected Local session type"),
        }
    }

    #[test]
    fn create_local_when_pty_open_fails_returns_err() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system.expect_openpty().returning(|_| Err("PTY open failed".to_string()));
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PTY open failed");
    }

    #[test]
    fn test_write_nonexistent_session_returns_err() {
        let mut manager = SessionManager::new();
        let result = manager.write(999, b"test");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session 999 not found");
    }

    #[test]
    fn test_write_to_local_session_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);
        assert!(result.is_ok());

        let info = result.unwrap();
        let write_result = manager.write(info.id, b"test data");
        assert!(write_result.is_ok());
    }

    #[test]
    fn test_close_nonexistent_session_returns_ok() {
        let mut manager = SessionManager::new();
        let result = manager.close(999);
        assert!(result.is_ok());
    }

    #[test]
    fn test_close_existing_session_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);
        assert!(result.is_ok());

        let close_result = manager.close(result.unwrap().id);
        assert!(close_result.is_ok());
    }

    #[test]
    fn test_list_returns_all_session_infos() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);
        assert!(result.is_ok());

        let info = result.unwrap();
        manager.close(info.id).unwrap();

        assert!(manager.list().iter().find(|s| s.id == info.id).is_none());
    }

    #[test]
    fn test_list_empty_manager_returns_empty_vec() {
        let manager = SessionManager::new();
        assert!(manager.list().is_empty());
    }

    #[test]
    fn test_list_with_sessions_returns_correct_sessions() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);
        assert!(result.is_ok());

        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn test_resize_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None, args: None }, mock_backend);
        assert!(result.is_ok());
        let info = result.unwrap();

        let result = manager.resize(info.id, 24, 80);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resize_nonexistent_session_returns_ok() {
        let mut manager = SessionManager::new();
        let result = manager.resize(999, 24, 80);
        assert!(result.is_err());
    }

    #[test]
    fn create_ssh_password_success() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_, _, _, _| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
            })
        });

        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                host: "localhost".to_string(),
                port: 22,
                username: "testuser".to_string(),
                auth: SSHAuth::Password { password: "testpass".to_string() },
            },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        assert_eq!(info.name, "testuser@localhost");
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
        mock_ssh_backend.expect_connect().returning(|_, _, _, _| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
            })
        });

        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                host: "example.com".to_string(),
                port: 2222,
                username: "admin".to_string(),
                auth: SSHAuth::KeyFile {
                    key_file: "/home/user/.ssh/id_rsa".to_string(),
                    passphrase: Some("passphrase".to_string()),
                },
            },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        assert_eq!(info.name, "admin@example.com");
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
        mock_ssh_backend.expect_connect().returning(|_, _, _, _| Err("Failed to connect".to_string()));
        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                host: "invalid-host".to_string(),
                port: 22,
                username: "user".to_string(),
                auth: SSHAuth::Password { password: "pass".to_string() },
            },
            mock_backend,
        );

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Failed to connect");
    }

    #[test]
    fn create_ssh_auth_error() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_, _, _, _| Err("SSH auth failed".to_string()));
        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                host: "example.com".to_string(),
                port: 22,
                username: "user".to_string(),
                auth: SSHAuth::KeyFile {
                    key_file: "/path/to/bad/key".to_string(),
                    passphrase: None,
                },
            },
            mock_backend,
        );

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "SSH auth failed");
    }
}
