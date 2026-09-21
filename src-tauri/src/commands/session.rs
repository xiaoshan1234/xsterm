use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::infrastructure::app_backend::{AppBackend, RealAppBackend};
use crate::models::session::{
    AttachedTmuxServer, LocalSessionConfig, SSHSessionConfig, SessionConfig, SessionInfo,
    TmuxCcConfig, TmuxSessionInit,
};
use crate::services::session_manager::{AutoAttachOutcome, SessionManager};

/// Hard ceiling on a single `write_session` payload. The frontend sends one
/// IPC call per paste (Perf 011 made that feasible by offloading the actual
/// `write_all` to a dedicated thread), so a healthy client never reaches
/// this — it's a defence-in-depth limit against a misbehaving caller. See
/// doc/maintenance/perf.md Perf 010.
const MAX_WRITE_PAYLOAD_BYTES: usize = 1024 * 1024;

/// Create a new local shell session.
#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating local session");
    let backend: Arc<dyn crate::infrastructure::app_backend::AppBackend> =
        Arc::new(RealAppBackend::new(app));
    state.create_local(config, backend).inspect(|info| {
        tracing::info!("Local session created: id={}", info.id);
    })
}

/// Create a new SSH session.
#[tauri::command]
pub async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!(
        "Creating SSH session: {}@{}:{}",
        config.username,
        config.host,
        config.port
    );
    let backend: Arc<dyn crate::infrastructure::app_backend::AppBackend> =
        Arc::new(RealAppBackend::new(app));
    state.create_ssh(config, backend).inspect(|info| {
        tracing::info!("SSH session created: id={}", info.id);
    })
}

/// Create a new session from a generic [`SessionConfig`] discriminated union.
///
/// This is the unified entry point the frontend uses to create either a local
/// shell session or an SSH session through a single command. The legacy
/// `create_local_session` and `create_ssh_session` commands remain available
/// for backward compatibility.
#[tauri::command]
pub async fn create_session(
    config: SessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    tracing::info!("Creating session via generic SessionConfig");
    let backend: Arc<dyn crate::infrastructure::app_backend::AppBackend> =
        Arc::new(RealAppBackend::new(app));
    match config {
        SessionConfig::Local(local) => state
            .create_local(local, backend)
            .map(serde_json::to_value)
            .and_then(|r| r.map_err(|e| e.to_string())),
        SessionConfig::Ssh(ssh) => state
            .create_ssh(ssh, backend)
            .map(serde_json::to_value)
            .and_then(|r| r.map_err(|e| e.to_string())),
        SessionConfig::TmuxCc(tmux) => {
            tracing::info!(
                "[DEBUG-0009-RUST] create_session routing to create_tmux config={:?}",
                tmux
            );
            state
                .create_tmux(&tmux, backend)
                .await
                .map(serde_json::to_value)
                .and_then(|r| r.map_err(|e| e.to_string()))
        }
    }
    .inspect(|value| {
        if let Some(id) = value
            .get("session")
            .and_then(|s| s.get("id"))
            .and_then(|v| v.as_u64())
        {
            tracing::info!(
                "[DEBUG-0009-RUST] Session created via generic command: id={}",
                id
            );
        } else if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
            tracing::info!(
                "[DEBUG-0009-RUST] Session created via generic command: id={}",
                id
            );
        }
    })
}

/// Write input data to an existing session.
///
/// Hot path for terminal input — including the paste pipeline. With Perf 004
/// (DashMap-backed registry) this no longer takes any global lock: the
/// payload size guard runs first, then `state.write` looks up the session
/// by id via `DashMap::get` and dispatches to the backend's
/// `write(&self, data)`.
#[tauri::command]
pub async fn write_session(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    if data.len() > MAX_WRITE_PAYLOAD_BYTES {
        return Err(format!(
            "write payload too large: {} bytes (max {})",
            data.len(),
            MAX_WRITE_PAYLOAD_BYTES
        ));
    }
    state.write(session_id, &data)
}

