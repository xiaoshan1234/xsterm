use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use dashmap::DashMap;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::session_backend::SessionBackend;
use crate::infrastructure::ssh::{
    upload_file_via_ssh, SshBackend, SshBackendImpl, SshSessionWrapper,
};
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{
    build_remote_image_path, tmux_pane_info, AttachedTmuxServer, LocalSessionConfig,
    SSHSessionConfig, SessionInfo, SessionLoggingConfig, SplitDirection, TmuxCcConfig,
};
use crate::services::local_session::create_local_session;
use crate::services::session_log::start_session_logging;
use crate::services::ssh_session::create_ssh_session as infra_create_ssh;
use crate::services::tmux::TmuxController;

/// per-server outcome from
/// [`SessionManager::auto_attach_on_startup`].
///
/// Collapses the `Result<_, _>` shape into mutually-exclusive
/// `info` / `error` fields so the frontend's
/// `sessionService.autoAttachTmuxServers` gets a flat object instead
/// of an externally-tagged enum (Tauri 2's IPC of `Result<T, E>` is
/// brittle across serde versions).
#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoAttachOutcome {
    /// Stable composite key (`<session_name>::<socket_name>`) so the
    /// frontend can match the outcome back to a persisted entry even
    /// when session names repeat.
    pub session_key: String,
    /// `Some(SessionInfo)` on a successful re-attach, `None` otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<SessionInfo>,
    /// `Some(message)` on a failed re-attach, `None` otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Per-pane handle held by [`SessionManager`] for tmux-controller panes.
///
/// Holds a clone of the controller `Arc` plus the tmux pane id the pane
/// lives under. I/O (`write` / `resize` / `close`) is delegated through
/// the controller so the [`SessionBackend`] contract is honoured without
/// duplicating the tmux wire format per pane.
pub struct TmuxPaneHandle {
    controller: Arc<TmuxController>,
    tmux_pane_id: String,
    info: SessionInfo,
    capabilities: CapabilityFlags,
}

impl SessionBackend for TmuxPaneHandle {
    fn info(&self) -> &SessionInfo {
        &self.info
    }

    fn capabilities(&self) -> &CapabilityFlags {
        &self.capabilities
    }

    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.controller.send_keys(&self.tmux_pane_id, data)
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.controller.resize_pane(&self.tmux_pane_id, rows, cols)
    }

    fn close(self: Box<Self>) -> Result<(), String> {
        // Dropping one pane binding must not kill the controller — other
        // panes owned by the same tmux -CC process may still be live.
        // `unbind_pane` removes the entry from `pane_bindings` and lets
        // the controller stay alive.
        self.controller.unbind_pane(&self.tmux_pane_id)
    }
}

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
    TmuxPane(Box<TmuxPaneHandle>),
}

impl ActiveSession {
    /// Borrow the underlying backend as a trait object.
    fn backend(&self) -> &(dyn SessionBackend + '_) {
        match self {
            ActiveSession::Pty(b) => &**b,
            ActiveSession::Ssh(b) => &**b,
            ActiveSession::TmuxPane(b) => &**b,
        }
    }

    /// Consume the variant and return the owned boxed backend (coerced to a
    /// type-erased `Box<dyn SessionBackend + Send>`).
    fn into_backend(self) -> Box<dyn SessionBackend + Send> {
        match self {
            ActiveSession::Pty(b) => b,
            ActiveSession::Ssh(b) => b,
            ActiveSession::TmuxPane(b) => b,
        }
    }

    /// Build a complete [`SessionInfo`] (including `capabilities`) from this
    /// session's metadata.
    fn to_session_info(&self) -> SessionInfo {
        let mut info = self.backend().info().clone();
        info.capabilities = self.backend().capabilities().clone();
        info
    }

    /// If this session is a tmux pane, return its `tmux_controller_id`;
    /// otherwise return `None`.
    fn tmux_controller_id(&self) -> Option<u32> {
        match self {
            ActiveSession::TmuxPane(b) => Some(b.controller.controller_id()),
            _ => None,
        }
    }

