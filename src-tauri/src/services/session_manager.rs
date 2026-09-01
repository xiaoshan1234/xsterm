use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use dashmap::DashMap;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{NativePtySystem, PtySystem};
use crate::infrastructure::session_backend::SessionBackend;
use crate::infrastructure::ssh::{upload_file_via_ssh, SshBackend, SshBackendImpl, SshSessionWrapper};
use crate::models::session::{
    build_remote_image_path, LocalSessionConfig, SessionInfo, SessionLoggingConfig, SSHSessionConfig,
};
use crate::services::local_session::create_local_session;
use crate::services::session_log::start_session_logging;
use crate::services::ssh_session::create_ssh_session as infra_create_ssh;

/// Active session handle held by [`SessionManager`].
///
/// `Pty` holds a type-erased `Box<dyn SessionBackend>`; `Ssh` holds a
/// concrete `Box<SshSessionWrapper>` so `get_ssh_config` can read the
/// original `SSHSessionConfig` (which the trait does not expose). Both still
/// dispatch via `SessionBackend` (the concrete box derefs to `SshSessionWrapper`,
/// which implements the trait).
pub(crate) enum ActiveSession {
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
///
/// Concurrency model (Perf 004, see doc/maintenance/perf.md):
/// - Sessions live in a `DashMap<u32, Arc<ActiveSession>>`, so any operation
///   that only needs a single session handle (`write`, `resize`, `info`,
///   `close`) takes a `&self` borrow on the manager and a `DashMap::get` for
///   per-key access — there is no global `Mutex` to acquire.
/// - `next_id` is an `AtomicU32` since it is monotonically incremented and
///   must not block other operations.
/// - `create` and `close` are still the only mutating entry points; both
///   touch the DashMap and (for `close`) need exclusive ownership of the
///   inner backend via `Arc::try_unwrap`. All other ops read.
pub struct SessionManager {
    sessions: DashMap<u32, Arc<ActiveSession>>,
    next_id: AtomicU32,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Box<dyn SshBackend>,
}

impl SessionManager {
    /// Create a new session manager with default platform backends.
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(NativePtySystem::new()),
            ssh_backend: Box::new(SshBackendImpl::new()),
        }
    }

    /// Create a new local shell session.
    pub fn create_local(
        &self,
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

        // Acknowledge the session's logging configuration. The wiring of the
        // output stream into the log writer is deferred to a follow-up wave;
        // for now the call emits a tracing event when logging is enabled.
        let logging_config = SessionLoggingConfig::default();
        if let Err(e) = start_session_logging(id, &logging_config) {
            tracing::warn!("Failed to start session logging for session {}: {}", id, e);
        }

        Ok(self.insert_session(id, ActiveSession::Pty(Box::new(session))))
    }

    /// Create a new SSH session.
    pub fn create_ssh(
        &self,
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

        // Acknowledge the session's logging configuration. See `create_local`
        // for the rationale on the deferred wiring.
        let logging_config = SessionLoggingConfig::default();
        if let Err(e) = start_session_logging(id, &logging_config) {
            tracing::warn!("Failed to start session logging for session {}: {}", id, e);
        }

        Ok(self.insert_session(id, ActiveSession::Ssh(Box::new(wrapper))))
    }

    /// Insert a newly created session into the manager and return its metadata
    /// (with `capabilities` populated from the backend).
    fn insert_session(&self, id: u32, session: ActiveSession) -> SessionInfo {
        let info = session.to_session_info();
        self.sessions.insert(id, Arc::new(session));
        info
    }

    /// Look up a single session by id without holding any global lock. Returns
    /// a cheaply-cloned `Arc<ActiveSession>` so the caller can dispatch
    /// `write` / `resize` / `close` independently of the registry.
    pub fn get(&self, id: u32) -> Result<Arc<ActiveSession>, String> {
        self.sessions
            .get(&id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| format!("Session {} not found", id))
    }

    /// Return a clone of the SSH config for the session with the given `id`.
    pub fn get_ssh_config(&self, id: u32) -> Result<SSHSessionConfig, String> {
        match self.get(id)?.as_ref() {
            ActiveSession::Ssh(ssh) => Ok(ssh.config.clone()),
            _ => Err(format!("Session {} is not an SSH session", id)),
        }
    }

    /// Write input data to an existing session. Does not acquire any global
    /// lock — only the per-session DashMap entry is touched, then dispatched
    /// to the backend's shared `write(&self, ...)` impl.
    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let session = self.get(id)?;
        session.backend().write(data)
    }

    /// Resize the PTY of the session with the given `id`.
    pub fn resize(&self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        let session = self.get(id)?;
        session.backend().resize(rows, cols)
    }

    /// Upload an image file to the SSH server for the given session and return
    /// the remote path where it was stored.
    pub fn upload_image(
        &self,
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
    ///
    /// Idempotent: closing a non-existent session returns Ok (matches the
    /// historical `HashMap::remove` semantics, and avoids spurious error
    /// logs when the frontend tears down a session that already died).
    ///
    /// Requires exclusive ownership of the inner `Arc<ActiveSession>` so the
    /// backend's `close(self: Box<Self>)` can consume the boxed dyn object.
    /// If anything else still holds a clone of the Arc we surface that as an
    /// error instead of silently leaking.
    pub fn close(&self, id: u32) -> Result<(), String> {
        let Some((_, arc)) = self.sessions.remove(&id) else {
            return Ok(());
        };
        let session = Arc::try_unwrap(arc)
            .map_err(|_| format!("Session {id} is still referenced; close aborted"))?;
        session.into_backend().close()
    }

    /// Return metadata (including `capabilities`) for all active sessions.
    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions
            .iter()
            .map(|entry| entry.value().to_session_info())
            .collect()
    }

    /// Allocate the next unique session id.
    fn allocate_session_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
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
    use crate::models::session::SessionType;
    use mockall::{mock, predicate::*};
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
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
        fn emit(&self, _event: &str, _payload: &serde_json::Value) -> Result<(), String> {
            self.emit_result.clone()
        }
        fn emit_binary(&self, _bytes: Vec<u8>) -> Result<(), String> {
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
        fn write(&self, data: &[u8]) -> Result<(), String> {
            self.write_called.fetch_add(1, Ordering::SeqCst);
            self.write_data
                .lock()
                .unwrap()
                .extend_from_slice(data);
            Ok(())
        }
        fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
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
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
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
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PTY open failed");
    }

    #[test]
    fn test_write_nonexistent_session_returns_err() {
        let manager = SessionManager::new();
        let result = manager.write(999, b"test");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session 999 not found");
    }

    #[test]
    fn test_write_to_local_session_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
        assert!(result.is_ok());

        let info = result.unwrap();
        let write_result = manager.write(info.id, b"test data");
        assert!(write_result.is_ok());
    }

    #[test]
    fn test_close_nonexistent_session_returns_ok() {
        let manager = SessionManager::new();
        let result = manager.close(999);
        assert!(result.is_ok());
    }

    #[test]
    fn test_close_existing_session_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

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
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
        assert!(result.is_ok());

        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn test_resize_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(LocalSessionConfig { name: None, shell: None, cwd: None, args: None, env_config: None, ..Default::default() }, mock_backend);
        assert!(result.is_ok());
        let info = result.unwrap();

        let result = manager.resize(info.id, 24, 80);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resize_nonexistent_session_returns_ok() {
        let manager = SessionManager::new();
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "localhost".to_string(),
                port: 22,
                username: "testuser".to_string(),
                auth_type: "password".to_string(),
                password: Some("testpass".to_string()),
                key_file: None,
                passphrase: None,
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: Some("Production Bastion".to_string()),
                host: "bastion.example.com".to_string(),
                port: 22,
                username: "ops".to_string(),
                auth_type: "password".to_string(),
                password: Some("p".to_string()),
                key_file: None,
                passphrase: None,
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: Some("".to_string()),
                host: "h.example.com".to_string(),
                port: 22,
                username: "alice".to_string(),
                auth_type: "password".to_string(),
                password: Some("p".to_string()),
                key_file: None,
                passphrase: None,
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "example.com".to_string(),
                port: 2222,
                username: "admin".to_string(),
                auth_type: "key".to_string(),
                password: None,
                key_file: Some("/home/user/.ssh/id_rsa".to_string()),
                passphrase: Some("passphrase".to_string()),
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "invalid-host".to_string(),
                port: 22,
                username: "user".to_string(),
                auth_type: "password".to_string(),
                password: Some("pass".to_string()),
                key_file: None,
                passphrase: None,
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Box::new(mock_ssh_backend),
        };

        let result = manager.create_ssh(
            SSHSessionConfig {
                name: None,
                host: "example.com".to_string(),
                port: 22,
                username: "user".to_string(),
                auth_type: "key".to_string(),
                password: None,
                key_file: Some("/path/to/bad/key".to_string()),
                passphrase: None,
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
        let manager = SessionManager {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
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
                auth_type: "password".to_string(),
                password: Some("testpass".to_string()),
                key_file: None,
                passphrase: None,
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

        let manager = build_mock_manager(MockPtySystemM::new());
        manager
            .sessions
            .insert(999, Arc::new(ActiveSession::Pty(Box::new(backend))));

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

        let manager = build_mock_manager(MockPtySystemM::new());
        manager
            .sessions
            .insert(999, Arc::new(ActiveSession::Pty(Box::new(backend))));

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

    #[test]
    fn create_local_with_env_config_applies_env_to_command_builder() {
        use crate::models::session::EnvConfig;
        use std::ffi::OsStr;
        use std::sync::Arc as StdArc;
        use std::sync::Mutex as StdMutex;

        let captured_cmd: StdArc<StdMutex<Option<portable_pty::CommandBuilder>>> =
            StdArc::new(StdMutex::new(None));

        let mut mock_pty_system = MockPtySystemM::new();
        let captured = Arc::clone(&captured_cmd);
        mock_pty_system.expect_openpty().returning(move |_| {
            let cap = Arc::clone(&captured);
            let mut pair = MockPtyPairM::new();
            pair.expect_spawn().returning(move |cmd| {
                *cap.lock().unwrap() = Some(cmd);
                let mut child = MockChildM::new();
                child.expect_kill().times(0..).returning(|| Ok(()));
                Ok(Box::new(child))
            });
            pair.expect_master_writer().returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader().returning(|| Ok(Box::new(MockReadReturningZero)));
            pair.expect_resize().returning(|_, _| Ok(()));
            Ok(Box::new(pair))
        });

        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        let mut env = HashMap::new();
        env.insert("TEST_VAR".to_string(), "test_value_xyz".to_string());
        let config = LocalSessionConfig {
            name: None,
            shell: Some("/bin/sh".to_string()),
            cwd: None,
            args: None,
            env_config: Some(EnvConfig {
                env: Some(env),
            }),
            ..Default::default()
        };

        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok(), "create_local should succeed");

        let cmd_guard = captured_cmd.lock().unwrap();
        let cmd = cmd_guard.as_ref().expect("CommandBuilder was captured");

        assert_eq!(
            cmd.get_env("TEST_VAR"),
            Some(OsStr::new("test_value_xyz"))
        );

        assert!(cmd.get_env("PATH").is_some());
    }

    #[test]
    fn create_local_with_wsl_shell_template_sets_wslenv_for_user_vars() {
        use crate::models::session::EnvConfig;
        use std::ffi::OsStr;
        use std::sync::Arc as StdArc;
        use std::sync::Mutex as StdMutex;

        let captured_cmd: StdArc<StdMutex<Option<portable_pty::CommandBuilder>>> =
            StdArc::new(StdMutex::new(None));

        let mut mock_pty_system = MockPtySystemM::new();
        let captured = Arc::clone(&captured_cmd);
        mock_pty_system.expect_openpty().returning(move |_| {
            let cap = Arc::clone(&captured);
            let mut pair = MockPtyPairM::new();
            pair.expect_spawn().returning(move |cmd| {
                *cap.lock().unwrap() = Some(cmd);
                let mut child = MockChildM::new();
                child.expect_kill().times(0..).returning(|| Ok(()));
                Ok(Box::new(child))
            });
            pair.expect_master_writer().returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader().returning(|| Ok(Box::new(MockReadReturningZero)));
            pair.expect_resize().returning(|_, _| Ok(()));
            Ok(Box::new(pair))
        });

        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        // Use `shell: Some("wsl.exe")` directly so resolve_shell_path returns
        // "wsl.exe" regardless of platform. The cfg!(target_os = "windows")
        // gate in resolve_shell_path would otherwise route this case to
        // /bin/bash on Unix dev hosts.
        let mut env = HashMap::new();
        env.insert("MY_VAR".to_string(), "test_value_xyz".to_string());
        env.insert("OTHER_VAR".to_string(), "other_value".to_string());
        let config = LocalSessionConfig {
            name: None,
            shell: Some("wsl.exe".to_string()),
            cwd: None,
            args: None,
            env_config: Some(EnvConfig {
                env: Some(env),
            }),
            ..Default::default()
        };

        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok(), "create_local should succeed");

        let cmd_guard = captured_cmd.lock().unwrap();
        let cmd = cmd_guard.as_ref().expect("CommandBuilder was captured");

        // WSLENV must contain both user var names with /u flag, colon-separated.
        let wslenv = cmd
            .get_env("WSLENV")
            .expect("WSLENV should be set when spawning wsl.exe with user env vars");
        let wslenv_str = wslenv.to_str().expect("WSLENV should be UTF-8");
        assert!(
            wslenv_str.contains("MY_VAR/u"),
            "WSLENV should contain MY_VAR/u, got: {}",
            wslenv_str
        );
        assert!(
            wslenv_str.contains("OTHER_VAR/u"),
            "WSLENV should contain OTHER_VAR/u, got: {}",
            wslenv_str
        );

        // User vars themselves still set on cmd.
        assert_eq!(cmd.get_env("MY_VAR"), Some(OsStr::new("test_value_xyz")));
        assert_eq!(cmd.get_env("OTHER_VAR"), Some(OsStr::new("other_value")));
    }

    #[test]
    fn create_local_with_non_wsl_shell_does_not_set_wslenv() {
        use crate::models::session::EnvConfig;
        use std::sync::Arc as StdArc;
        use std::sync::Mutex as StdMutex;

        let captured_cmd: StdArc<StdMutex<Option<portable_pty::CommandBuilder>>> =
            StdArc::new(StdMutex::new(None));

        let mut mock_pty_system = MockPtySystemM::new();
        let captured = Arc::clone(&captured_cmd);
        mock_pty_system.expect_openpty().returning(move |_| {
            let cap = Arc::clone(&captured);
            let mut pair = MockPtyPairM::new();
            pair.expect_spawn().returning(move |cmd| {
                *cap.lock().unwrap() = Some(cmd);
                let mut child = MockChildM::new();
                child.expect_kill().times(0..).returning(|| Ok(()));
                Ok(Box::new(child))
            });
            pair.expect_master_writer().returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader().returning(|| Ok(Box::new(MockReadReturningZero)));
            pair.expect_resize().returning(|_, _| Ok(()));
            Ok(Box::new(pair))
        });

        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        // Use cmd.exe (non-WSL Windows shell). WSLENV must NOT be set.
        let mut env = HashMap::new();
        env.insert("MY_VAR".to_string(), "test_value_xyz".to_string());
        let config = LocalSessionConfig {
            name: None,
            shell: Some("cmd.exe".to_string()),
            cwd: None,
            args: None,
            env_config: Some(EnvConfig {
                env: Some(env),
            }),
            ..Default::default()
        };

        let result = manager.create_local(config, mock_backend);
        assert!(result.is_ok(), "create_local should succeed");

        let cmd_guard = captured_cmd.lock().unwrap();
        let cmd = cmd_guard.as_ref().expect("CommandBuilder was captured");

        // WSLENV must NOT be set for cmd.exe (regression guard — we only set
        // it for wsl.exe spawns).
        assert!(
            cmd.get_env("WSLENV").is_none(),
            "WSLENV must not be set for non-wsl shells; got: {:?}",
            cmd.get_env("WSLENV")
        );
    }
}