/// Resize the PTY of an existing session.
/// Resize a tmux pane via `resize-pane -t %<pane> -x <cols> -y <rows>`.
///
/// Symmetric with `kill_tmux_pane` / `capture_tmux_pane`: takes the
/// server-side `(controller_id, tmux_pane_id)` pair, no xsterm session
/// id involved (the frontend resolves the mapping locally from the
/// `tmux-pane-added` event payload).
#[tauri::command]
pub async fn resize_tmux_pane(
    controller_id: u32,
    tmux_pane_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    state
        .resize_tmux_pane(controller_id, &tmux_pane_id, rows, cols)
        .await
}

/// Resize a local PTY session via TIOCSWINSZ ioctl. Takes the
/// universal `Session.id` (the same one `write_session` /
/// `close_session` use).
#[tauri::command]
pub async fn resize_pty_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    state.resize_pty_session(session_id, rows, cols)
}

/// Resize an SSH session's russh channel via `window-change`. Takes
/// the universal `Session.id`.
#[tauri::command]
pub async fn resize_ssh_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    state.resize_ssh_session(session_id, rows, cols)
}

/// Close an existing session.
#[tauri::command]
pub async fn close_session(
    session_id: u32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!("Closing session: id={}", session_id);
    state.close(session_id)
}

/// List metadata for all active sessions.
#[tauri::command]
pub fn list_sessions(state: State<'_, Arc<SessionManager>>) -> Result<Vec<SessionInfo>, String> {
    Ok(state.list())
}

/// Upload an image file to the SSH server for the given session and return the
/// remote path where it was stored.
#[tauri::command]
pub fn upload_image_to_ssh_session(
    session_id: u32,
    filename: String,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    state.upload_image(session_id, &filename, data)
}