    /// If this session is a tmux pane, return its underlying tmux pane
    /// id (e.g. `"%5"`). Used by [`SessionManager::kill_tmux_pane`] and
    /// by [`SessionManager::create_tmux_pane`] (to find the parent pane
    /// of a split).
    fn tmux_pane_id(&self) -> Option<&str> {
        match self {
            ActiveSession::TmuxPane(b) => Some(b.tmux_pane_id.as_str()),
            _ => None,
        }
    }

    /// If this session is a tmux pane, return a clone of the underlying
    /// [`TmuxController`] handle. The handle outlives the session entry
    /// because it is also stored in `SessionManager::tmux_controllers`,
    /// so cloning the `Arc` here is cheap and safe.
    fn tmux_controller(&self) -> Option<Arc<TmuxController>> {
        match self {
            ActiveSession::TmuxPane(b) => Some(Arc::clone(&b.controller)),
            _ => None,
        }
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
///
/// ## tmux controllers
///
/// `tmux -CC` sessions are layered: a single tmux controller (`Arc<TmuxController>`)
/// owns N panes, each mapped to its own xsterm session id. We track the
/// controllers in a separate `DashMap<u32, Arc<TmuxController>>` so
/// `close_tmux_controller(id)` can find every pane that belongs to a given
/// controller in one shot and tear them down together. The pane sessions
/// still live in `sessions` keyed by their own xsterm id, and
/// `TmuxPaneHandle.controller.controller_id()` ties them back here.
pub struct SessionManager {
    sessions: DashMap<u32, Arc<ActiveSession>>,
    next_id: AtomicU32,
    ssh_backend: Box<dyn SshBackend>,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    next_controller_id: AtomicU32,
}

impl SessionManager {
    /// Create a new session manager with default platform backends.
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            next_id: AtomicU32::new(1),
            ssh_backend: Box::new(SshBackendImpl::new()),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
        }
    }

    /// Create a new local shell session.
    pub fn create_local(
        &self,
        config: LocalSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();

        let session = create_local_session(config, backend, id)?;

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
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();

        let wrapper = infra_create_ssh(self.ssh_backend.as_ref(), config, backend, id)?;

        // Acknowledge the session's logging configuration. See `create_local`
        // for the rationale on the deferred wiring.
        let logging_config = SessionLoggingConfig::default();
        if let Err(e) = start_session_logging(id, &logging_config) {
            tracing::warn!("Failed to start session logging for session {}: {}", id, e);
        }

        Ok(self.insert_session(id, ActiveSession::Ssh(Box::new(wrapper))))
    }

    /// Spawn a tmux `-CC` controller and register the first pane it reports.
    ///
    /// Blocks until the controller signals the first pane (or a 5 s
    /// timeout). On success the resulting pane session is inserted under
    /// the manager-allocated id and the controller is parked in
    /// `tmux_controllers` for `close_tmux_controller` to find later.
    ///
    /// when [`TmuxCcConfig::ssh`] is `Some(_)`, the controller
    /// runs `tmux -CC` on the remote host via an SSH exec channel; the
    /// `ssh_backend` member is used to open the channel. When `ssh` is
    /// `None`, the controller spawns a local `tmux -CC` child.
    pub async fn create_tmux(
        &self,
        config: &TmuxCcConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        let controller_id = self.allocate_controller_id();
        let controller =
            TmuxController::spawn_local(config, backend, self.ssh_backend.as_ref(), controller_id)?;

        let (xsterm_id, tmux_pane_id) = controller.await_first_pane().await?;

        // look up the bootstrap tmux window id so the
        // `SessionInfo` carries it. The dispatch task records the
        // pane → window mapping when it handles `%window-pane-changed`
        // for the bootstrap pane.
        let tmux_window_id = controller.tmux_window_id_for_pane(&tmux_pane_id);

        // MVP supports both `tmux -CC new -s <name>` (the first pane tmux
        // reports IS the user's working shell, so it must be visible —
        // `is_hidden = false`) and `tmux -CC attach` (where the original
        // pane becomes the tmux control connection and `is_hidden = true`
        // suppresses it from the UI; see D3 in req-006). For `new-session`
        // there is no "useless" bootstrap pane to hide.
        let info = tmux_pane_info(
            xsterm_id,
            controller_id,
            tmux_pane_id.clone(),
            config.tmux_session_name.as_deref(),
            config.name.as_deref(),
            false,
            tmux_window_id.as_deref(),
        );

        let handle = TmuxPaneHandle {
            controller: Arc::clone(&controller),
            tmux_pane_id,
            info: info.clone(),
            capabilities: CapabilityFlags::for_tmux(),
        };

        self.tmux_controllers.insert(controller_id, controller);
        let self_ref = self.insert_session(xsterm_id, ActiveSession::TmuxPane(Box::new(handle)));
        debug_assert_eq!(self_ref.id, xsterm_id);

        tracing::info!(
            "tmux controller {} spawned; bootstrap pane xsterm_id={}",
            controller_id,
            xsterm_id
        );
        Ok(info)
    }

