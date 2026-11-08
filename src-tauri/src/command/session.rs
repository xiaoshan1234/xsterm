use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::connect::app_backend::{AppBackend, RealAppBackend};
use crate::connect::registry::{AutoAttachOutcome, TerminalRegistry};
use crate::feature::logging::session_log::TerminalLoggingBackend;
use crate::shared::session::{
    AttachedTmuxServer, LocalTerminalConfig, SshConfig, TerminalInfo, TerminalLoggingConfig,
    TmuxSessionConfig,
};

/// Hard ceiling on a single `write_terminal` payload. The frontend sends one
/// IPC call per paste (Perf 011 made that feasible by offloading the actual
/// `write_all` to a dedicated thread), so a healthy client never reaches
/// this — it's a defence-in-depth limit against a misbehaving caller. See
/// doc/maintenance/perf.md Perf 010.
const MAX_WRITE_PAYLOAD_BYTES: usize = 1024 * 1024;

/// Create a new local shell session.
#[tauri::command]
pub async fn create_local_terminal(
    config: LocalTerminalConfig,
    logging: Option<TerminalLoggingConfig>,
    state: State<'_, Arc<TerminalRegistry>>,
    app: AppHandle,
) -> Result<TerminalInfo, String> {
    tracing::info!("Creating local session");
    let inner: Arc<dyn AppBackend> = Arc::new(RealAppBackend::new(app));
    let backend: Arc<dyn AppBackend> =
        Arc::new(TerminalLoggingBackend::new(inner, state.session_logs()));
    state
        .create_local(config, backend, logging)
        .inspect(|info| {
            tracing::info!("Local session created: id={}", info.id);
        })
}

