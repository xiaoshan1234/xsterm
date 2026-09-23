use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use tauri::AppHandle;

use crate::commands::persistence::save_attached_tmux_servers_impl;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{NativePtySystem, PtySystem};
use crate::infrastructure::session_backend::SessionBackend;
use crate::infrastructure::ssh::{
    upload_file_via_ssh, SshBackend, SshBackendImpl, SshSessionWrapper,
};
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{
    build_remote_image_path, tmux_pane_info, AttachedTmuxServer, LocalSessionConfig,
    SSHSessionConfig, SessionIdSource, SessionInfo, SessionLoggingConfig, SplitDirection,
    TmuxCcConfig, TmuxControlWindowInit, TmuxSessionInit,
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
    /// `Some(TmuxSessionInit)` on a successful re-attach, `None`
    /// otherwise. The new IA returns the full initial state (n
    /// windows + m panes + control window) in one synchronous
    /// payload so the frontend can render the workspace without
    /// waiting for additional async events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<crate::models::session::TmuxSessionInit>,
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
    /// `pub(crate)` so [`dispatch`](crate::services::tmux::dispatch) can
    /// construct a handle for a pane discovered via the bootstrap
    /// `list-panes -a` query without going through `create_tmux_pane`
    /// (which would issue an extra `split-window`). See
    /// [`SessionManager::register_existing_tmux_panes`].
    pub controller: Arc<TmuxController>,
    pub tmux_pane_id: String,
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
}

impl TmuxPaneHandle {
    /// Construct a handle for an already-existing pane the dispatch task
    /// learned about via the bootstrap `list-panes` query. Mirrors the
    /// shape `create_tmux` / `create_tmux_pane` produce internally; the
    /// only difference is no underlying `split-window`/`new-window`
    /// round-trip — the pane was already created server-side before we
    /// attached.
    pub fn new(
        controller: Arc<TmuxController>,
        tmux_pane_id: String,
        info: SessionInfo,
        capabilities: CapabilityFlags,
    ) -> Self {
        Self {
            controller,
            tmux_pane_id,
            info,
            capabilities,
        }
    }
}

impl SessionBackend for TmuxPaneHandle {
    fn info(&self) -> &SessionInfo {
        &self.info
    }

    fn capabilities(&self) -> &CapabilityFlags {
        &self.capabilities
    }

    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.controller
            .send_keys(&self.tmux_pane_id, data)
            .map_err(|e| e.to_string())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.controller
            .resize_pane(&self.tmux_pane_id, rows, cols)
            .map_err(|e| e.to_string())
    }

    fn close(self: Box<Self>) -> Result<(), String> {
        // Dropping one pane binding must not kill the controller — other
        // panes owned by the same tmux -CC process may still be live.
        // `unbind_pane` removes the entry from `pane_bindings` and lets
        // the controller stay alive.
        self.controller
            .unbind_pane(&self.tmux_pane_id)
            .map_err(|e| e.to_string())
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
    Tmux(Box<TmuxPaneHandle>),
}

impl ActiveSession {
    /// Borrow the underlying backend as a trait object.
    fn backend(&self) -> &(dyn SessionBackend + '_) {
        match self {
            ActiveSession::Pty(b) => &**b,
            ActiveSession::Ssh(b) => &**b,
            ActiveSession::Tmux(b) => &**b,
        }
    }

    /// Consume the variant and return the owned boxed backend (coerced to a
    /// type-erased `Box<dyn SessionBackend + Send>`).
    fn into_backend(self) -> Box<dyn SessionBackend + Send> {
        match self {
            ActiveSession::Pty(b) => b,
            ActiveSession::Ssh(b) => b,
            ActiveSession::Tmux(b) => b,
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
            ActiveSession::Tmux(b) => Some(b.controller.controller_id()),
            _ => None,
        }
    }

    /// If this session is a tmux pane, return its underlying tmux pane
    /// id (e.g. `"%5"`). Used by [`SessionManager::kill_tmux_pane`] and
    /// by [`SessionManager::create_tmux_pane`] (to find the parent pane
    /// of a split).
    fn tmux_pane_id(&self) -> Option<&str> {
        match self {
            ActiveSession::Tmux(b) => Some(b.tmux_pane_id.as_str()),
            _ => None,
        }
    }