    /// attach to an existing `tmux -CC` server and register the
    /// bootstrap pane.
    ///
    /// Block until the controller signals the first pane (same as
    /// `create_tmux`). On success the resulting `SessionInfo` is marked
    /// `is_hidden = true` because the bootstrap pane `tmux -CC attach`
    /// occupies is the tmux control connection itself (iTerm2 D3 pattern;
    /// see `req-006-tmux.md` §2 D3). The frontend suppresses hidden panes
    /// from the UI; once the user opens a new pane via `new-window` /
    /// `split-window`, that pane IS visible (`is_hidden = false`).
    pub async fn attach_tmux(
        &self,
        config: &TmuxCcConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        let controller_id = self.allocate_controller_id();
        let controller = TmuxController::spawn_attach(
            config,
            backend,
            self.ssh_backend.as_ref(),
            controller_id,
        )?;

        let (xsterm_id, tmux_pane_id) = controller.await_first_pane().await?;

        let tmux_window_id = controller.tmux_window_id_for_pane(&tmux_pane_id);

        let info = tmux_pane_info(
            xsterm_id,
            controller_id,
            tmux_pane_id.clone(),
            config.tmux_session_name.as_deref(),
            config.name.as_deref(),
            true, // is_hidden: bootstrap pane of an attach (D3).
            tmux_window_id.as_deref(),
        );

        let handle = TmuxPaneHandle {
            controller: Arc::clone(&controller),
            tmux_pane_id,
            info: info.clone(),
            capabilities: CapabilityFlags::for_tmux(),
        };

        self.tmux_controllers.insert(controller_id, controller);
        let self_ref = self.insert_session(xsterm_id, ActiveSession::TmuxPane(Box::new(handle)));
        debug_assert_eq!(self_ref.id, xsterm_id);

        tracing::info!(
            "tmux controller {} attached to session {:?}; bootstrap pane xsterm_id={}",
            controller_id,
            config.tmux_session_name.as_deref(),
            xsterm_id
        );
        Ok(info)
    }

    /// capture scrollback text from an existing tmux pane.
    ///
    /// Resolves the xsterm session id → tmux pane id mapping in `sessions`,
    /// delegates to [`TmuxController::capture_pane`], and returns the
    /// resulting text. Returns `Err` when the session is unknown, is not a
    /// tmux pane, or when tmux itself responds with `%error` / timeout.
    pub async fn capture_tmux_pane(
        &self,
        xsterm_session_id: u32,
        lines: i32,
    ) -> Result<String, String> {
        let entry = self
            .sessions
            .get(&xsterm_session_id)
            .ok_or_else(|| format!("session {xsterm_session_id} not found"))?;
        let controller = entry
            .value()
            .tmux_controller()
            .ok_or_else(|| format!("session {xsterm_session_id} is not a tmux pane session"))?;
        let tmux_pane_id = entry
            .value()
            .tmux_pane_id()
            .ok_or_else(|| format!("session {xsterm_session_id} has no tmux_pane_id"))?
            .to_string();
        drop(entry);

        controller.capture_pane(&tmux_pane_id, lines).await
    }