/// Create a new tmux `-CC` controller session.
///
/// Spawns a `tmux -CC` child process and waits for the first pane to be
/// Synchronously returns the full initial state of the controller
/// (n windows + m panes + 1 control window) so the frontend can
/// render the entire workspace from one IPC reply.
#[tauri::command]
pub async fn create_tmux_session(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TmuxSessionInit, String> {
    tracing::info!(
        "[DEBUG-0009-RUST] create_tmux_session command ENTRY config={:?}",
        config
    );
    tracing::info!(
        "Creating tmux -CC session: name={:?} tmux_session={:?} socket={:?} base_config_id={:?} has_ssh={}",
        config.name,
        config.tmux_session_name,
        config.socket_name,
        config.base_config_id,
        config.ssh.is_some()
    );
    let arc_real: Arc<RealAppBackend> = Arc::clone(backend.inner());
    let dyn_backend: Arc<dyn AppBackend> = arc_real;
    let result = state.create_tmux(&config, dyn_backend).await;
    tracing::info!(
        "[DEBUG-0009-RUST] create_tmux_session command EXIT ok={} info={:?}",
        result.is_ok(),
        result
            .as_ref()
            .map(|init| (init.session.id, init.windows.len(), init.panes.len()))
    );
    if let Err(ref e) = result {
        tracing::error!(
            "create_tmux_session failed: {} (config was: name={:?}, tmux_session={:?}, socket={:?}, base_config_id={:?}, has_ssh={})",
            e,
            config.name,
            config.tmux_session_name,
            config.socket_name,
            config.base_config_id,
            config.ssh.is_some()
        );
    }
    if result.is_ok() {
        // refresh `attached_tmux.json` with the up-to-date list.
        // Best-effort: a transient store failure must not mask a successful
        // create.
        let servers = state.list_attached_tmux_servers();
        if let Err(e) =
            crate::commands::persistence::save_attached_tmux_servers_impl(&app, &servers)
        {
            tracing::warn!("create_tmux_session: persistence failed: {e}");
        }
    }
    result.inspect(|init| {
        tracing::info!(
            "tmux session created: id={} controller_id={} {} windows, {} panes returned",
            init.session.id,
            init.session.tmux_controller_id.unwrap_or(0),
            init.windows.len(),
            init.panes.len(),
        );
    })
}

/// Return the shared binary `session-output` channel. The frontend calls
/// this once at startup and attaches a per-session dispatch handler. See
/// `src/hooks/sessionOutputChannel.ts` for the consumer side and
/// `src-tauri/src/infrastructure/binary_frame.rs` for the wire format
/// (Perf 001).
#[tauri::command]
pub fn get_session_output_channel(backend: State<'_, Arc<RealAppBackend>>) -> Channel<Vec<u8>> {
    backend.session_output_channel.clone()
}

/// Split a tmux pane via `split-window`.
///
/// Returns a [`SessionInfo`] for the newly created pane (a fresh
/// xsterm session whose backend is a new tmux pane); the frontend
/// binds it to a new xsterm pane leaf in the PaneTree.
///
/// Parameters:
/// - `controller_id` — id of the `tmux -CC` controller that owns the
///   parent pane.
/// - `parent_tmux_pane_id` — **server-side** tmux pane id (e.g.
///   `"%5"`) of the parent. NOT an xsterm session id, NOT an xsterm
///   pane UUID. The frontend received this id from the
///   `tmux-pane-added` event payload (which also carries the
///   matching `controllerId`) and tracks it alongside the xsterm
///   pane leaf.
/// - `direction` — `"horizontal"` (`split-window -h`, right of parent)
///   or `"vertical"` (`split-window -v`, below parent).
///
/// The frontend performs the local-id → server-id resolution before
/// invoking this command (xsterm session id ↦
/// `(controller_id, tmux_pane_id)`); the backend does not look up
/// either side via `sessions`. See
/// [`SessionManager::create_tmux_pane`] for the dispatch.
///
/// Returns a [`SessionInfo`] for the newly created pane, with
/// `is_hidden = false` because user-driven splits must render normally.
/// The controller also fires a `tmux-pane-added` event with the
/// `parentTmuxWindowId` field; the frontend listener for that event is
/// idempotent (skips if a Session with the new id already exists).
#[tauri::command]
pub async fn create_tmux_pane(
    controller_id: u32,
    parent_tmux_pane_id: String,
    direction: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<SessionInfo, String> {
    tracing::info!(
        "create_tmux_pane: controller_id={} parent_tmux_pane_id={:?} direction={:?}",
        controller_id,
        parent_tmux_pane_id,
        direction,
    );
    state
        .create_tmux_pane(controller_id, &parent_tmux_pane_id, &direction)
        .await
        .inspect(|info| {
            tracing::info!(
                "create_tmux_pane: new pane xsterm_id={} tmux_pane_id={:?}",
                info.id,
                info.tmux_pane_id,
            );
        })
}

/// Kill a tmux pane via `kill-pane`.
///
/// `controller_id` + `tmux_pane_id` follow the same convention as
/// [`create_tmux_pane`](Self::create_tmux_pane): the frontend
/// resolves the xsterm session id locally and sends the tmux-side
/// identifiers directly. On success the controller eventually emits
/// a `tmux-pane-removed` event when tmux sends `%pane-exited`; the
/// frontend listener drops the matching `Session` from React state
/// at that point.
#[tauri::command]
pub async fn kill_tmux_pane(
    controller_id: u32,
    tmux_pane_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!(
        "kill_tmux_pane: controller_id={} tmux_pane_id={:?}",
        controller_id,
        tmux_pane_id
    );
    state.kill_tmux_pane(controller_id, &tmux_pane_id)
}

/// Attach to an existing tmux server (Wave 4 §D4, req-006 §5).
///
/// Spawns `tmux -CC attach-session -t <name>` and waits for the first
/// pane before returning. The bootstrap pane is registered with
/// `is_hidden = true` (iTerm2 D3 pattern) so the frontend suppresses it
/// until the user opens a real working pane via `create_tmux_window` /
/// `create_tmux_pane`.
///
/// `tmux_session_name` is required; attaching to "the server's current
/// session" is non-deterministic when several exist on the same socket.
#[tauri::command]
pub async fn attach_tmux_session(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TmuxSessionInit, String> {
    tracing::info!(
        "Attaching to tmux server: name={:?} tmux_session={:?} socket={:?}",
        config.name,
        config.tmux_session_name,
        config.socket_name,
    );
    let arc_real: Arc<RealAppBackend> = Arc::clone(backend.inner());
    let dyn_backend: Arc<dyn AppBackend> = arc_real;
    let result = state.attach_tmux(&config, dyn_backend).await;
    if result.is_ok() {
        let servers = state.list_attached_tmux_servers();
        if let Err(e) =
            crate::commands::persistence::save_attached_tmux_servers_impl(&app, &servers)
        {
            tracing::warn!("attach_tmux_session: persistence failed: {e}");
        }
    }
    result.inspect(|init| {
        tracing::info!(
            "tmux attach succeeded: id={} controller_id={} {} windows, {} panes returned",
            init.session.id,
            init.session.tmux_controller_id.unwrap_or(0),
            init.windows.len(),
            init.panes.len(),
        );
    })
}

/// open a new tmux window on the given controller.
///
/// Parameters mirror req-006 §4.5:
/// - `controller_id` — id of the `tmux -CC` controller that owns the
///   current session.
/// - `name` — optional display name for the new window. `None` lets
///   tmux pick a default name based on the running command.
///
/// Returns the [`SessionInfo`] for the first pane of the new window;
/// the controller also emits `tmux-window-added` and `tmux-pane-added`
/// events which the frontend listener uses to keep its state in sync
/// (idempotent — if the Session already exists, the listener short-
/// circuits).
#[tauri::command]
pub async fn create_tmux_window(
    controller_id: u32,
    name: Option<String>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<SessionInfo, String> {
    tracing::info!(
        "create_tmux_window: controller_id={} name={:?}",
        controller_id,
        name,
    );
    state
        .create_tmux_window(controller_id, name.as_deref())
        .await
        .inspect(|info| {
            tracing::info!(
                "create_tmux_window: new window pane xsterm_id={} tmux_window_id={:?}",
                info.id,
                info.tmux_window_id,
            );
        })
}

/// kill a tmux window via `kill-window`.
///
/// `controller_id` identifies the `tmux -CC` controller that owns
/// the window (the frontend tracks this alongside each xsterm
/// Window — it is the same `controllerId` field carried by the
/// `tmux-window-added` / `tmux-window-closed` payloads).
/// `tmux_window_id` is the server-side tmux window id (e.g.
/// `"@5"`) — also received from the `tmux-window-added` event.
///
/// The frontend performs the local-id → server-id resolution before
/// invoking this command: xsterm Window id ↦ (controller_id,
/// tmux_window_id). The backend therefore accepts the tmux-side
/// identifiers directly and does not need to scan every
/// controller's `window_bindings` to look them up. See
/// [`SessionManager::kill_tmux_window`] for the controller
/// dispatch.
///
/// On success the controller eventually emits a `tmux-window-closed`
/// event when tmux sends `%window-close`; the frontend listener
/// drops the matching xsterm Window and every Session in it at
/// that point.
#[tauri::command]
pub async fn kill_tmux_window(
    controller_id: u32,
    tmux_window_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!(
        "kill_tmux_window: controller_id={} tmux_window_id={:?}",
        controller_id,
        tmux_window_id
    );
    state.kill_tmux_window(controller_id, &tmux_window_id)
}

/// rename a tmux window via `rename-window`.
///
/// `controller_id` + `tmux_window_id` follow the same convention as
/// [`kill_tmux_window`](Self::kill_tmux_window): the frontend
/// resolves the xsterm Window id locally and sends the tmux-side
/// identifiers directly. On success the controller eventually emits
/// a `tmux-window-renamed` event when tmux sends `%window-renamed`;
/// the frontend listener updates the matching xsterm Window's
/// `name` at that point.
///
/// capture scrollback text from a tmux pane (req-006 §D4).
///
/// `controller_id` + `tmux_pane_id` follow the same convention as
/// [`kill_tmux_pane`](Self::kill_tmux_pane): the frontend resolves
/// the xsterm session id locally and sends the tmux-side identifiers
/// directly. The returned text is the body of tmux's
/// `%begin..%end` reply block for
/// `capture-pane -p -e -J -S -<lines> -t %<pane>`, joined with `\n`.
///
/// Frontend wrapper: `sessionService.captureTmuxPane(controllerId, tmuxPaneId, lines)`.
/// Returns `Err` if `controller_id` is unknown / `tmux_pane_id` is
/// not registered on the controller / tmux itself reports `%error`
/// / the call times out after 5 s.
#[tauri::command]
pub async fn capture_tmux_pane(
    controller_id: u32,
    tmux_pane_id: String,
    lines: i32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    tracing::info!(
        "capture_tmux_pane: controller_id={} tmux_pane_id={:?} lines={}",
        controller_id,
        tmux_pane_id,
        lines
    );
    state
        .capture_tmux_pane(controller_id, &tmux_pane_id, lines)
        .await
}

/// list every tmux server currently attached via this manager.
///
/// Frontend wrapper: `sessionService.getAttachedTmuxServers()`. Returns
/// the same shape as the on-disk `attached_tmux.json` store so the
/// frontend can render the persisted list.
#[tauri::command]
pub async fn get_attached_tmux_servers(
    state: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AttachedTmuxServer>, String> {
    Ok(state.list_attached_tmux_servers())
}

/// re-attach every tmux server from the persisted
/// `attached_tmux.json` store.
///
/// Frontend wrapper: `sessionService.autoAttachTmuxServers()`. Called
/// once on app startup to restore previous tmux sessions. The returned
/// list carries one entry per previously-attached server — successful
/// re-attachs expose the new `SessionInfo`; failures surface the error
/// string so the frontend can show partial-failure UI.
///
/// Note: This is NOT full state restore — attach merely reconnects the
/// controller to the tmux server; the user opens new panes/windows
/// afterwards. See Wave 4 spec §D4 / req-006 §5 for the rationale.
#[tauri::command]
pub async fn auto_attach_tmux_servers(
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<Vec<AutoAttachOutcome>, String> {
    let arc_real: Arc<RealAppBackend> = Arc::clone(backend.inner());
    let dyn_backend: Arc<dyn AppBackend> = arc_real;
    let stored = crate::commands::persistence::load_attached_tmux_servers(app.clone()).await?;
    let results = state.auto_attach_on_startup(&stored, dyn_backend).await;
    // Persist the (possibly reduced) live list so a failed server that
    // got dropped does not keep haunting subsequent startups.
    let live = state.list_attached_tmux_servers();
    if let Err(e) = crate::commands::persistence::save_attached_tmux_servers_impl(&app, &live) {
        tracing::warn!("auto_attach_tmux_servers: persistence failed: {e}");
    }
    Ok(results)
}

#[tauri::command]
pub async fn rename_tmux_window(
    controller_id: u32,
    tmux_window_id: String,
    name: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!(
        "rename_tmux_window: controller_id={} tmux_window_id={:?} name={:?}",
        controller_id,
        tmux_window_id,
        name,
    );
    state.rename_tmux_window(controller_id, &tmux_window_id, &name)
}

/// Register a batch of pre-existing tmux panes into the session
/// manager's `sessions` map. Each entry is
/// `(xsterm_session_id, controller_id, tmux_pane_id)`; the session
/// manager looks up the controller and registers the existing pane
/// (already bound to its `pane_bindings` entry) under the requested
/// xsterm session id. Returns the list of registered xsterm session
/// ids.
///
/// Used by the frontend after the bootstrap `tmux-pane-list` event
/// fires: the frontend creates a Session node for each pane and then
/// asks the backend to make the corresponding tmux backend live so
/// `writeSession(xsterm_session_id, …)` routes correctly (Bug 021).
#[tauri::command]
pub async fn register_existing_tmux_panes(
    panes: Vec<(u32, u32, String)>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<Vec<u32>, String> {
    use crate::models::capabilities::CapabilityFlags;
    use crate::models::session::tmux_pane_info;
    use crate::services::session_manager::TmuxPaneHandle;
    let mut specs = Vec::with_capacity(panes.len());
    for (xsterm_session_id, controller_id, tmux_pane_id) in panes {
        let controller = state.tmux_controller_by_id(controller_id)?;
        // `is_hidden = false`: these are working panes from `tmux-pane-list`,
        // not the bootstrap pane of a `tmux -CC attach` (D3 in req-006).
        let info = tmux_pane_info(
            xsterm_session_id,
            controller_id,
            tmux_pane_id.clone(),
            None,
            None,
            false,
            None,
        );
        let capabilities = CapabilityFlags::for_tmux();
        let handle = TmuxPaneHandle::new(controller, tmux_pane_id, info, capabilities);
        specs.push((
            xsterm_session_id,
            handle.controller.clone(),
            handle.tmux_pane_id.clone(),
            handle.info.clone(),
            handle.capabilities.clone(),
        ));
    }
    state.register_existing_tmux_panes(specs)
}

/// Probe the tmux server for a session with the same name as
/// `config.tmux_session_name`. Returns `true` if the session already
/// exists, `false` otherwise. The Create Session dialog calls this
/// before deciding between `create_tmux_session` and
/// `attach_tmux_session` — see
/// `doc/ai-terminal-migration/04-tmux-redesign-v0.md` and the
/// `probe_tmux_session_exists` method on `SessionManager` for the
/// rationale.
///
/// Returns `Err(_)` only for transport / spawn failures (not for
/// "session not found"). SSH is currently not supported by the probe
/// (a follow-up PR); the method returns `Err` for SSH configs so the
/// frontend can fall back to its previous behaviour.
#[tauri::command]
pub async fn probe_tmux_session_exists(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool, String> {
    state.probe_tmux_session_exists(&config).await
}

/// Detach the control client for a tmux controller from its server
/// without destroying the server-side session + windows. ADR 0009
/// §2.9 + §2.4 row "Disconnect".
///
/// Fire-and-forget: writes `detach-client -s "<name>"` to the
/// controller's stdin and drops the controller from the manager; the
/// tmux child exits naturally and the dispatch task emits
/// `tmux-controller-exit` for the frontend listener. Idempotent —
/// unknown `controller_id` returns `Ok(())`.
#[tauri::command]
pub async fn detach_tmux_controller(
    controller_id: u32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!("detach_tmux_controller: controller_id={}", controller_id);
    state.detach_tmux_controller(controller_id)
}

/// Shut down the entire tmux server reachable via `controller_id`
/// (every session, every window, every pane). ADR 0009 §2.9 + §2.4
/// row "Remote delete".
///
/// Fire-and-forget: writes `kill-server` to the controller's stdin;
/// the tmux child exits because its server is gone. The dispatch
/// task emits `tmux-controller-exit` for the frontend listener.
/// Idempotent — unknown `controller_id` returns `Ok(())`.
#[tauri::command]
pub async fn kill_server_via_controller(
    controller_id: u32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!(
        "kill_server_via_controller: controller_id={}",
        controller_id
    );
    state.kill_server_via_controller(controller_id)
}

/// Remove a controller's entry from the persisted `attached_tmux.json`
/// store so the next startup does not auto-attach it. ADR 0009 §2.9 +
/// A9.
///
/// Called from two paths:
/// - "Close control-window" in the UI (after the windows have been
///   torn down via `closeSession`).
/// - "Remote delete" in the session-control UI (after
///   `kill_server_via_controller` fired).
#[tauri::command]
pub async fn unmark_attached_tmux(
    controller_id: u32,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<(), String> {
    tracing::info!("unmark_attached_tmux: controller_id={}", controller_id);
    state.unmark_attached_tmux(controller_id, &app)
}