    /// If this session is a tmux pane, return a clone of the underlying
    /// [`TmuxController`] handle. The handle outlives the session entry
    /// because it is also stored in `SessionManager::tmux_controllers`,
    /// so cloning the `Arc` here is cheap and safe.
    fn tmux_controller(&self) -> Option<Arc<TmuxController>> {
        match self {
            ActiveSession::Tmux(b) => Some(Arc::clone(&b.controller)),
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
    /// Shared with every `TmuxController` so the dispatch task can
    /// mint fresh Session.ids for newly-registered panes (split,
    /// bootstrap-list-panes, …). Replaces the controller's old local
    /// `next_xsterm_id` allocator — local PTY / SSH / tmux now share
    /// the same id space, sourced from this one counter.
    session_id_source: Arc<SessionIdSource>,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Arc<dyn SshBackend>,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    next_controller_id: AtomicU32,
}

/// Shell-quote a single argument for the probe command's remote shell.
/// Conservative — wraps in single quotes and escapes embedded single
/// quotes. We do not need a full POSIX-shell quoter because `tmux -L`
/// only sees a single token; `run_command_capture_stdout` hands the
/// resulting string to a remote shell which then splits it for tmux.
///
/// Module-level free function (not an associated fn on
/// `SessionManager`) so the call site can use it without `Self::`
/// qualification and so the function is reusable by future helpers
/// (e.g. an HTTP `GET /api/tmux/sessions`).
fn tmux_probe_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

impl SessionManager {
    /// Create a new session manager with default platform backends.
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(NativePtySystem::new()),
            ssh_backend: Arc::new(SshBackendImpl::new()),
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

        let session = create_local_session(self.pty_system.as_ref(), config, backend, id)?;

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
    ) -> Result<crate::models::session::TmuxSessionInit, String> {
        tracing::info!(
            "[DEBUG-0009-RUST] SessionManager::create_tmux ENTRY controller_id=pending config={:?}",
            config.debug_redacted()
        );
        let controller_id = self.allocate_controller_id();
        // Pre-allocate the bootstrap Session.id and an allocator
        // closure that the controller's dispatch task will use for
        // any panes registered after the bootstrap (split,
        // list-panes, …). The bootstrap id travels into the
        // controller and is consumed by `record_first_pane` on the
        // first `%window-pane-changed` reply.
        let session_id_allocator =
            crate::models::session::SessionIdSource::shared_allocator(&self.session_id_source);
        let controller = TmuxController::spawn_create(
            config,
            backend,
            self.ssh_backend.as_ref(),
            controller_id,
            session_id_allocator,
        )?;

        let (session_id, tmux_pane_id) = controller.await_first_pane().await?;
        tracing::debug!(
            "[DEBUG-0009-RUST] await_first_pane returned session_id={} tmux_pane_id={:?}",
            session_id,
            tmux_pane_id
        );

        // **New IA (TmuxSessionInit):** wait for the dispatch task to
        // finish processing BOTH `list-windows` AND `list-panes`
        // responses, then assemble the full initial state into one
        // synchronous return payload. The dispatch task stashes the
        // parsed rows into `controller.initial_{windows,panes}` and
        // signals `initial_state_ready` after the second list arrives.
        let (initial_windows, initial_panes) = controller.take_initial_state().await?;
        tracing::debug!(
            "[DEBUG-0009-RUST] take_initial_state returned {} windows, {} panes",
            initial_windows.len(),
            initial_panes.len()
        );

        // Look up the bootstrap tmux window id so the `SessionInfo`
        // carries it. The dispatch task records the pane → window
        // mapping when it handles `%window-pane-changed` for the
        // bootstrap pane.
        let tmux_window_id = controller.tmux_window_id_for_pane(&tmux_pane_id);
        tracing::debug!(
            "[DEBUG-0009-RUST] tmux_window_id_for_pane returned {:?} for pane {:?}",
            tmux_window_id,
            tmux_pane_id
        );

        // MVP supports both `tmux -CC new -s <name>` (the first pane tmux
        // reports IS the user's working shell, so it must be visible —
        // `is_hidden = false`) and `tmux -CC attach` (where the original
        // pane becomes the tmux control connection and `is_hidden = true`
        // suppresses it from the UI; see D3 in req-006). For `new-session`
        // there is no "useless" bootstrap pane to hide.
        let info = tmux_pane_info(
            session_id,
            controller_id,
            tmux_pane_id.clone(),
            config.tmux_session_name.as_deref(),
            config.name.as_deref(),
            false,
            tmux_window_id.as_deref(),
        );

        // Insert the bootstrap session into `sessions` and the
        // controller into `tmux_controllers`. Other panes / windows
        // come in via `panes[1..]` / `windows[..]` and are handled by
        // the caller via the new IA payload — we don't pre-create
        // TmuxPaneHandle rows for them here (the dispatcher already
        // registered their bindings, and the frontend builds 1:1
        // Session rows from `init.panes`).
        let handle = TmuxPaneHandle {
            controller: Arc::clone(&controller),
            tmux_pane_id: tmux_pane_id.clone(),
            info: info.clone(),
            capabilities: CapabilityFlags::for_tmux(),
        };

        self.tmux_controllers
            .insert(controller_id, Arc::clone(&controller));
        let self_ref = self.insert_session(session_id, ActiveSession::Tmux(Box::new(handle)));
        debug_assert_eq!(self_ref.id, session_id);

        // Build the new IA payload.
        let control_window = crate::models::session::TmuxControlWindowInit {
            tmux_controller_id: controller_id,
            name: tmux_window_id
                .as_deref()
                .map(|_| {
                    config
                        .tmux_session_name
                        .clone()
                        .unwrap_or_else(|| format!("tmux-{controller_id}"))
                })
                .unwrap_or_else(|| format!("tmux-{controller_id}")),
        };

        let init = crate::models::session::TmuxSessionInit {
            session: info,
            windows: initial_windows,
            panes: initial_panes,
            control_window,
        };

        tracing::info!(
            "tmux controller {} spawned; {} windows, {} panes returned synchronously",
            controller_id,
            init.windows.len(),
            init.panes.len()
        );
        Ok(init)
    }

    /// Probe the tmux server (local or via SSH) for a session with the
    /// given name. Returns `true` when the session exists, `false` when
    /// it does not (or the server isn't running), and `Err` only for
    /// transport / spawn failures (DNS, auth, command-not-found) — not
    /// for "session not found".
    ///
    /// Used by the Create Session dialog to decide between
    /// `create_tmux_session` and `attach_tmux_session` (PR-T7 in the
    /// tmux-redesign track): the controller's new-window shortcut only
    /// works on a fresh session, so when the user types a name that
    /// already exists on the server we want the attach path, not
    /// `new-session -A` which tmux treats as an attach but would still
    /// trigger the controller's stale new-window enqueue.
    ///
    /// **Scope:** local + SSH. The local path spawns
    /// `tmux -L <socket> list-sessions -F '#{session_name}'`; the SSH
    /// path delegates to
    /// [`SshBackend::run_command_capture_stdout`](crate::infrastructure::ssh::SshBackend::run_command_capture_stdout)
    /// which runs the same `tmux` command on the remote host via an
    /// exec channel. Both treat the absence of the named session the
    /// same way (`Ok(false)`).
    pub async fn probe_tmux_session_exists(&self, config: &TmuxCcConfig) -> Result<bool, String> {
        let socket = config.socket_name.as_deref().unwrap_or("default");
        let name = config
            .tmux_session_name
            .as_deref()
            .ok_or_else(|| "probe_tmux_session_exists: tmuxSessionName is required".to_string())?;
        if let Some(ssh_cfg) = config.ssh.as_ref() {
            // Build the remote command. We use a simple `tmux` argv
            // here (no -CC) so the remote tmux treats this as a plain
            // one-shot query, not a control client. The socket name
            // is user-supplied so we shell-quote it (defensive — the
            // actual tmux socket path charset is conservative but
            // `run_command_capture_stdout` hands the string to a
            // remote shell, not directly to tmux).
            let command = format!(
                "tmux -L {} list-sessions -F '#{{session_name}}'",
                tmux_probe_quote(socket)
            );
            let ssh_cfg = ssh_cfg.clone();
            let backend = Arc::clone(&self.ssh_backend);
            // `run_command_capture_stdout` is sync (russh handshake +
            // drain run in a blocking thread); wrap with
            // spawn_blocking so we don't block the tokio reactor.
            let join = tokio::task::spawn_blocking(move || {
                backend.run_command_capture_stdout(&ssh_cfg, &command)
            })
            .await
            .map_err(|e| format!("probe_tmux_session_exists: SSH probe task panicked: {e}"))?;
            let (stdout, status) = join?;
            if !status.success() {
                // No server / permission denied / etc. — not an error
                // from the caller's perspective.
                return Ok(false);
            }
            return Ok(stdout.lines().any(|line| line.trim() == name));
        }
        let output = tokio::process::Command::new("tmux")
            .args(["-L", socket, "list-sessions", "-F", "#{session_name}"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("probe_tmux_session_exists: failed to spawn `tmux`: {e}"))?;
        // list-sessions exits 0 + stdout lines for every session when a
        // server is running. It exits 1 + stderr "no server running on
        // /tmp/tmux-..." when there is no server. We treat both as
        // "session does not exist" (Ok(false)).
        if !output.status.success() {
            return Ok(false);
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().any(|line| line.trim() == name))
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
    ) -> Result<TmuxSessionInit, String> {
        let controller_id = self.allocate_controller_id();
        let session_id_allocator =
            crate::models::session::SessionIdSource::shared_allocator(&self.session_id_source);
        let controller = TmuxController::spawn_create(
            config,
            backend,
            self.ssh_backend.as_ref(),
            controller_id,
            session_id_allocator,
        )?;

        let (session_id, tmux_pane_id) = controller.await_first_pane().await?;

        // **New IA:** wait for the dispatch task to process the
        // initial list-windows + list-panes responses before returning.
        let (initial_windows, initial_panes) = controller.take_initial_state().await?;

        let tmux_window_id = controller.tmux_window_id_for_pane(&tmux_pane_id);

        let info = tmux_pane_info(
            session_id,
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

        self.tmux_controllers
            .insert(controller_id, Arc::clone(&controller));
        let self_ref = self.insert_session(session_id, ActiveSession::Tmux(Box::new(handle)));
        debug_assert_eq!(self_ref.id, session_id);

        let control_window = TmuxControlWindowInit {
            tmux_controller_id: controller_id,
            name: config
                .tmux_session_name
                .clone()
                .unwrap_or_else(|| format!("tmux-{controller_id}")),
        };

        let init = TmuxSessionInit {
            session: info,
            windows: initial_windows,
            panes: initial_panes,
            control_window,
        };

        tracing::info!(
            "tmux controller {} attached to session {:?}; {} windows, {} panes returned synchronously",
            controller_id,
            config.tmux_session_name.as_deref(),
            init.windows.len(),
            init.panes.len()
        );
        Ok(init)
    }

    /// capture scrollback text from a tmux pane.
    ///
    /// Same local-id → server-id convention as
    /// [`SessionManager::kill_tmux_pane`]: the frontend resolves
    /// the xsterm session id locally and sends the tmux-side
    /// identifiers; the backend delegates straight to
    /// [`TmuxController::capture_pane`].
    ///
    /// Errors:
    /// - `Err(_)` when `controller_id` is not registered.
    /// - `Err(_)` propagated from [`TmuxController::capture_pane`]
    ///   when `tmux_pane_id` is not in the controller's
    ///   `pane_bindings` map, when tmux itself responds with
    ///   `%error`, or when the call times out after 5 s.
    pub async fn capture_tmux_pane(
        &self,
        controller_id: u32,
        tmux_pane_id: &str,
        lines: i32,
    ) -> Result<String, String> {
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;
        controller
            .capture_pane(tmux_pane_id, lines)
            .await
            .map_err(|e| e.to_string())
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
    /// Register panes that the dispatch task discovered via the
    /// bootstrap `list-panes -a` query but which were never created via
    /// `create_tmux` / `create_tmux_pane` (Bug 021 — pre-existing panes
    /// on the tmux server before our controller attached). Each tuple
    /// `(xsterm_session_id, controller, pane_id, info, capabilities)`
    /// produces a fresh `TmuxPaneHandle` and inserts it into `sessions`
    /// so subsequent `writeSession(xsterm_session_id, ...)` from the
    /// frontend routes correctly. Returns the newly registered ids.
    pub fn register_existing_tmux_panes(
        &self,
        panes: Vec<(
            u32,
            Arc<TmuxController>,
            String,
            SessionInfo,
            CapabilityFlags,
        )>,
    ) -> Result<Vec<u32>, String> {
        let mut registered = Vec::with_capacity(panes.len());
        for (xsterm_id, controller, pane_id, info, capabilities) in panes {
            let handle = TmuxPaneHandle::new(controller, pane_id, info, capabilities);
            self.sessions
                .insert(xsterm_id, Arc::new(ActiveSession::Tmux(Box::new(handle))));
            registered.push(xsterm_id);
        }
        Ok(registered)
    }

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

        controller.close().map_err(|e| e.to_string())
    }

    /// Detach the control client for `controller_id` from its tmux
    /// session and tear down the Rust-side state for that controller.
    ///
    /// Frontend entry point: `detach_tmux_controller` Tauri command.
    ///
    /// Flow (ADR 0009 §2.9):
    /// 1. Look up the controller; if it's gone, return `Ok(())`
    ///    (idempotent — the frontend may retry after the controller
    ///    already exited).
    /// 2. Send `detach-client -s "<session_name>"` to the controller's
    ///    stdin. tmux treats this as a graceful disconnect: the
    ///    session + windows stay alive on the server; the control
    ///    client child exits.
    /// 3. Remove the controller from `tmux_controllers` and unbind
    ///    every pane session it owned. We do NOT call
    ///    [`TmuxController::close`] — the natural exit path through
    ///    the monitor task is what lets the dispatch task fire
    ///    `tmux-controller-exit` for the frontend.
    ///
    /// Errors:
    /// - Unknown controller id → `Ok(())` (already detached / closed).
    /// - Controller has no `session_name` recorded → `Err(_)` from the
    ///   wire command (we still drop the controller + panes).
    /// - Stdin channel already closed → best-effort; the controller
    ///   is already exiting on its own.
    pub fn detach_tmux_controller(&self, controller_id: u32) -> Result<(), String> {
        let Some((_, controller)) = self.tmux_controllers.remove(&controller_id) else {
            return Ok(());
        };

        // Best-effort wire command. Failure here means the child
        // already exited (e.g. user killed the tmux server) — we still
        // drop our local state.
        if let Err(e) = controller.detach_client() {
            tracing::warn!(
                "detach_tmux_controller({}): detach-client write failed: {e}; continuing",
                controller_id
            );
        }

        // Clean up the pane sessions that belonged to this controller.
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
                    "detach_tmux_controller({}): dropping pane {} raised: {e}",
                    controller_id,
                    pane_id
                );
            }
        }

        Ok(())
    }