/// Create a new SSH session.
#[tauri::command]
pub async fn create_ssh_terminal(
    config: SshConfig,
    logging: Option<TerminalLoggingConfig>,
    state: State<'_, Arc<TerminalRegistry>>,
    app: AppHandle,
) -> Result<TerminalInfo, String> {
    tracing::info!(
        "Creating SSH session: {}@{}:{}",
        config.username,
        config.host,
        config.port
    );
    let inner: Arc<dyn AppBackend> = Arc::new(RealAppBackend::new(app));
    let backend: Arc<dyn AppBackend> =
        Arc::new(TerminalLoggingBackend::new(inner, state.session_logs()));
    state
        .create_ssh(config, backend, logging)
        .await
        .inspect(|info| {
            tracing::info!("SSH session created: id={}", info.id);
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
pub async fn write_terminal(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    if data.len() > MAX_WRITE_PAYLOAD_BYTES {
        return Err(format!(
            "write payload too large: {} bytes (max {})",
            data.len(),
            MAX_WRITE_PAYLOAD_BYTES
        ));
    }
    state.write(session_id, &data).await
}

/// Resize the PTY of an existing session.
#[tauri::command]
pub async fn resize_terminal(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    state.resize(session_id, rows, cols).await
}

/// Close an existing session.
#[tauri::command]
pub async fn close_terminal(
    session_id: u32,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    tracing::info!("Closing session: id={}", session_id);
    state.close(session_id).await
}

/// List metadata for all active sessions.
#[tauri::command]
pub fn list_terminals(
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<Vec<TerminalInfo>, String> {
    Ok(state.list())
}

/// Upload an image file to the SSH server for the given session and return the
/// remote path where it was stored.
#[tauri::command]
pub fn upload_image_to_ssh_terminal(
    session_id: u32,
    filename: String,
    data: Vec<u8>,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<String, String> {
    state.upload_image(session_id, &filename, data)
}

/// Create a new tmux `-CC` controller session.
///
/// Spawns a `tmux -CC` child process and waits for the first pane to be
/// reported before returning. The registered pane is the bootstrap pane
/// tmux occupies on `tmux -CC new` (D3 in
/// `doc/requirements/prd-0.1/req-006-tmux.md`) and is marked
/// `is_hidden = true` so the frontend suppresses it.
#[tauri::command]
pub async fn create_tmux_session(
    config: TmuxSessionConfig,
    logging: Option<TerminalLoggingConfig>,
    state: State<'_, Arc<TerminalRegistry>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TerminalInfo, String> {
    tracing::info!(
        "Creating tmux -CC session: name={:?} tmux_session={:?} socket={:?} base_config_id={:?} has_ssh={}",
        config.name,
        config.tmux_session_name,
        config.socket_name,
        config.base_config_id,
        config.ssh.is_some()
    );
    let arc_real: Arc<RealAppBackend> = Arc::clone(backend.inner());
    let inner: Arc<dyn AppBackend> = arc_real;
    let wrapped: Arc<dyn AppBackend> =
        Arc::new(TerminalLoggingBackend::new(inner, state.session_logs()));
    let result = state.create_tmux(&config, wrapped, logging).await;
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
        if let Err(e) = crate::command::persistence::save_attached_tmux_servers_impl(&app, &servers)
        {
            tracing::warn!("create_tmux_session: persistence failed: {e}");
        }
    }
    result.inspect(|info| {
        tracing::info!(
            "tmux session created: id={} controller_id={} pane={:?} hidden={}",
            info.id,
            info.tmux_session_id().unwrap_or(0),
            info.tmux_pane_id(),
            info.is_hidden,
        );
    })
}

/// Split the tmux pane backing an xsterm session via `split-window`.
///
/// Returns a [`TerminalInfo`] for the newly created pane (a fresh
/// xsterm session whose backend is a new tmux pane); the frontend
/// binds it to a new xsterm pane leaf in the PaneTree.
///
/// Parameters:
/// - `controller_id` — id of the `tmux -CC` controller that owns the
///   parent session's tmux pane.
/// - `parent_xsterm_session_id` — **xsterm** session id (`Session.id`
///   in React state) of the parent. NOT a tmux pane id, NOT an xsterm
///   pane UUID.
/// - `direction` — `"horizontal"` (`split-window -h`, right of parent)
///   or `"vertical"` (`split-window -v`, below parent).
///
/// Returns a [`TerminalInfo`] for the newly created pane, with
/// `is_hidden = false` because user-driven splits must render normally.
/// The controller also fires a `tmux-pane-added` event with the
/// `parentTmuxWindowId` field; the frontend listener for that event is
/// idempotent (skips if a Session with the new id already exists).
#[tauri::command]
pub async fn create_tmux_pane(
    controller_id: u32,
    parent_xsterm_session_id: u32,
    direction: String,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<TerminalInfo, String> {
    tracing::info!(
        "create_tmux_pane: controller_id={} parent_xsterm_session_id={} direction={:?}",
        controller_id,
        parent_xsterm_session_id,
        direction,
    );
    state
        .create_tmux_pane(controller_id, parent_xsterm_session_id, &direction)
        .await
        .inspect(|info| {
            tracing::info!(
                "create_tmux_pane: new pane xsterm_id={} tmux_pane_id={:?}",
                info.id,
                info.tmux_pane_id(),
            );
        })
}

/// Kill the tmux pane backing an xsterm session via `kill-pane`.
///
/// `xsterm_session_id` is the **xsterm** session id (the leaf-bound
/// `Session.id` from React state), NOT a tmux pane id or xsterm pane
/// UUID. The command name reflects the tmux-side effect (`kill-pane`);
/// the argument reflects the xsterm-side caller identifier. On success
/// the controller eventually emits a `tmux-pane-removed` event when tmux
/// sends `%pane-exited`; the frontend listener drops the matching
/// `Session` from React state at that point.
#[tauri::command]
pub async fn kill_tmux_pane(
    xsterm_session_id: u32,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    tracing::info!("kill_tmux_pane: xsterm_session_id={}", xsterm_session_id);
    state.kill_tmux_pane(xsterm_session_id)
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
    config: TmuxSessionConfig,
    state: State<'_, Arc<TerminalRegistry>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TerminalInfo, String> {
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
        if let Err(e) = crate::command::persistence::save_attached_tmux_servers_impl(&app, &servers)
        {
            tracing::warn!("attach_tmux_session: persistence failed: {e}");
        }
    }
    result.inspect(|info| {
        tracing::info!(
            "tmux attach succeeded: id={} controller_id={} pane={:?} hidden={}",
            info.id,
            info.tmux_session_id().unwrap_or(0),
            info.tmux_pane_id(),
            info.is_hidden,
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
/// Returns the [`TerminalInfo`] for the first pane of the new window;
/// the controller also emits `tmux-window-added` and `tmux-pane-added`
/// events which the frontend listener uses to keep its state in sync
/// (idempotent — if the Session already exists, the listener short-
/// circuits).
#[tauri::command]
pub async fn create_tmux_window(
    controller_id: u32,
    name: Option<String>,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<TerminalInfo, String> {
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
/// `xsterm_window_id` is the **xsterm** window id (matches
/// `killTmuxWindow` on the frontend). On success the controller
/// eventually emits a `tmux-window-closed` event when tmux sends
/// `%window-close`; the frontend listener drops the matching
/// xsterm Window and every Session in it at that point.
#[tauri::command]
pub async fn kill_tmux_window(
    xsterm_window_id: u32,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    tracing::info!("kill_tmux_window: xsterm_window_id={}", xsterm_window_id);
    state.kill_tmux_window(xsterm_window_id)
}

/// rename a tmux window via `rename-window`.
///
/// On success the controller eventually emits a `tmux-window-renamed`
/// event when tmux sends `%window-renamed`; the frontend listener
/// updates the matching xsterm Window's `name` at that point.
/// capture scrollback text from a tmux pane (req-006 §D4).
///
/// Frontend wrapper: `sessionService.captureTmuxPane(sessionId, lines)`.
/// The returned text is the body of tmux's `%begin..%end` reply block for
/// `capture-pane -p -e -J -S -<lines> -t %<pane>`, joined with `\n`.
/// Returns `Err` if the session is unknown / not a tmux pane / tmux
/// itself reports `%error` / the call times out after 5 s.
#[tauri::command]
pub async fn capture_tmux_pane(
    xsterm_session_id: u32,
    lines: i32,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<String, String> {
    tracing::info!(
        "capture_tmux_pane: xsterm_session_id={} lines={}",
        xsterm_session_id,
        lines
    );
    state.capture_tmux_pane(xsterm_session_id, lines).await
}

/// list every tmux server currently attached via this manager.
///
/// Frontend wrapper: `sessionService.getAttachedTmuxServers()`. Returns
/// the same shape as the on-disk `attached_tmux.json` store so the
/// frontend can render the persisted list.
#[tauri::command]
pub async fn get_attached_tmux_servers(
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<Vec<AttachedTmuxServer>, String> {
    Ok(state.list_attached_tmux_servers())
}

/// re-attach every tmux server from the persisted
/// `attached_tmux.json` store.
///
/// Frontend wrapper: `sessionService.autoAttachTmuxServers()`. Called
/// once on app startup to restore previous tmux sessions. The returned
/// list carries one entry per previously-attached server — successful
/// re-attachs expose the new `TerminalInfo`; failures surface the error
/// string so the frontend can show partial-failure UI.
///
/// Note: This is NOT full state restore — attach merely reconnects the
/// controller to the tmux server; the user opens new panes/windows
/// afterwards. See Wave 4 spec §D4 / req-006 §5 for the rationale.
#[tauri::command]
pub async fn auto_attach_tmux_servers(
    state: State<'_, Arc<TerminalRegistry>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<Vec<AutoAttachOutcome>, String> {
    let arc_real: Arc<RealAppBackend> = Arc::clone(backend.inner());
    let dyn_backend: Arc<dyn AppBackend> = arc_real;
    let stored = crate::command::persistence::load_attached_tmux_servers(app.clone()).await?;
    let results = state.auto_attach_on_startup(&stored, dyn_backend).await;
    // Persist the (possibly reduced) live list so a failed server that
    // got dropped does not keep haunting subsequent startups.
    let live = state.list_attached_tmux_servers();
    if let Err(e) = crate::command::persistence::save_attached_tmux_servers_impl(&app, &live) {
        tracing::warn!("auto_attach_tmux_servers: persistence failed: {e}");
    }
    Ok(results)
}

#[tauri::command]
pub async fn rename_tmux_window(
    xsterm_window_id: u32,
    name: String,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    tracing::info!(
        "rename_tmux_window: xsterm_window_id={} name={:?}",
        xsterm_window_id,
        name,
    );
    state.rename_tmux_window(xsterm_window_id, &name)
}
