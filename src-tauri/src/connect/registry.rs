//! Session registry: the single source of truth for live terminal sessions.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use dashmap::DashMap;

use crate::connect::app_backend::AppBackend;
use crate::connect::local::create_local_terminal;
use crate::connect::session::{BoundTerminal, TerminalTransport};
use crate::connect::ssh::create_ssh_terminal;
use crate::connect::ssh_exec::upload_file_via_ssh;
use crate::connect::tmux::TmuxSession;
use crate::feature::logging::session_log::TerminalLogRegistry;
use crate::shared::capabilities::CapabilityFlags;
use crate::shared::session::{
    build_remote_image_path, tmux_pane_info, AttachedTmuxServer, LocalTerminalConfig,
    SplitDirection, SshConfig, TerminalInfo, TerminalKind, TerminalLoggingConfig,
    TmuxSessionConfig,
};

/// Per-server outcome from `auto_attach_on_startup`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoAttachOutcome {
    pub session_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<TerminalInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Manages the lifecycle of all terminal sessions.
pub(crate) struct TerminalRegistry {
    sessions: DashMap<u32, Arc<BoundTerminal>>,
    next_id: AtomicU32,
    tmux_sessions: DashMap<u32, Arc<TmuxSession>>,
    next_controller_id: AtomicU32,
    session_logs: Arc<TerminalLogRegistry>,
}

impl TerminalRegistry {
    pub(crate) fn new(session_logs: Arc<TerminalLogRegistry>) -> Self {
        Self {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            tmux_sessions: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
            session_logs,
        }
    }

    pub(crate) fn session_logs(&self) -> Arc<TerminalLogRegistry> {
        Arc::clone(&self.session_logs)
    }

    fn start_logging(
        &self,
        session_id: u32,
        logging: Option<&TerminalLoggingConfig>,
        session_name: &str,
    ) {
        let config = logging.cloned().unwrap_or_default();
        if let Err(e) = self.session_logs.start(session_id, &config, session_name) {
            tracing::warn!("failed to start session logging for {session_id}: {e}");
        }
    }

    pub(crate) fn create_local(
        &self,
        config: LocalTerminalConfig,
        backend: Arc<dyn AppBackend>,
        logging: Option<TerminalLoggingConfig>,
    ) -> Result<TerminalInfo, String> {
        let id = self.allocate_session_id();
        let session = create_local_terminal(config, backend, id)?;
        let name = session.info.name.clone();
        self.start_logging(id, logging.as_ref(), &name);
        Ok(self.insert_session(id, session))
    }

    pub(crate) async fn create_ssh(
        &self,
        config: SshConfig,
        backend: Arc<dyn AppBackend>,
        logging: Option<TerminalLoggingConfig>,
    ) -> Result<TerminalInfo, String> {
        let id = self.allocate_session_id();
        let session = create_ssh_terminal(config, backend, id).await?;
        let name = session.info.name.clone();
        self.start_logging(id, logging.as_ref(), &name);
        Ok(self.insert_session(id, session))
    }

    pub(crate) async fn attach_tmux(
        &self,
        config: &TmuxSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<TerminalInfo, String> {
        let controller_id = self.allocate_controller_id();
        let controller = TmuxSession::spawn_attach(config, backend, controller_id).await?;
        self.tmux_sessions
            .insert(controller_id, Arc::clone(&controller));

        let (bootstrap_xsterm_id, _bootstrap_pane_id) = controller.await_first_pane().await?;
        let mut bootstrap_info = None;
        for (pane_id, xsterm_id) in controller.registered_panes() {
            let tmux_window_id = controller.tmux_window_id_for_pane(&pane_id);
            let info = tmux_pane_info(
                xsterm_id,
                controller_id,
                pane_id.clone(),
                config.tmux_session_name.as_deref(),
                config.name.as_deref(),
                false,
                tmux_window_id.as_deref(),
            );
            let inserted = self.insert_tmux_pane(xsterm_id, controller_id, pane_id, info);
            if xsterm_id == bootstrap_xsterm_id {
                bootstrap_info = Some(inserted);
            }
        }

        bootstrap_info.ok_or_else(|| "tmux attach returned no bootstrap pane".to_string())
    }

    pub(crate) async fn capture_tmux_pane(
        &self,
        xsterm_session_id: u32,
        lines: i32,
    ) -> Result<String, String> {
        let (controller, pane) = self.tmux_pane_for(xsterm_session_id)?;
        controller.capture_pane(&pane, lines).await
    }

    pub(crate) fn list_attached_tmux_servers(&self) -> Vec<AttachedTmuxServer> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.tmux_sessions
            .iter()
            .filter_map(|entry| {
                entry.value().session_name().map(|name| AttachedTmuxServer {
                    session_name: name,
                    socket_name: None,
                    attached_at: now_ms,
                })
            })
            .collect()
    }

