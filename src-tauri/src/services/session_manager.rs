use std::collections::HashMap;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{NativePtySystem, PtySystem};
use crate::infrastructure::session_backend::SessionBackend;
use crate::infrastructure::ssh::{upload_file_via_ssh, SshBackend, SshBackendImpl, SshSessionWrapper};
use crate::services::ssh_session::create_ssh_session as infra_create_ssh;
use crate::models::session::{build_remote_image_path, LocalSessionConfig, SSHSessionConfig, SessionInfo};
use crate::services::local_session::create_local_session;

/// Active session handle held by [`SessionManager`].
///
/// `Pty` holds a type-erased `Box<dyn SessionBackend>`; `Ssh` holds a
/// concrete `Box<SshSessionWrapper>` so `get_ssh_config` can read the
/// original `SSHSessionConfig` (which the trait does not expose). Both still
/// dispatch via `SessionBackend` (the concrete box derefs to `SshSessionWrapper`,
/// which implements the trait).
enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSessionWrapper>),
}

impl ActiveSession {
    /// Borrow the underlying backend as a trait object.
    fn backend(&self) -> &(dyn SessionBackend + '_) {
        match self {
            ActiveSession::Pty(b) => &**b,
            ActiveSession::Ssh(b) => &**b,
        }
    }

    /// Mutably borrow the underlying backend as a trait object.
    fn backend_mut(&mut self) -> &mut (dyn SessionBackend + '_) {
        match self {
            ActiveSession::Pty(b) => &mut **b,
            ActiveSession::Ssh(b) => &mut **b,
        }
    }

    /// Consume the variant and return the owned boxed backend (coerced to a
    /// type-erased `Box<dyn SessionBackend + Send>`).
    fn into_backend(self) -> Box<dyn SessionBackend + Send> {
        match self {
            ActiveSession::Pty(b) => b,
            ActiveSession::Ssh(b) => b,
        }
    }

    /// Build a complete [`SessionInfo`] (including `capabilities`) from this
    /// session's metadata.
    fn to_session_info(&self) -> SessionInfo {
        let mut info = self.backend().info().clone();
        info.capabilities = self.backend().capabilities().clone();
        info
    }
}

/// Manages the lifecycle of all terminal sessions.
pub struct SessionManager {
    sessions: HashMap<u32, ActiveSession>,
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

        let session = create_local_session(
            self.pty_system.as_ref(),
            config,
            backend,
            id,
        )?;

        Ok(self.insert_session(id, ActiveSession::Pty(Box::new(session))))
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