    /// Tell the tmux server to shut down via `kill-server` and tear
    /// down the Rust-side state for that controller.
    ///
    /// Frontend entry point: `kill_server_via_controller` Tauri command.
    /// Distinct from `detach_tmux_controller`: the session + windows
    /// are destroyed server-side. ADR 0009 §2.4 row "Remote delete".
    ///
    /// Fire-and-forget: we don't wait for the tmux child to exit; the
    /// monitor task observes the backend exit and the dispatch task
    /// fires `tmux-controller-exit` for the frontend.
    pub fn kill_server_via_controller(&self, controller_id: u32) -> Result<(), String> {
        let Some((_, controller)) = self.tmux_controllers.remove(&controller_id) else {
            return Ok(());
        };

        if let Err(e) = controller.kill_server() {
            tracing::warn!(
                "kill_server_via_controller({}): kill-server write failed: {e}; continuing",
                controller_id
            );
        }

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
                    "kill_server_via_controller({}): dropping pane {} raised: {e}",
                    controller_id,
                    pane_id
                );
            }
        }

        Ok(())
    }

    /// Remove a single controller's entry from the on-disk
    /// `attached_tmux.json` store so the next startup does not
    /// auto-attach it. ADR 0009 §2.9 + A9.
    ///
    /// If the controller is still registered we look up its
    /// `session_name`; if it has already exited, we fall back to the
    /// `tmux_controllers` map state at call time. The "session_name
    /// to remove" is matched against the live list to produce the
    /// filtered list we save back to disk.
    ///
    /// Idempotent: removing a non-existent entry is a no-op (the
    /// filtered list already excludes it).
    pub fn unmark_attached_tmux(&self, controller_id: u32, app: &AppHandle) -> Result<(), String> {
        // The session name we want to drop. If the controller is
        // already gone, we still have nothing to match — fall through
        // and let `list_attached_tmux_servers` reflect the current
        // truth.
        let target_name = self
            .tmux_controllers
            .get(&controller_id)
            .and_then(|c| c.value().session_name());

        let live = self.list_attached_tmux_servers();
        let filtered: Vec<AttachedTmuxServer> = match target_name.as_ref() {
            Some(name) => live
                .into_iter()
                .filter(|s| s.session_name != *name)
                .collect(),
            None => live,
        };
        save_attached_tmux_servers_impl(app, &filtered)
    }

    /// Split `parent_tmux_pane_id` on the given controller and
    /// register the new pane under a freshly allocated xsterm session
    /// id.
    ///
    /// The frontend performs the local-id → server-id resolution
    /// (xsterm session id ↦ `(controller_id, tmux_pane_id)`) and
    /// passes the tmux-side identifiers directly. The manager
    /// looks up the controller via its id and delegates to
    /// [`TmuxController::split_pane`]; no scan of `sessions` is
    /// needed.
    ///
    /// Validation:
    /// - `controller_id` must be registered (else `Err`).
    /// - `parent_tmux_pane_id` must be in the controller's
    ///   `pane_bindings` (else `Err` propagated from
    ///   [`TmuxController::split_pane`]). This is what guarantees
    ///   the parent belongs to the named controller — the previous
    ///   "parent belongs to controller_id" lookup is no longer
    ///   needed because the controller's own check is stricter.
    ///
    /// On success the new pane is inserted into `sessions` with
    /// `is_hidden = false` (the user explicitly created it via the
    /// split UI) and its `SessionInfo` is returned to the frontend so
    /// it can update its pane tree immediately. The `tmux-pane-added`
    /// event emitted by the controller is still useful for the
    /// frontend listener as a defensive cross-check.
    pub async fn create_tmux_pane(
        &self,
        controller_id: u32,
        parent_tmux_pane_id: &str,
        direction: &str,
    ) -> Result<SessionInfo, String> {
        let direction = SplitDirection::parse(direction)
            .ok_or_else(|| format!("invalid split direction: {direction:?}"))?;

        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;

        // Issue the split. The controller registers the binding and
        // returns the new pane's ids. Its own `pane_bindings`
        // contains-check rejects any `parent_tmux_pane_id` that is
        // not in this controller — i.e. the "parent belongs to the
        // named controller" invariant is enforced here.
        let (new_xsterm_id, new_tmux_pane_id, _new_tmux_window_id) = controller
            .split_pane(parent_tmux_pane_id, direction)
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
        let result = self.insert_session(new_xsterm_id, ActiveSession::Tmux(Box::new(handle)));
        debug_assert_eq!(result.id, new_xsterm_id);

        tracing::info!(
            "tmux controller {}: created pane {} via {:?} split of parent {}",
            controller_id,
            new_xsterm_id,
            direction,
            parent_tmux_pane_id
        );

        Ok(info)
    }

    /// Send `kill-pane` for the given tmux pane.
    ///
    /// Same local-id → server-id convention as
    /// [`SessionManager::create_tmux_pane`]: the frontend resolves
    /// the xsterm session id locally and sends the tmux-side
    /// identifiers; the backend delegates straight to
    /// [`TmuxController::kill_pane`].
    ///
    /// The frontend listens for the resulting `tmux-pane-removed`
    /// event (emitted by the controller's dispatch task on
    /// `%pane-exited`) and drops the matching `Session` from React
    /// state at that point. This keeps the cleanup path symmetric with
    /// `close_session` while letting the React listener own the UI
    /// state mutation.
    ///
    /// Errors:
    /// - `Err(_)` when `controller_id` is not registered.
    /// - `Err(_)` propagated from [`TmuxController::kill_pane`]
    ///   when `tmux_pane_id` is not in the controller's
    ///   `pane_bindings` map.
    pub fn kill_tmux_pane(&self, controller_id: u32, tmux_pane_id: &str) -> Result<(), String> {
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;
        controller
            .kill_pane(tmux_pane_id)
            .map_err(|e| e.to_string())
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

        // Returns `(tmux_window_id, session_id, tmux_pane_id)`. The
        // `tmux_window_id` IS the new window's React `Window.id`
        // (no parallel `xsterm_window_id` exists); `session_id` is
        // the new window's first pane's `Session.id`, allocated by
        // the controller's injected `SessionIdSource` during the
        // dispatch handshake.
        let (tmux_window_id, session_id, tmux_pane_id) = controller.new_window(window_name).await?;

        let info = tmux_pane_info(
            session_id,
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
        let result = self.insert_session(session_id, ActiveSession::Tmux(Box::new(handle)));
        debug_assert_eq!(result.id, session_id);

        tracing::info!(
            "tmux controller {}: created window tmux_id={} pane_session_id={} pane_tmux_id={}",
            controller_id,
            tmux_window_id,
            session_id,
            result.tmux_pane_id.as_deref().unwrap_or("?"),
        );

        Ok(info)
    }

    /// kill a tmux window via `kill-window`.
    ///
    /// The frontend performs the local-id → server-id resolution
    /// (xsterm Window id ↦ `(controller_id, tmux_window_id)`) and
    /// passes the tmux-side identifiers directly. The manager looks
    /// up the controller via its id and delegates to
    /// [`TmuxController::kill_window`]; no controller-wide scan of
    /// `window_bindings` is needed.
    ///
    /// Synchronous: writes the command to the controller's stdin FIFO
    /// and returns. The dispatch task will eventually emit
    /// `tmux-window-closed` when tmux sends `%window-close`, which the
    /// frontend listener uses to drop every Session in the matching
    /// xsterm Window and then drop the Window itself.
    ///
    /// Errors:
    /// - `Err(_)` when `controller_id` is not registered (the
    ///   controller already closed or was never spawned).
    /// - `Err(_)` propagated from [`TmuxController::kill_window`]
    ///   when `tmux_window_id` is not in the controller's
    ///   `window_bindings` map (e.g. the frontend passed a stale id).
    pub fn kill_tmux_window(&self, controller_id: u32, tmux_window_id: &str) -> Result<(), String> {
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;
        controller
            .kill_window(tmux_window_id)
            .map_err(|e| e.to_string())
    }

    /// rename a tmux window via `rename-window`.
    ///
    /// Same local-id → server-id convention as
    /// [`SessionManager::kill_tmux_window`]: the frontend resolves
    /// the xsterm Window id locally and sends the tmux-side
    /// identifiers; the backend delegates straight to
    /// [`TmuxController::rename_window`].
    ///
    /// Synchronous: writes the command to the controller's stdin FIFO
    /// and returns. The dispatch task will eventually emit
    /// `tmux-window-renamed` when tmux sends `%window-renamed`, which
    /// the frontend listener uses to update the matching xsterm
    /// Window's `name`.
    pub fn rename_tmux_window(
        &self,
        controller_id: u32,
        tmux_window_id: &str,
        name: &str,
    ) -> Result<(), String> {
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;
        controller
            .rename_window(tmux_window_id, name)
            .map_err(|e| e.to_string())
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
            .ok_or_else(|| format!("Session {id} not found"))
    }

    /// Look up a tmux controller by its id (allocated by
    /// `allocate_controller_id`). Cloned `Arc` so the caller can hold it
    /// past the lookup. Used by `register_existing_tmux_panes` to
    /// register panes discovered via the bootstrap `list-panes -a` query
    /// (Bug 021).
    pub fn tmux_controller_by_id(
        &self,
        controller_id: u32,
    ) -> Result<Arc<crate::services::tmux::controller::TmuxController>, String> {
        self.tmux_controllers
            .get(&controller_id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| format!("tmux controller {controller_id} not found"))
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

    /// Resize a tmux pane via `resize-pane -t %<pane> -x <cols> -y <rows>`.
    ///
    /// `controller_id` + `tmux_pane_id` flow through [`TmuxController::resize_pane`]
    /// — same convention as `kill_tmux_pane` / `capture_tmux_pane`.
    pub async fn resize_tmux_pane(
        &self,
        controller_id: u32,
        tmux_pane_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), String> {
        let controller = self
            .tmux_controllers
            .get(&controller_id)
            .map(|c| Arc::clone(c.value()))
            .ok_or_else(|| format!("tmux controller {controller_id} is not registered"))?;
        controller
            .resize_pane(tmux_pane_id, rows, cols)
            .map_err(|e| e.to_string())
    }

    /// Resize a local PTY session. Looks the session up by its
    /// universal `Session.id` (the same one `write_session` /
    /// `close_session` use) and delegates to the backend's
    /// `SessionBackend::resize`. Returns `Err` if the session is not
    /// a local PTY (the only backend that takes the ioctl).
    pub fn resize_pty_session(&self, session_id: u32, rows: u16, cols: u16) -> Result<(), String> {
        self.get(session_id)?.backend().resize(rows, cols)
    }

    /// Resize an SSH session's russh channel via `window-change`.
    /// Same `Session.id` lookup as `resize_pty_session`. Returns
    /// `Err` if the session is not an SSH session.
    pub fn resize_ssh_session(&self, session_id: u32, rows: u16, cols: u16) -> Result<(), String> {
        self.get(session_id)?.backend().resize(rows, cols)
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

    /// Allocate the next unique session id. Pulled from the shared
    /// [`SessionIdSource`] so the controller's dispatch task can mint
    /// ids from the same counter for newly-registered tmux panes.
    fn allocate_session_id(&self) -> u32 {
        self.session_id_source.allocate()
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
            fn connect_exec(
                &self,
                config: &SSHSessionConfig,
                command: &str,
            ) -> Result<SshConnectResult, String>;
            fn run_command_capture_stdout(
                &self,
                config: &SSHSessionConfig,
                command: &str,
            ) -> Result<(String, std::process::ExitStatus), String>;
        }
    }

    impl SshBackend for MockSshBackendM {
        fn connect(&self, config: &SSHSessionConfig) -> Result<SshConnectResult, String> {
            self.connect(config)
        }

        fn connect_exec(
            &self,
            config: &SSHSessionConfig,
            command: &str,
        ) -> Result<SshConnectResult, String> {
            self.connect_exec(config, command)
        }

        fn run_command_capture_stdout(
            &self,
            config: &SSHSessionConfig,
            command: &str,
        ) -> Result<(String, std::process::ExitStatus), String> {
            self.run_command_capture_stdout(config, command)
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
            self.write_data.lock().unwrap().extend_from_slice(data);
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
                tmux_pane_id: None,
                tmux_controller_id: None,
                tmux_window_id: None,
                is_hidden: false,
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
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Arc::new(MockSshBackendM::new()),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            pair.expect_master_writer()
                .returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader()
                .returning(|| Ok(Box::new(MockReadReturningZero)));
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

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_connected);
        // Linux default is `/bin/bash`; Windows default is `cmd.exe`.
        assert!(
            info.name.contains("bash") || info.name.contains("sh") || info.name.contains("cmd"),
            "expected default shell basename in session name, got {:?}",
            info.name,
        );
    }

    #[test]
    fn create_local_with_custom_shell_session_name_contains_shell_name() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: Some("/usr/bin/zsh".to_string()),
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
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
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: Some("/tmp".to_string()),
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
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
            Arc::new(mock_backend),
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
            Arc::new(mock_backend),
        );

        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.name.contains("zsh"));
    }

    #[test]
    fn create_local_when_pty_open_fails_returns_err() {
        let mut mock_pty_system = MockPtySystemM::new();
        mock_pty_system
            .expect_openpty()
            .returning(|_| Err("PTY open failed".to_string()));
        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );

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

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );
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

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );
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

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );
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

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );
        assert!(result.is_ok());

        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn test_resize_returns_ok() {
        let mut mock_pty_system = MockPtySystemM::new();
        expect_openpty(&mut mock_pty_system);
        let mock_backend = TestAppBackend::default();
        let manager = build_mock_manager(mock_pty_system);

        let result = manager.create_local(
            LocalSessionConfig {
                name: None,
                shell: None,
                cwd: None,
                args: None,
                env_config: None,
                ..Default::default()
            },
            Arc::new(mock_backend),
        );
        assert!(result.is_ok());
        let info = result.unwrap();

        let result = manager.resize_pty_session(info.id, 24, 80);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resize_nonexistent_session_returns_ok() {
        let manager = SessionManager::new();
        let result = manager.resize_pty_session(999, 24, 80);
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

                exit_code: Arc::new(std::sync::Mutex::new(None)),

                exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
            })
        });

        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            Arc::new(mock_backend),
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

                exit_code: Arc::new(std::sync::Mutex::new(None)),

                exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
            })
        });

        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            Arc::new(mock_backend),
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

                exit_code: Arc::new(std::sync::Mutex::new(None)),

                exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
            })
        });

        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            Arc::new(mock_backend),
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

                exit_code: Arc::new(std::sync::Mutex::new(None)),

                exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
            })
        });

        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            Arc::new(mock_backend),
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
        mock_ssh_backend
            .expect_connect()
            .returning(|_| Err("Failed to connect".to_string()));
        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            Arc::new(mock_backend),
        );

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Failed to connect");
    }

    #[test]
    fn create_ssh_auth_error() {
        let mut mock_ssh_backend = MockSshBackendM::new();
        mock_ssh_backend
            .expect_connect()
            .returning(|_| Err("SSH auth failed".to_string()));
        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(MockPtySystemM::new()),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
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
            Arc::new(mock_backend),
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

                exit_code: Arc::new(std::sync::Mutex::new(None)),

                exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
            })
        });

        let mock_backend = TestAppBackend::default();
        let manager = SessionManager {
            sessions: DashMap::new(),
            session_id_source: SessionIdSource::new(1),
            pty_system: Box::new(mock_pty_system),
            ssh_backend: Arc::new(mock_ssh_backend),
            tmux_controllers: DashMap::new(),
            next_controller_id: AtomicU32::new(1),
        };

        manager
            .create_local(
                LocalSessionConfig {
                    name: None,
                    shell: None,
                    cwd: None,
                    args: None,
                    env_config: None,
                    ..Default::default()
                },
                Arc::new(mock_backend.clone()),
            )
            .expect("local session should be created");

        manager
            .create_ssh(
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
                Arc::new(mock_backend.clone()),
            )
            .expect("ssh session should be created");

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

        manager.resize_pty_session(999, 24, 80).unwrap();
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

        manager.resize_pty_session(999, 30, 100).unwrap();
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
            pair.expect_master_writer()
                .returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader()
                .returning(|| Ok(Box::new(MockReadReturningZero)));
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
            env_config: Some(EnvConfig { env: Some(env) }),
            ..Default::default()
        };

        let result = manager.create_local(config, Arc::new(mock_backend));
        assert!(result.is_ok(), "create_local should succeed");

        let cmd_guard = captured_cmd.lock().unwrap();
        let cmd = cmd_guard.as_ref().expect("CommandBuilder was captured");

        assert_eq!(cmd.get_env("TEST_VAR"), Some(OsStr::new("test_value_xyz")));

        assert!(cmd.get_env("PATH").is_some());
    }

    #[test]
    #[cfg_attr(not(target_os = "windows"), ignore = "WSL is a Windows-only subsystem")]
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
            pair.expect_master_writer()
                .returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader()
                .returning(|| Ok(Box::new(MockReadReturningZero)));
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
            env_config: Some(EnvConfig { env: Some(env) }),
            ..Default::default()
        };

        let result = manager.create_local(config, Arc::new(mock_backend));
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
    #[cfg_attr(not(target_os = "windows"), ignore = "WSL is a Windows-only subsystem")]
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
            pair.expect_master_writer()
                .returning(|| Ok(Box::new(MockWrite)));
            pair.expect_master_reader()
                .returning(|| Ok(Box::new(MockReadReturningZero)));
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
            env_config: Some(EnvConfig { env: Some(env) }),
            ..Default::default()
        };

        let result = manager.create_local(config, Arc::new(mock_backend));
        assert!(result.is_ok(), "create_local should succeed");

        let cmd_guard = captured_cmd.lock().unwrap();
        let cmd = cmd_guard.as_ref().expect("CommandBuilder was captured");

        // Regression guard: the non-WSL branch must not append the user's
        // `MY_VAR/u` to WSLENV. The cmd builder may inherit a parent
        // `WSLENV` value from `std::env` — we only assert that we did not
        // add anything to it for this non-wsl shell.
        let wslenv = cmd.get_env("WSLENV");
        let wslenv_str = wslenv.and_then(|s| s.to_str()).unwrap_or("");
        assert!(
            !wslenv_str.contains("MY_VAR/u"),
            "WSL handling must not fire on cmd.exe; got WSLENV = {:?}",
            wslenv_str
        );
    }

    /// helper that constructs a hand-rolled `TmuxController`
    /// for unit tests via [`TmuxController::new_for_tests`]. Returns
    /// the controller plus the stdin receiver (so `kill_pane` tests
    /// can verify the queued command) and the dispatch-channel sender
    /// (so `create_tmux_pane` tests can feed a synthetic
    /// `WindowPaneChanged` reply).
    fn make_test_controller(
        controller_id: u32,
    ) -> (
        Arc<crate::services::tmux::TmuxController>,
        tokio::sync::mpsc::UnboundedReceiver<String>,
        tokio::sync::mpsc::UnboundedSender<crate::services::tmux::protocol::events::ProtocolEvent>,
    ) {
        use crate::infrastructure::app_backend::AppBackend;
        use crate::services::tmux::dispatch::spawn_dispatch_task;

        // Hand-rolled backend stub — `RecordingBackend` lives in the
        // controller.rs tests module and is not `pub`. Re-roll a
        // minimal one here so the dispatch task has something to call.
        struct StubBackend;
        impl AppBackend for StubBackend {
            fn emit(&self, _event: &str, _payload: &serde_json::Value) -> Result<(), String> {
                Ok(())
            }
            fn emit_binary(&self, _bytes: Vec<u8>) -> Result<(), String> {
                Ok(())
            }
            fn spawn(&self, _f: Box<dyn FnOnce() + Send>) {}
        }
        let backend: Arc<dyn AppBackend> = Arc::new(StubBackend);

        let (stdin_tx, stdin_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let (dispatch_tx, dispatch_rx) = tokio::sync::mpsc::unbounded_channel::<
            crate::services::tmux::protocol::events::ProtocolEvent,
        >();
        let controller = crate::services::tmux::TmuxController::new_for_tests(
            controller_id,
            stdin_tx,
            backend.clone(),
        );
        spawn_dispatch_task(
            dispatch_rx,
            controller.clone(),
            crate::services::tmux::bridge::TmuxBridge::new(backend.clone(), controller.clone()),
        );
        (controller, stdin_rx, dispatch_tx)
    }

    /// `create_tmux_pane` returns a `SessionInfo` with the
    /// expected fields once tmux confirms the split via
    /// `%window-pane-changed`. The test constructs a controller
    /// manually (no real tmux child) and feeds a synthetic reply to
    /// the dispatch task so `split_pane()` can resolve.
    #[tokio::test]
    async fn create_tmux_pane_returns_session_info() {
        let manager = SessionManager::new();
        let (controller, _stdin_rx, dispatch_tx) = make_test_controller(1);

        // Pre-register a parent pane binding on the controller so
        // `controller.split_pane`'s `pane_bindings` check accepts
        // `%5`. Also record the first pane so the dispatch task takes
        // the split-result path (not the bootstrap path).
        controller.register_pane("%5".to_string(), 1_000_001);
        controller.record_first_pane(0, "%5".to_string());

        manager.tmux_controllers.insert(1, Arc::clone(&controller));

        // Kick off `create_tmux_pane` in the background. It will block
        // until we feed the dispatch task a `WindowPaneChanged` reply.
        let manager_arc = Arc::new(manager);
        let manager_for_split = Arc::clone(&manager_arc);
        let split_handle = tokio::spawn(async move {
            manager_for_split
                .create_tmux_pane(1, "%5", "horizontal")
                .await
        });

        // Yield so the split task registers its pending sender before
        // we feed the reply.
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;

        dispatch_tx
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::WindowPaneChanged {
                    window_id: "@7".to_string(),
                    pane_id: "%11".to_string(),
                },
            )
            .expect("dispatch channel must accept the synthetic reply");

        let info = tokio::time::timeout(std::time::Duration::from_secs(2), split_handle)
            .await
            .expect("create_tmux_pane must not time out")
            .expect("split task did not panic")
            .expect("create_tmux_pane must succeed on matching reply");

        // The returned SessionInfo must have:
        // - a freshly-allocated xsterm id (the controller's
        //   next_xsterm_id allocator starts at base_xsterm_id, and
        //   this is the first allocation since the parent was
        //   pre-registered via `register_pane` + `record_first_pane`
        //   which skip the allocator),
        // - the tmux pane id tmux confirmed via the reply,
        // - the matching controller id,
        // - is_hidden = false (user-driven split).
        assert_eq!(
            info.id, 1_000_001,
            "controller must allocate the next xsterm id"
        );
        assert_eq!(info.tmux_pane_id.as_deref(), Some("%11"));
        assert_eq!(info.tmux_controller_id, Some(1));
        assert!(!info.is_hidden, "user-driven splits must render normally");
        match info.session_type {
            SessionType::TmuxCc {
                controller_id,
                pane_id,
                ..
            } => {
                assert_eq!(controller_id, 1);
                assert_eq!(pane_id, "%11");
            }
            other => panic!("expected SessionType::TmuxCc, got {other:?}"),
        }

        // The new Session must be registered in the manager's sessions
        // DashMap (otherwise the frontend listener would never see it).
        assert!(
            manager_arc.sessions.contains_key(&info.id),
            "new pane must be inserted into sessions"
        );
    }

    /// `create_tmux_pane` rejects an unknown `direction` string
    /// (anything other than `"horizontal"` / `"vertical"`) instead of
    /// silently defaulting. The frontend uses the typed
    /// `SplitDirection` enum so this is a defensive guard. The
    /// `parent_tmux_pane_id` value is irrelevant — direction parsing
    /// runs first.
    #[tokio::test]
    async fn create_tmux_pane_rejects_unknown_direction() {
        let manager = SessionManager::new();
        let result = manager.create_tmux_pane(1, "%any", "diagonal").await;
        let err = result.expect_err("unknown direction must error");
        assert!(err.contains("invalid split direction"), "got: {err}");
    }

    /// `create_tmux_pane` rejects a parent pane id that is not
    /// registered on the controller (e.g. caller typo'd the id, or
    /// the frontend passed a stale id after a pane closed). The
    /// controller's own `pane_bindings.contains_key` guard surfaces
    /// this — the manager no longer needs to scan `sessions`.
    #[tokio::test]
    async fn create_tmux_pane_errors_on_unknown_parent_pane_id() {
        let manager = SessionManager::new();
        let (controller, _stdin_rx, _dispatch_tx) = make_test_controller(1);
        manager.tmux_controllers.insert(1, Arc::clone(&controller));

        let result = manager.create_tmux_pane(1, "%unknown", "horizontal").await;
        let err = result.expect_err("unknown parent pane id must error");
        assert!(
            err.contains("%unknown") && err.contains("not registered with controller"),
            "expected '%unknown ... not registered with controller' message, got: {err}"
        );
    }

    /// `kill_tmux_pane` accepts `(controller_id, tmux_pane_id)`
    /// directly and writes `kill-pane -t %<id>` to the controller's
    /// stdin. The test asserts that the queued command matches the
    /// expected literal.
    #[tokio::test]
    async fn kill_tmux_pane_invokes_controller_kill_pane() {
        let manager = SessionManager::new();
        let (controller, mut stdin_rx, _dispatch_tx) = make_test_controller(1);
        controller.register_pane("%5".to_string(), 1_000_001);

        manager.tmux_controllers.insert(1, Arc::clone(&controller));

        // Kill the pane. The command must land on the controller's
        // stdin FIFO.
        manager.kill_tmux_pane(1, "%5").expect("kill must succeed");

        let cmd = tokio::time::timeout(std::time::Duration::from_millis(100), stdin_rx.recv())
            .await
            .expect("kill command must arrive on stdin")
            .expect("stdin channel must not be closed");
        assert_eq!(
            cmd, "kill-pane -t %5\n",
            "kill_tmux_pane must queue the literal kill-pane command"
        );
    }

    /// `kill_tmux_pane` returns `Err` when `controller_id` is not
    /// registered (rather than silently no-op'ing). The frontend
    /// uses the Err to surface a clear UI message.
    #[test]
    fn kill_tmux_pane_errors_on_unknown_controller_id() {
        let manager = SessionManager::new();
        let err = manager.kill_tmux_pane(999, "%5").unwrap_err();
        assert!(
            err.contains("tmux controller 999") && err.contains("not registered"),
            "expected 'tmux controller 999 ... not registered' message, got: {err}"
        );
    }

    /// `kill_tmux_pane` returns `Err` when `tmux_pane_id` is not in
    /// the controller's `pane_bindings` — i.e. the pane was never
    /// bound to this controller, or it was already unbound via
    /// [`TmuxController::unbind_pane`]. Replaces the pre-refactor
    /// "non-tmux session" test, which became obsolete when the
    /// manager stopped looking up `sessions`.
    #[tokio::test]
    async fn kill_tmux_pane_errors_on_unknown_tmux_pane_id() {
        let manager = SessionManager::new();
        let (controller, _stdin_rx, _dispatch_tx) = make_test_controller(1);
        manager.tmux_controllers.insert(1, Arc::clone(&controller));

        let err = manager.kill_tmux_pane(1, "%missing").unwrap_err();
        assert!(
            err.contains("%missing") && err.contains("not registered with controller"),
            "expected '%missing ... not registered with controller' message, got: {err}"
        );
    }

    // ===========================================================================
    // Wave 3 tests: tmux window / xsterm Window mapping (SessionManager)
    // ===========================================================================

    /// `create_tmux_window` returns a `SessionInfo` carrying the
    /// tmux window id once the dispatch handshake resolves. Mirrors the
    /// Wave 2 `create_tmux_pane_returns_session_info` shape.
    #[tokio::test]
    async fn create_tmux_window_returns_session_info_with_window_id() {
        let manager = SessionManager::new();
        let (controller, _stdin_rx, dispatch_tx) = make_test_controller(2);

        // Pre-register the bootstrap pane so the dispatch task does NOT
        // take the bootstrap path on the WindowPaneChanged reply.
        controller.register_pane("%0".to_string(), 2_000_001);
        controller.record_first_pane(0, "%0".to_string());

        manager.tmux_controllers.insert(2, Arc::clone(&controller));

        // Kick off `create_tmux_window` in the background. It will block
        // until we feed the dispatch task a `WindowAdd` + matching
        // `WindowPaneChanged`.
        let manager_arc = Arc::new(manager);
        let manager_for_window = Arc::clone(&manager_arc);
        let window_handle = tokio::spawn(async move {
            manager_for_window
                .create_tmux_window(2, Some("editor"))
                .await
        });

        // Yield so the future registers its pending sender.
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;

        // Feed the matching WindowAdd reply.
        dispatch_tx
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::WindowAdd {
                    window_id: "@3".to_string(),
                },
            )
            .expect("dispatch channel must accept WindowAdd");
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // Feed the matching WindowPaneChanged reply.
        dispatch_tx
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::WindowPaneChanged {
                    window_id: "@3".to_string(),
                    pane_id: "%7".to_string(),
                },
            )
            .expect("dispatch channel must accept WindowPaneChanged");

        let info = tokio::time::timeout(std::time::Duration::from_secs(2), window_handle)
            .await
            .expect("create_tmux_window must not time out")
            .expect("create_tmux_window task did not panic")
            .expect("create_tmux_window must succeed on matching reply");

        assert_eq!(info.tmux_window_id.as_deref(), Some("@3"));
        assert_eq!(info.tmux_pane_id.as_deref(), Some("%7"));
        assert_eq!(info.tmux_controller_id, Some(2));
        assert!(!info.is_hidden);
        match info.session_type {
            SessionType::TmuxCc {
                controller_id,
                pane_id,
                ..
            } => {
                assert_eq!(controller_id, 2);
                assert_eq!(pane_id, "%7");
            }
            other => panic!("expected SessionType::TmuxCc, got {other:?}"),
        }

        // The new pane must be registered in the manager's sessions.
        assert!(
            manager_arc.sessions.contains_key(&info.id),
            "new window pane must be inserted into sessions"
        );

        // The controller must have recorded the window binding.
        let bindings = controller.window_bindings();
        assert!(
            bindings.contains(&"@3".to_string()),
            "window_bindings must contain @3, got {bindings:?}"
        );
    }

    /// `kill_tmux_window` and `rename_tmux_window` accept the tmux-side
    /// identifiers directly (the frontend resolves the xsterm Window
    /// id locally). They look up the controller via
    /// `tmux_controllers.get(&controller_id)` and queue the right tmux
    /// command on that controller's stdin FIFO. The controller's own
    /// `window_bindings` map is what rejects a stale `tmux_window_id`.
    #[tokio::test]
    async fn kill_and_rename_tmux_window_invoke_controller_commands() {
        let manager = SessionManager::new();
        let (controller, mut stdin_rx, _dispatch_tx) = make_test_controller(3);
        // Seed `window_bindings` so `controller.kill_window` /
        // `controller.rename_window` accept "@11". The dispatch task
        // populates `window_bindings` on the bootstrap
        // `WindowAdd` → `WindowPaneChanged` pair (no pending sender →
        // controller takes the Bootstrap path).
        let dispatch_tx_clone = _dispatch_tx.clone();
        dispatch_tx_clone
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::WindowAdd {
                    window_id: "@11".to_string(),
                },
            )
            .unwrap();
        dispatch_tx_clone
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::WindowPaneChanged {
                    window_id: "@11".to_string(),
                    pane_id: "%99".to_string(),
                },
            )
            .unwrap();
        // Yield so the dispatch task processes both events.
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;

        manager.tmux_controllers.insert(3, Arc::clone(&controller));

        // kill_tmux_window writes `kill-window -t @11` to the
        // controller's stdin FIFO.
        manager
            .kill_tmux_window(3, "@11")
            .expect("kill_tmux_window on bound window must succeed");
        let cmd1 = tokio::time::timeout(std::time::Duration::from_millis(100), stdin_rx.recv())
            .await
            .expect("kill-window command must arrive on stdin")
            .expect("stdin channel must not be closed");
        assert_eq!(cmd1, "kill-window -t @11\n");

        // rename_tmux_window writes `rename-window -t @11 "..."`.
        manager
            .rename_tmux_window(3, "@11", "my dev shell")
            .expect("rename_tmux_window on bound window must succeed");
        let cmd2 = tokio::time::timeout(std::time::Duration::from_millis(100), stdin_rx.recv())
            .await
            .expect("rename-window command must arrive on stdin")
            .expect("stdin channel must not be closed");
        assert_eq!(cmd2, "rename-window -t @11 \"my dev shell\"\n");

        // Unknown controller_id surfaces from the manager's
        // `tmux_controllers.get` lookup.
        let err = manager.kill_tmux_window(999, "@11").unwrap_err();
        assert!(
            err.contains("tmux controller 999") && err.contains("not registered"),
            "expected 'tmux controller 999 ... not registered' message, got: {err}"
        );
        let err = manager.rename_tmux_window(999, "@11", "x").unwrap_err();
        assert!(
            err.contains("tmux controller 999") && err.contains("not registered"),
            "expected 'tmux controller 999 ... not registered' message, got: {err}"
        );

        // Unknown tmux_window_id on a known controller surfaces from
        // `controller.kill_window`'s `window_bindings.contains_key`
        // guard — i.e. the controller still validates.
        let err = manager.kill_tmux_window(3, "@missing").unwrap_err();
        assert!(
            err.contains("@missing") && err.contains("not registered with controller"),
            "expected '@missing ... not registered with controller' message, got: {err}"
        );
        let err = manager.rename_tmux_window(3, "@missing", "x").unwrap_err();
        assert!(
            err.contains("@missing") && err.contains("not registered with controller"),
            "expected '@missing ... not registered with controller' message, got: {err}"
        );
    }

    // ===========================================================================
    // Wave 4 tests: capture_tmux_pane + list/auto_attach on SessionManager
    // ===========================================================================

    /// `capture_tmux_pane` resolves with the captured text once the
    /// dispatch task receives a matching `%begin..%end` block. Mirrors
    /// the controller-level test but goes through the SessionManager
    /// façade — the manager's role is now just to look up the
    /// controller via `tmux_controllers.get` and delegate; the
    /// session-manager's `sessions` map is NOT consulted.
    #[tokio::test]
    async fn capture_tmux_pane_resolves_via_session_manager() {
        let manager = SessionManager::new();
        let (controller, _stdin_rx, dispatch_tx) = make_test_controller(20);
        // Register the pane on the controller so its own
        // `pane_bindings.contains_key` check inside `capture_pane`
        // accepts "%1".
        controller.register_pane("%1".to_string(), 20_000_001);
        manager.tmux_controllers.insert(20, Arc::clone(&controller));

        let manager_arc = Arc::new(manager);
        let manager_clone = Arc::clone(&manager_arc);
        let capture_handle =
            tokio::spawn(async move { manager_clone.capture_tmux_pane(20, "%1", 200).await });

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // P8 W2: dispatch correlates by registry-allocated command id.
        // Read the id capture_tmux_pane just got from its internal
        // `controller.capture_pane` → `registry.register` call.
        let cmd_id = controller
            .registry
            .ids()
            .into_iter()
            .next()
            .expect("capture_pane must have registered a waiter")
            .0 as u32;

        dispatch_tx
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::CommandBegin {
                    id: cmd_id,
                    timestamp: 0,
                    flags: 0,
                },
            )
            .unwrap();
        dispatch_tx
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::CommandOutput {
                    id: cmd_id,
                    line: "scrollback line".to_string(),
                },
            )
            .unwrap();
        dispatch_tx
            .send(
                crate::services::tmux::protocol::events::ProtocolEvent::CommandEnd {
                    id: cmd_id,
                    timestamp: 0,
                    flags: 0,
                },
            )
            .unwrap();

        let text = tokio::time::timeout(std::time::Duration::from_secs(2), capture_handle)
            .await
            .expect("capture_tmux_pane must not time out")
            .expect("capture task did not panic")
            .expect("capture_tmux_pane must return Ok");
        assert_eq!(text, "scrollback line");
    }

    /// `capture_tmux_pane` errors out cleanly when `controller_id`
    /// is not registered.
    #[tokio::test]
    async fn capture_tmux_pane_errors_on_unknown_controller_id() {
        let manager = SessionManager::new();
        let err = manager
            .capture_tmux_pane(999, "%1", 100)
            .await
            .expect_err("unknown controller must error");
        assert!(
            err.contains("tmux controller 999") && err.contains("not registered"),
            "expected 'tmux controller 999 ... not registered' message, got: {err}"
        );
    }

    /// `capture_tmux_pane` errors out cleanly when `tmux_pane_id` is
    /// not bound on the named controller — surfaces from
    /// `controller.capture_pane`'s own `pane_bindings.contains_key`
    /// guard.
    #[tokio::test]
    async fn capture_tmux_pane_errors_on_unknown_tmux_pane_id() {
        let manager = SessionManager::new();
        let (controller, _stdin_rx, _dispatch_tx) = make_test_controller(1);
        manager.tmux_controllers.insert(1, Arc::clone(&controller));

        let err = manager
            .capture_tmux_pane(1, "%missing", 100)
            .await
            .expect_err("unknown tmux pane id must error");
        assert!(
            err.contains("%missing") && err.contains("not registered with controller"),
            "expected '%missing ... not registered with controller' message, got: {err}"
        );
    }

    /// `list_attached_tmux_servers` projects every tmux controller
    /// with a non-empty `session_name` into an `AttachedTmuxServer`. The
    /// `session_name()` accessor round-trips the value `spawn_attach`
    /// would have written. A controller with `session_name == None`
    /// (e.g. `spawn_create`) is filtered out of the projection.
    #[test]
    fn session_name_and_list_attached_tmux_servers_round_trip() {
        let manager = SessionManager::new();
        struct StubBackend;
        impl crate::infrastructure::app_backend::AppBackend for StubBackend {
            fn emit(&self, _: &str, _: &serde_json::Value) -> Result<(), String> {
                Ok(())
            }
            fn emit_binary(&self, _: Vec<u8>) -> Result<(), String> {
                Ok(())
            }
            fn spawn(&self, _: Box<dyn FnOnce() + Send>) {}
        }
        let backend: Arc<dyn AppBackend> = Arc::new(StubBackend);
        let controller = TmuxController::new_for_tests(
            50,
            tokio::sync::mpsc::unbounded_channel::<String>().0,
            backend.clone(),
        );
        controller.set_session_name_for_tests("dev");
        manager.tmux_controllers.insert(50, controller);

        let servers = manager.list_attached_tmux_servers();
        assert_eq!(servers.len(), 1, "got {servers:?}");
        assert_eq!(servers[0].session_name, "dev");
        assert!(servers[0].attached_at > 0, "attached_at must be ms epoch");

        let plain = TmuxController::new_for_tests(
            51,
            tokio::sync::mpsc::unbounded_channel::<String>().0,
            backend,
        );
        manager.tmux_controllers.insert(51, plain);
        assert_eq!(manager.list_attached_tmux_servers().len(), 1);
    }
}