    /// enumerate live tmux controllers as
    /// [`AttachedTmuxServer`]s. Used by the Tauri command handler after
    /// `create_tmux` / `attach_tmux` to persist `attached_tmux.json`;
    /// the frontend itself only sees this projection through the
    /// `get_attached_tmux_servers` command.
    pub fn list_attached_tmux_servers(&self) -> Vec<AttachedTmuxServer> {
        let now_ms: u64 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.tmux_controllers
            .iter()
            .filter_map(|entry| {
                let controller = entry.value();
                controller.session_name().map(|name| AttachedTmuxServer {
                    session_name: name,
                    socket_name: None,
                    attached_at: now_ms,
                })
            })
            .collect()
    }

    /// re-attach every previously-attached tmux server.
    ///
    /// Reads the supplied list of [`AttachedTmuxServer`]s (typically the
    /// contents of `attached_tmux.json`) and tries to attach to each one
    /// in order. Returns one [`AutoAttachOutcome`] per server so the
    /// frontend can show partial-failure UI without crashing on the first
    /// dead server.
    pub async fn auto_attach_on_startup(
        &self,
        servers: &[AttachedTmuxServer],
        backend: Arc<dyn AppBackend>,
    ) -> Vec<AutoAttachOutcome> {
        let mut out = Vec::with_capacity(servers.len());
        for server in servers {
            let cfg = TmuxCcConfig {
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

    /// Close every pane backed by `controller_id` and then tear down the
    /// tmux controller itself.
    ///
    /// Idempotent: an unknown `controller_id` is treated as already-closed
    /// and returns `Ok(())`. Each pane session is removed from `sessions`
    /// and its `TmuxPaneHandle::close` unregisters the pane binding on the
    /// controller; the controller's own `close` then kills the tmux child
    /// and drains any in-flight split requests with an error so they do
    /// not block on the full `SPLIT_PANE_TIMEOUT`.
    #[allow(dead_code)]
    pub fn close_tmux_controller(&self, controller_id: u32) -> Result<(), String> {
        let Some((_, controller)) = self.tmux_controllers.remove(&controller_id) else {
            return Ok(());
        };

        // Collect every session id that belongs to this controller before
        // mutating the map — otherwise we'd borrow `sessions` while
        // iterating.
        let pane_ids: Vec<u32> = self
            .sessions
            .iter()
            .filter_map(|entry| {
                if entry.value().tmux_controller_id() == Some(controller_id) {
                    Some(*entry.key())
                } else {
                    None
                }
            })
            .collect();

        for pane_id in pane_ids {
            if let Err(e) = self.close(pane_id) {
                tracing::warn!(
                    "close_tmux_controller({}): dropping pane {} raised: {e}",
                    controller_id,
                    pane_id
                );
            }
        }

        controller.close()
    }

    /// Split `parent_xsterm_session_id` (a tmux pane session that already
    /// exists in `sessions`) and register the new pane under a freshly
    /// allocated xsterm session id.
    ///
    /// The parent session must be a `TmuxPane` variant; if it is a local
    /// PTY or SSH session, this method returns
    /// `Err("parent is not a tmux pane session")`. The split is delegated
    /// to [`TmuxController::split_pane`], which returns the new pane's
    /// `(xsterm_session_id, tmux_pane_id, tmux_window_id)` triple once
    /// tmux confirms via `%window-pane-changed`.
    ///
    /// On success the new pane is inserted into `sessions` with
    /// `is_hidden = false` (the user explicitly created it via the
    /// split UI) and its `SessionInfo` is returned to the frontend so it
    /// can update its pane tree immediately. The `tmux-pane-added` event
    /// emitted by the controller is still useful for the frontend
    /// listener as a defensive cross-check.
    pub async fn create_tmux_pane(
        &self,
        controller_id: u32,
        parent_xsterm_session_id: u32,
        direction: &str,
    ) -> Result<SessionInfo, String> {
        let direction = SplitDirection::parse(direction)
            .ok_or_else(|| format!("invalid split direction: {direction:?}"))?;

        // Look up the controller (must exist on this SessionManager).
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;

        // Look up the parent pane session and extract its tmux pane id.
        let parent_tmux_pane_id = {
            let parent_entry = self
                .sessions
                .get(&parent_xsterm_session_id)
                .ok_or_else(|| {
                    format!("parent session {parent_xsterm_session_id} not found in SessionManager")
                })?;
            parent_entry
                .value()
                .tmux_pane_id()
                .ok_or_else(|| {
                    format!("parent session {parent_xsterm_session_id} is not a tmux pane session")
                })?
                .to_string()
        };
        // Also assert the parent belongs to this controller — the
        // controller_id argument must agree with the parent's controller.
        let parent_controller_id = self
            .sessions
            .get(&parent_xsterm_session_id)
            .and_then(|e| e.value().tmux_controller_id());
        match parent_controller_id {
            Some(id) if id == controller_id => {}
            Some(other) => {
                return Err(format!(
                    "parent session {parent_xsterm_session_id} belongs to controller {other}, not {controller_id}"
                ));
            }
            None => {
                // Reached only if the session disappeared between the
                // two `sessions` lookups; the prior branch already
                // surfaced this case.
                return Err(format!(
                    "parent session {parent_xsterm_session_id} is not a tmux pane session"
                ));
            }
        }

        // Issue the split. The controller registers the binding and
        // returns the new pane's ids.
        let (new_xsterm_id, new_tmux_pane_id, _new_tmux_window_id) = controller
            .split_pane(&parent_tmux_pane_id, direction)
            .await?;

        // Build the SessionInfo and TmuxPaneHandle for the new pane.
        // `is_hidden = false` because the user explicitly created it via
        // the split UI (D3 in req-006 §2 only hides the bootstrap pane
        // from `tmux -CC attach`, not user-driven splits).
        let info = tmux_pane_info(
            new_xsterm_id,
            controller_id,
            new_tmux_pane_id.clone(),
            None,
            None,
            false,
            Some(&_new_tmux_window_id),
        );

        let handle = TmuxPaneHandle {
            controller: Arc::clone(&controller),
            tmux_pane_id: new_tmux_pane_id,
            info: info.clone(),
            capabilities: CapabilityFlags::for_tmux(),
        };
        let result = self.insert_session(new_xsterm_id, ActiveSession::TmuxPane(Box::new(handle)));
        debug_assert_eq!(result.id, new_xsterm_id);

        tracing::info!(
            "tmux controller {}: created pane {} via {:?} split of parent {}",
            controller_id,
            new_xsterm_id,
            direction,
            parent_xsterm_session_id
        );

        Ok(info)
    }

    /// Send `kill-pane` for the tmux pane backing `xsterm_session_id`.
    ///
    /// The frontend listens for the resulting `tmux-pane-removed` event
    /// (emitted by the controller's dispatch task on `%pane-exited`) and
    /// drops the matching `Session` from React state at that point. This
    /// keeps the cleanup path symmetric with `close_session` while
    /// letting the React listener own the UI state mutation.
    ///
    /// Returns `Err` if the session is unknown or is not a tmux pane.
    pub fn kill_tmux_pane(&self, xsterm_session_id: u32) -> Result<(), String> {
        let entry = self
            .sessions
            .get(&xsterm_session_id)
            .ok_or_else(|| format!("session {xsterm_session_id} not found"))?;
        let controller = entry
            .value()
            .tmux_controller()
            .ok_or_else(|| format!("session {xsterm_session_id} is not a tmux pane session"))?;
        let tmux_pane_id = entry
            .value()
            .tmux_pane_id()
            .ok_or_else(|| format!("session {xsterm_session_id} has no tmux_pane_id"))?
            .to_string();
        drop(entry); // release the DashMap shard lock before the I/O.
        controller.kill_pane(&tmux_pane_id)
    }

    /// open a new tmux window on the given controller and return
    /// the [`SessionInfo`] for the new window's first pane.
    ///
    /// Flow:
    /// 1. Look up the controller.
    /// 2. Call [`TmuxController::new_window`] which sends `new-window`
    ///    to tmux and waits for the matching `%window-pane-changed`
    ///    reply (Promise coordination, see
    ///    [`TmuxController::new_window`]). Returns the quadruple
    ///    `(xsterm_window_id, tmux_window_id, xsterm_session_id,
    ///    tmux_pane_id)`.
    /// 3. Build a [`SessionInfo`] for the first pane via
    ///    [`tmux_pane_info`] and insert it into `sessions`.
    ///
    /// The returned `SessionInfo` carries `tmux_window_id = Some(...)` so
    /// the frontend can map the Session to its containing xsterm Window
    /// without waiting for the `tmux-window-added` event. The dispatch
    /// task also emits `tmux-window-added` and `tmux-pane-added` for
    /// idempotent cross-check; the frontend listener for those events
    /// must short-circuit on existing ids (matching the Wave 1/2
    /// `tmux-pane-added` semantics).
    pub async fn create_tmux_window(
        &self,
        controller_id: u32,
        window_name: Option<&str>,
    ) -> Result<SessionInfo, String> {
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;

        let (xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id) =
            controller.new_window(window_name).await?;

        // The frontend uses the SessionInfo's `id` to find the matching
        // Session — we register the new pane with the id tmux assigned
        // (the controller allocated it during dispatch).
        let info = tmux_pane_info(
            xsterm_session_id,
            controller_id,
            tmux_pane_id.clone(),
            None,
            window_name,
            false,
            Some(&tmux_window_id),
        );

        let handle = TmuxPaneHandle {
            controller: Arc::clone(&controller),
            tmux_pane_id,
            info: info.clone(),
            capabilities: CapabilityFlags::for_tmux(),
        };
        let result =
            self.insert_session(xsterm_session_id, ActiveSession::TmuxPane(Box::new(handle)));
        debug_assert_eq!(result.id, xsterm_session_id);

        tracing::info!(
            "tmux controller {}: created window xsterm_id={} tmux_id={} pane_xsterm_id={} pane_tmux_id={}",
            controller_id,
            xsterm_window_id,
            tmux_window_id,
            xsterm_session_id,
            result.tmux_pane_id.as_deref().unwrap_or("?"),
        );

        Ok(info)
    }

    /// kill a tmux window via `kill-window`.
    ///
    /// `xsterm_window_id` is the **xsterm** window id (matches
    /// `killTmuxWindow` on the frontend). The frontend looks up which
    /// tmux window this corresponds to via the `tmux-window-added`
    /// event's payload; here we resolve it via the controller's
    /// `window_bindings` map (popped by `tmux-window-closed` once the
    /// dispatch task sees the matching `%window-close`).
    ///
    /// Synchronous: writes the command to the controller's stdin FIFO
    /// and returns. The dispatch task will eventually emit
    /// `tmux-window-closed` when tmux sends `%window-close`, which the
    /// frontend listener uses to drop every Session in the matching
    /// xsterm Window and then drop the Window itself.
    ///
    /// Returns `Err` if the controller is unknown or the xsterm window
    /// id is not bound to any controller.
    pub fn kill_tmux_window(&self, xsterm_window_id: u32) -> Result<(), String> {
        // Find the controller that owns this xsterm window id by
        // scanning every controller's `window_bindings`.
        let mut found: Option<(Arc<TmuxController>, String)> = None;
        for entry in self.tmux_controllers.iter() {
            let controller = entry.value().clone();
            for (tmux_window_id, xid) in controller.window_bindings() {
                if xid == xsterm_window_id {
                    found = Some((controller, tmux_window_id));
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
        let (controller, tmux_window_id) = found.ok_or_else(|| {
            format!("xsterm window {xsterm_window_id} is not bound to any tmux controller")
        })?;
        controller.kill_window(&tmux_window_id)
    }

    /// rename a tmux window via `rename-window`.
    ///
    /// Synchronous: writes the command to the controller's stdin FIFO
    /// and returns. The dispatch task will eventually emit
    /// `tmux-window-renamed` when tmux sends `%window-renamed`, which
    /// the frontend listener uses to update the matching xsterm
    /// Window's `name`.
    pub fn rename_tmux_window(&self, xsterm_window_id: u32, name: &str) -> Result<(), String> {
        let mut found: Option<(Arc<TmuxController>, String)> = None;
        for entry in self.tmux_controllers.iter() {
            let controller = entry.value().clone();
            for (tmux_window_id, xid) in controller.window_bindings() {
                if xid == xsterm_window_id {
                    found = Some((controller, tmux_window_id));
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
        let (controller, tmux_window_id) = found.ok_or_else(|| {
            format!("xsterm window {xsterm_window_id} is not bound to any tmux controller")
        })?;
        controller.rename_window(&tmux_window_id, name)
    }

    /// Allocate the next unique tmux controller id.
    fn allocate_controller_id(&self) -> u32 {
        self.next_controller_id.fetch_add(1, Ordering::Relaxed)
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
    pub fn upload_image(&self, id: u32, filename: &str, data: Vec<u8>) -> Result<String, String> {
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
    use super::*;
    use crate::infrastructure::session_backend::SessionBackend;
    use crate::models::capabilities::CapabilityFlags;
    use crate::models::session::{SessionInfo, SessionType};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    struct MockBackend {
        info: SessionInfo,
        capabilities: CapabilityFlags,
        writes: Arc<AtomicUsize>,
        resizes: Arc<AtomicUsize>,
        closed: Arc<AtomicBool>,
    }

    impl MockBackend {
        fn new(id: u32) -> Self {
            Self {
                info: SessionInfo {
                    id,
                    name: format!("session-{id}"),
                    session_type: SessionType::Local {
                        shell: "sh".to_string(),
                        cwd: "/".to_string(),
                    },
                    is_connected: true,
                    capabilities: CapabilityFlags::for_local(),
                    tmux_pane_id: None,
                    tmux_controller_id: None,
                    tmux_window_id: None,
                    is_hidden: false,
                },
                capabilities: CapabilityFlags::for_local(),
                writes: Arc::new(AtomicUsize::new(0)),
                resizes: Arc::new(AtomicUsize::new(0)),
                closed: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl SessionBackend for MockBackend {
        fn info(&self) -> &SessionInfo {
            &self.info
        }
        fn capabilities(&self) -> &CapabilityFlags {
            &self.capabilities
        }
        fn write(&self, _data: &[u8]) -> Result<(), String> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn resize(&self, _rows: u16, _cols: u16) -> Result<(), String> {
            self.resizes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn close(self: Box<Self>) -> Result<(), String> {
            self.closed.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn manager_with(
        backend: MockBackend,
    ) -> (
        SessionManager,
        Arc<AtomicUsize>,
        Arc<AtomicUsize>,
        Arc<AtomicBool>,
    ) {
        let writes = backend.writes.clone();
        let resizes = backend.resizes.clone();
        let closed = backend.closed.clone();
        let manager = SessionManager::new();
        manager
            .sessions
            .insert(1, Arc::new(ActiveSession::Pty(Box::new(backend))));
        (manager, writes, resizes, closed)
    }

    #[test]
    fn write_dispatches_to_backend() {
        let (manager, writes, _, _) = manager_with(MockBackend::new(1));
        manager.write(1, b"hello").unwrap();
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn resize_dispatches_to_backend() {
        let (manager, _, resizes, _) = manager_with(MockBackend::new(1));
        manager.resize(1, 24, 80).unwrap();
        assert_eq!(resizes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn close_removes_session_and_closes_backend() {
        let (manager, _, _, closed) = manager_with(MockBackend::new(1));
        manager.close(1).unwrap();
        assert!(closed.load(Ordering::SeqCst));
        assert!(manager.sessions.is_empty());
    }

    #[test]
    fn list_returns_all_sessions() {
        let (manager, _, _, _) = manager_with(MockBackend::new(1));
        let list = manager.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, 1);
    }
}