    pub(crate) async fn auto_attach_on_startup(
        &self,
        servers: &[AttachedTmuxServer],
        backend: Arc<dyn AppBackend>,
    ) -> Vec<AutoAttachOutcome> {
        let mut out = Vec::with_capacity(servers.len());
        for server in servers {
            let cfg = TmuxSessionConfig {
                name: None,
                tmux_session_name: Some(server.session_name.clone()),
                socket_name: server.socket_name.clone(),
                base_config_id: None,
                start_command: None,
                env_config: None,
                initial_rows: None,
                initial_cols: None,
                ssh: None,
            };
            let key = format!(
                "{}::{}",
                server.session_name,
                server.socket_name.as_deref().unwrap_or("")
            );
            match self.attach_tmux(&cfg, backend.clone()).await {
                Ok(info) => out.push(AutoAttachOutcome {
                    session_key: key,
                    info: Some(info),
                    error: None,
                }),
                Err(e) => out.push(AutoAttachOutcome {
                    session_key: key,
                    info: None,
                    error: Some(e),
                }),
            }
        }
        out
    }

    #[allow(dead_code)]
    pub(crate) fn close_tmux_controller(&self, controller_id: u32) -> Result<(), String> {
        let Some((_, controller)) = self.tmux_sessions.remove(&controller_id) else {
            return Ok(());
        };
        let pane_ids: Vec<u32> = self
            .sessions
            .iter()
            .filter_map(|entry| {
                (entry.value().info.tmux_session_id() == Some(controller_id)).then(|| *entry.key())
            })
            .collect();
        for pane_id in pane_ids {
            self.sessions.remove(&pane_id);
        }
        tokio::spawn(async move {
            let _ = controller.close().await;
        });
        Ok(())
    }

    pub(crate) async fn create_tmux_pane(
        &self,
        controller_id: u32,
        parent_xsterm_session_id: u32,
        direction: &str,
    ) -> Result<TerminalInfo, String> {
        let direction = SplitDirection::parse(direction)
            .ok_or_else(|| format!("invalid split direction: {direction:?}"))?;
        let controller = self.tmux_controller(controller_id)?;
        let parent_pane = self.tmux_pane_id(parent_xsterm_session_id, controller_id)?;
        let (xsterm_id, pane_id, window_id) =
            controller.split_pane(&parent_pane, direction).await?;
        let info = tmux_pane_info(
            xsterm_id,
            controller_id,
            pane_id.clone(),
            None,
            None,
            false,
            Some(&window_id),
        );
        Ok(self.insert_tmux_pane(xsterm_id, controller_id, pane_id, info))
    }

    pub(crate) fn kill_tmux_pane(&self, xsterm_session_id: u32) -> Result<(), String> {
        let (controller, pane) = self.tmux_pane_for(xsterm_session_id)?;
        controller.kill_pane(&pane)
    }

    pub(crate) async fn create_tmux_window(
        &self,
        controller_id: u32,
        window_name: Option<&str>,
    ) -> Result<TerminalInfo, String> {
        let controller = self.tmux_controller(controller_id)?;
        let (_xsterm_window_id, tmux_window_id, xsterm_id, pane_id) =
            controller.new_window(window_name).await?;
        let info = tmux_pane_info(
            xsterm_id,
            controller_id,
            pane_id.clone(),
            None,
            window_name,
            false,
            Some(&tmux_window_id),
        );
        Ok(self.insert_tmux_pane(xsterm_id, controller_id, pane_id, info))
    }

    pub(crate) fn kill_tmux_window(&self, xsterm_window_id: u32) -> Result<(), String> {
        let (controller, tmux_window_id) = self
            .tmux_sessions
            .iter()
            .find_map(|entry| {
                entry
                    .value()
                    .window_bindings()
                    .into_iter()
                    .find(|(_, xid)| *xid == xsterm_window_id)
                    .map(|(tmux_window_id, _)| (Arc::clone(entry.value()), tmux_window_id))
            })
            .ok_or_else(|| {
                format!("xsterm window {xsterm_window_id} is not bound to any tmux controller")
            })?;
        controller.kill_window(&tmux_window_id)
    }

