use std::collections::HashMap;
use std::io::Write;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{LocalSession, LocalSessionHandles, NativePtySystem, PtySystem};
use crate::infrastructure::ssh::{create_ssh_session as infra_create_ssh, SshBackend, SshBackendImpl};
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo, SshSessionWrapper};
use crate::services::local_session::create_local_session;

enum Session {
    Local(LocalSession, LocalSessionHandles),
    Ssh(SshSessionWrapper),
}

impl Session {
    fn info(&self) -> &SessionInfo {
        match self {
            Session::Local(s, _) => &s.info,
            Session::Ssh(s) => &s.info,
        }
    }
}

pub struct SessionManager {
    sessions: HashMap<u32, Session>,
    next_id: u32,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Box<dyn SshBackend>,
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

    pub fn create_local(
        &mut self,
        config: LocalSessionConfig,
        backend: impl AppBackend + 'static,
    ) -> Result<SessionInfo, String> {
        let id = self.next_id;
        self.next_id += 1;

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

    pub fn create_ssh(
        &mut self,
        config: SSHSessionConfig,
        backend: impl AppBackend + 'static,
    ) -> Result<SessionInfo, String> {
        let id = self.next_id;
        self.next_id += 1;

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

    pub fn write(&mut self, id: u32, data: &[u8]) -> Result<(), String> {
        match self.sessions.get_mut(&id) {
            Some(Session::Local(s, _)) => {
                s.writer.write_all(data).map_err(|e| e.to_string())?;
                s.writer.flush().map_err(|e| e.to_string())?;
                Ok(())
            }
            Some(Session::Ssh(s)) => {
                s.write_tx.send(data.to_vec()).map_err(|_| "SSH channel closed".to_string())?;
                Ok(())
            }
            None => Err("Session not found".to_string()),
        }
    }

    pub fn resize(&mut self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        match self.sessions.get(&id) {
            Some(Session::Local(_, handles)) => handles.resize(rows, cols),
            Some(Session::Ssh(_)) => Ok(()),
            None => Err("Session not found".to_string()),
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::pty::{Child, PtyPair};
    use crate::infrastructure::ssh::{SshBackend, SshChannel};
    use crate::models::session::{SSHAuth, SessionType, SshConnectResult};
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

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);

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
            LocalSessionConfig { shell: Some("/usr/bin/zsh".to_string()), cwd: None },
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
            LocalSessionConfig { shell: None, cwd: Some("/tmp".to_string()) },
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

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PTY open failed");
    }

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
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);
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

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);
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

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);
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

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);
        assert!(result.is_ok());

        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn test_resize_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { shell: None, cwd: None }, mock_backend);
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