        Ok(self.insert_session(id, ActiveSession::Ssh(Box::new(wrapper))))
    }

    /// Insert a newly created session into the manager and return its metadata
    /// (with `capabilities` populated from the backend).
    fn insert_session(&mut self, id: u32, session: ActiveSession) -> SessionInfo {
        let info = session.to_session_info();
        self.sessions.insert(id, session);
        info
    }

    /// Return a clone of the SSH config for the session with the given `id`.
    pub fn get_ssh_config(&self,
        id: u32,
    ) -> Result<SSHSessionConfig, String> {
        match self.sessions.get(&id) {
            Some(ActiveSession::Ssh(ssh)) => Ok(ssh.config.clone()),
            Some(_) => Err(format!("Session {} is not an SSH session", id)),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Write input data to an existing session.
    pub fn write(&mut self, id: u32, data: &[u8]) -> Result<(), String> {
        match self.sessions.get_mut(&id) {
            Some(session) => session.backend_mut().write(data),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Resize the PTY of the session with the given `id`.
    pub fn resize(&mut self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        match self.sessions.get_mut(&id) {
            Some(session) => session.backend_mut().resize(rows, cols),
            None => Err(format!("Session {} not found", id)),
        }
    }

    /// Upload an image file to the SSH server for the given session and return
    /// the remote path where it was stored.
    pub fn upload_image(
        &mut self,
        id: u32,
        filename: &str,
        data: Vec<u8>,
    ) -> Result<String, String> {
        let config = self.get_ssh_config(id)?;
        let remote_path = build_remote_image_path(filename)?;

        tracing::info!(
            "Uploading image to SSH session {}: {} bytes to {}",
            id,
            data.len(),
            remote_path
        );

        let remote_path_clone = remote_path.clone();
        let config_clone = config.clone();
        drop(config);

        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| format!("Failed to create runtime for image upload: {}", e))?;
        rt.block_on(upload_file_via_ssh(&config_clone, &remote_path_clone, data))?;

        Ok(remote_path)
    }

    /// Close and remove the session with the given `id`.
    pub fn close(&mut self, id: u32) -> Result<(), String> {
        if let Some(session) = self.sessions.remove(&id) {
            session.into_backend().close()?;
        }
        Ok(())
    }

    /// Return metadata (including `capabilities`) for all active sessions.
    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.to_session_info()).collect()
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
    use crate::models::capabilities::CapabilityFlags;
    use crate::models::session::{SSHAuth, SessionType};
    use mockall::{mock, predicate::*};
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::mpsc as sync_mpsc;
    use std::sync::{Arc, Mutex};

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
                config: &SSHSessionConfig,
            ) -> Result<SshConnectResult, String>;
        }
    }

    impl SshBackend for MockSshBackendM {
        fn connect(
            &self,
            config: &SSHSessionConfig,
        ) -> Result<SshConnectResult, String> {
            self.connect(config)
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

    /// Hand-rolled `SessionBackend` for trait-dispatch smoke tests. Records
    /// every call via atomic counters and mutex-backed payloads so tests can
    /// assert lifecycle behaviour without spawning a real PTY or opening SSH.
    struct MockBackend {
        pub info: SessionInfo,
        pub capabilities: CapabilityFlags,
        pub write_called: Arc<AtomicUsize>,
        pub write_data: Arc<Mutex<Vec<u8>>>,
        pub resize_called: Arc<AtomicUsize>,
        pub resize_dims: Arc<Mutex<Vec<(u16, u16)>>>,
        pub close_called: Arc<AtomicBool>,
    }

    impl SessionBackend for MockBackend {
        fn info(&self) -> &SessionInfo {
            &self.info
        }
        fn capabilities(&self) -> &CapabilityFlags {
            &self.capabilities
        }
        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            self.write_called.fetch_add(1, Ordering::SeqCst);
            self.write_data
                .lock()
                .unwrap()
                .extend_from_slice(data);
            Ok(())
        }
        fn resize(&mut self, rows: u16, cols: u16) -> Result<(), String> {
            self.resize_called.fetch_add(1, Ordering::SeqCst);
            self.resize_dims.lock().unwrap().push((rows, cols));
            Ok(())
        }
        fn close(self: Box<Self>) -> Result<(), String> {
            self.close_called.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn build_mock_backend() -> MockBackend {
        MockBackend {
            info: SessionInfo {
                id: 999,
                name: "mock".to_string(),
                session_type: SessionType::Local {
                    shell: "/bin/sh".to_string(),
                    cwd: "/".to_string(),
                },
                is_connected: true,
                capabilities: CapabilityFlags::for_local(),
            },
            capabilities: CapabilityFlags::for_local(),
            write_called: Arc::new(AtomicUsize::new(0)),
            write_data: Arc::new(Mutex::new(Vec::new())),
            resize_called: Arc::new(AtomicUsize::new(0)),
            resize_dims: Arc::new(Mutex::new(Vec::new())),
            close_called: Arc::new(AtomicBool::new(false)),
        }
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
            pair.expect_spawn().returning(|_| {
                let mut child = MockChildM::new();
                child.expect_kill().times(0..).returning(|| Ok(()));
                Ok(Box::new(child))
            });
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

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);

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
            LocalSessionConfig { name: None, shell: Some("/usr/bin/zsh".to_string()), cwd: None, args: None, env_config: None, ..Default::default() },
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
            LocalSessionConfig { name: None, shell: None, cwd: Some("/tmp".to_string()), args: None, env_config: None, ..Default::default() },
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
    fn create_local_with_explicit_name_uses_config_name() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig {
                name: Some("My Dev Shell".to_string()),
                shell: Some("/usr/bin/zsh".to_string()),
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.name, "My Dev Shell");
    }

    #[test]
    fn create_local_with_empty_name_falls_back_to_shell_basename() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig {
                name: Some("   ".to_string()),
                shell: Some("/usr/bin/zsh".to_string()),
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.name.contains("zsh"));
    }

    #[test]
    fn create_local_when_pty_open_fails_returns_err() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system.expect_openpty().returning(|_| Err("PTY open failed".to_string()));
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);

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

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
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

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
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

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
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

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
        assert!(result.is_ok());

        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn test_resize_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let mut manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
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
        mock_ssh_backend.expect_connect().returning(|_| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
                resize_tx: None,
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
                name: None,
                host: "localhost".to_string(),
                port: 22,
                username: "testuser".to_string(),
                auth: SSHAuth::Password { password: "testpass".to_string() },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
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
    fn create_ssh_with_explicit_name_uses_config_name() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
                resize_tx: None,
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
                name: Some("Production Bastion".to_string()),
                host: "bastion.example.com".to_string(),
                port: 22,
                username: "ops".to_string(),
                auth: SSHAuth::Password { password: "p".to_string() },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
            },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.name, "Production Bastion");
    }

    #[test]
    fn create_ssh_with_empty_name_falls_back_to_user_at_host() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
                resize_tx: None,
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
                name: Some("".to_string()),
                host: "h.example.com".to_string(),
                port: 22,
                username: "alice".to_string(),
                auth: SSHAuth::Password { password: "p".to_string() },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
            },
            mock_backend,
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.name, "alice@h.example.com");
    }

    #[test]
    fn create_ssh_keyfile_success() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
                resize_tx: None,
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
                name: None,
                host: "example.com".to_string(),
                port: 2222,
                username: "admin".to_string(),
                auth: SSHAuth::KeyFile {
                    key_file: "/home/user/.ssh/id_rsa".to_string(),
                    passphrase: Some("passphrase".to_string()),
                },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
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
        mock_ssh_backend.expect_connect().returning(|_| Err("Failed to connect".to_string()));
        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "invalid-host".to_string(),
                port: 22,
                username: "user".to_string(),
                auth: SSHAuth::Password { password: "pass".to_string() },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
            },
            mock_backend,
        );

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Failed to connect");
    }

    #[test]
    fn create_ssh_auth_error() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_| Err("SSH auth failed".to_string()));
        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "example.com".to_string(),
                port: 22,
                username: "user".to_string(),
                auth: SSHAuth::KeyFile {
                    key_file: "/path/to/bad/key".to_string(),
                    passphrase: None,
                },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
            },
            mock_backend,
        );

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "SSH auth failed");
    }

    #[test]
    fn list_returns_session_info_with_capabilities() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);

        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend.expect_connect().returning(|_| {
            let (write_tx, _write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
            Ok(SshConnectResult {
                channel: Box::new(MockSshChannelM::new()),
                write_tx,
                read_rx,
                resize_tx: None,
            })
        });

        let mock_backend = TestAppBackend::default();
        let mut manager = SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        manager.create_local(
            LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() },
            mock_backend.clone(),
        ).expect("local session should be created");

        manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "localhost".to_string(),
                port: 22,
                username: "testuser".to_string(),
                auth: SSHAuth::Password { password: "testpass".to_string() },
                term_type: None,
                initial_rows: None,
                initial_cols: None,
                keepalive_interval: None,
                connection_timeout: None,
                tcp_nodelay: None,
                so_keepalive: None,
                null_packet_keepalive: None,
                charset: None,
                enable_compression: None,
                known_hosts_path: None,
                proxy_jump: None,
            },
            mock_backend,
        ).expect("ssh session should be created");

        let infos = manager.list();
        assert_eq!(infos.len(), 2);

        let local_info = infos
            .iter()
            .find(|i| matches!(i.session_type, SessionType::Local { .. }))
            .expect("local session info should be listed");
        assert!(
            local_info.capabilities.supports_local_echo,
            "local session should advertise supports_local_echo"
        );
        assert!(
            !local_info.capabilities.supports_reconnect,
            "local session should NOT advertise supports_reconnect"
        );

        let ssh_info = infos
            .iter()
            .find(|i| matches!(i.session_type, SessionType::Ssh { .. }))
            .expect("ssh session info should be listed");
        assert!(
            ssh_info.capabilities.supports_reconnect,
            "ssh session should advertise supports_reconnect"
        );
        assert!(
            !ssh_info.capabilities.supports_local_echo,
            "ssh session should NOT advertise supports_local_echo"
        );
    }

    #[test]
    fn mock_backend_lifecycle_records_create_write_resize_close() {
        let backend = build_mock_backend();
        let write_called = Arc::clone(&backend.write_called);
        let write_data = Arc::clone(&backend.write_data);
        let resize_called = Arc::clone(&backend.resize_called);
        let resize_dims = Arc::clone(&backend.resize_dims);
        let close_called = Arc::clone(&backend.close_called);

        let mut manager = build_mock_manager(MockPtySystemM::new());
        manager
            .sessions
            .insert(999, ActiveSession::Pty(Box::new(backend)));

        manager.write(999, b"hello").unwrap();
        assert_eq!(write_called.load(Ordering::SeqCst), 1);
        assert_eq!(*write_data.lock().unwrap(), b"hello".to_vec());

        manager.resize(999, 24, 80).unwrap();
        assert_eq!(resize_called.load(Ordering::SeqCst), 1);
        assert_eq!(*resize_dims.lock().unwrap(), vec![(24, 80)]);

        manager.close(999).unwrap();
        assert!(close_called.load(Ordering::SeqCst));
    }

    #[test]
    fn mock_backend_lifecycle_via_create_session_unified_path() {
        let backend = build_mock_backend();
        let write_called = Arc::clone(&backend.write_called);
        let write_data = Arc::clone(&backend.write_data);
        let resize_called = Arc::clone(&backend.resize_called);
        let resize_dims = Arc::clone(&backend.resize_dims);
        let close_called = Arc::clone(&backend.close_called);

        let mut manager = build_mock_manager(MockPtySystemM::new());
        manager
            .sessions
            .insert(999, ActiveSession::Pty(Box::new(backend)));

        // Unified info path: list() routes through to_session_info, which reads
        // both info() and capabilities() from the trait object.
        let infos = manager.list();
        assert_eq!(infos.len(), 1);
        let listed = &infos[0];
        assert_eq!(listed.id, 999);
        assert_eq!(listed.name, "mock");
        assert!(listed.is_connected);
        assert!(
            listed.capabilities.supports_local_echo,
            "mock backend capabilities should propagate through list()"
        );

        manager.write(999, b"unified").unwrap();
        assert_eq!(write_called.load(Ordering::SeqCst), 1);
        assert_eq!(*write_data.lock().unwrap(), b"unified".to_vec());

        manager.resize(999, 30, 100).unwrap();
        assert_eq!(resize_called.load(Ordering::SeqCst), 1);
        assert_eq!(*resize_dims.lock().unwrap(), vec![(30, 100)]);

        manager.close(999).unwrap();
        assert!(close_called.load(Ordering::SeqCst));
    }
}