    pub(crate) fn rename_tmux_window(
        &self,
        xsterm_window_id: u32,
        name: &str,
    ) -> Result<(), String> {
        let (controller, tmux_window_id) = self
            .tmux_sessions
            .iter()
            .find_map(|entry| {
                entry
                    .value()
                    .window_bindings()
                    .into_iter()
                    .find(|(_, xid)| *xid == xsterm_window_id)
                    .map(|(tmux_window_id, _)| (Arc::clone(entry.value()), tmux_window_id))
            })
            .ok_or_else(|| {
                format!("xsterm window {xsterm_window_id} is not bound to any tmux controller")
            })?;
        controller.rename_window(&tmux_window_id, name)
    }

    pub(crate) fn get(&self, id: u32) -> Result<Arc<BoundTerminal>, String> {
        self.sessions
            .get(&id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| format!("Session {id} not found"))
    }

    pub(crate) fn get_ssh_config(&self, id: u32) -> Result<SshConfig, String> {
        self.get(id)?
            .ssh_config
            .clone()
            .ok_or_else(|| format!("Session {id} is not an SSH session"))
    }

    pub(crate) async fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        self.get(id)?.transport.write(data).await
    }

    pub(crate) async fn resize(&self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        self.get(id)?.transport.resize(rows, cols).await
    }

    pub(crate) fn upload_image(
        &self,
        id: u32,
        filename: &str,
        data: Vec<u8>,
    ) -> Result<String, String> {
        let config = self.get_ssh_config(id)?;
        let remote_path = build_remote_image_path(filename)?;
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| format!("failed to create runtime for image upload: {e}"))?;
        rt.block_on(upload_file_via_ssh(&config, &remote_path, data))?;
        Ok(remote_path)
    }

    pub(crate) async fn close(&self, id: u32) -> Result<(), String> {
        self.session_logs.stop(id);
        let Some((_, session)) = self.sessions.remove(&id) else {
            return Ok(());
        };
        session.transport.close().await
    }

    pub(crate) fn list(&self) -> Vec<TerminalInfo> {
        self.sessions
            .iter()
            .map(|entry| {
                let mut info = entry.value().info.clone();
                info.capabilities = entry.value().capabilities.clone();
                info
            })
            .collect()
    }

    fn insert_session(&self, id: u32, session: BoundTerminal) -> TerminalInfo {
        let info = session.info.clone();
        self.sessions.insert(id, Arc::new(session));
        info
    }

    fn insert_tmux_pane(
        &self,
        xsterm_id: u32,
        controller_id: u32,
        pane_id: String,
        mut info: TerminalInfo,
    ) -> TerminalInfo {
        let Some(controller) = self
            .tmux_sessions
            .get(&controller_id)
            .map(|c| c.value().clone())
        else {
            return info;
        };
        info.capabilities = CapabilityFlags::for_tmux();
        info.kind = TerminalKind::TmuxPane {
            session_id: controller_id,
            pane_id: pane_id.clone(),
        };
        let session = BoundTerminal {
            info: info.clone(),
            capabilities: CapabilityFlags::for_tmux(),
            transport: TerminalTransport::TmuxPane {
                control: controller,
                pane_id,
            },
            ssh_config: None,
        };
        self.sessions.insert(xsterm_id, Arc::new(session));
        info
    }

    fn tmux_controller(&self, controller_id: u32) -> Result<Arc<TmuxSession>, String> {
        self.tmux_sessions
            .get(&controller_id)
            .map(|c| c.value().clone())
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))
    }

    fn tmux_pane_for(&self, xsterm_id: u32) -> Result<(Arc<TmuxSession>, String), String> {
        let session = self.get(xsterm_id)?;
        let controller_id = session
            .info
            .tmux_session_id()
            .ok_or_else(|| format!("session {xsterm_id} is not a tmux pane session"))?;
        let pane_id = session
            .info
            .tmux_pane_id()
            .map(str::to_string)
            .ok_or_else(|| format!("session {xsterm_id} has no tmux_pane_id"))?;
        let controller = self.tmux_controller(controller_id)?;
        Ok((controller, pane_id))
    }

    fn tmux_pane_id(&self, xsterm_id: u32, controller_id: u32) -> Result<String, String> {
        let session = self.get(xsterm_id)?;
        if session.info.tmux_session_id() != Some(controller_id) {
            return Err(format!(
                "parent session {xsterm_id} belongs to a different controller"
            ));
        }
        session
            .info
            .tmux_pane_id()
            .map(str::to_string)
            .ok_or_else(|| format!("session {xsterm_id} has no tmux_pane_id"))
    }

    fn allocate_session_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn allocate_controller_id(&self) -> u32 {
        self.next_controller_id.fetch_add(1, Ordering::Relaxed)
    }
}
