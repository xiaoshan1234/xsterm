//! Tmux control-mode controller (legacy monolith + PR-T3 prelude).
//!
//! This file is the original 3622-line `controller.rs`; PR-T3 copies it
//! here so we can split it across `controller/{mod,id_map,subscriber,
//! handshake,session}.rs` in later PRs without disturbing the import path
//! (`crate::services::tmux::controller::*` keeps working).
//!
//! ## PR-T3 additions
//!
//! - `id_map` sub-module: [`CommandRegistry`] + tests. Defined here, but
//!   **not yet wired** into the controller's response routing — the old
//!   `pending_splits` / `pending_window_pane` / `pending_capture` queues
//!   still own split / new-window / capture waits. PR-T5 hooks the
//!   registry into the response router; PR-T8 deletes the old queues.
//!
//! ## Original job (unchanged in PR-T3)
//!
//! 1. Spawn `tmux` as a child process (Wave 1 local path) **or** open an
//!    SSH exec channel running `tmux -CC` on the remote host (Wave 5),
//!    via the [`TmuxBackend`](crate::infrastructure::tmux::backend::TmuxBackend)
//!    trait abstraction.
//! 2. Read stdout line-by-line, feed each line through the pure
//!    [`ProtocolParser`](crate::services::tmux::protocol::parser::ProtocolParser),
//!    and hand the resulting [`ProtocolEvent`]s to an internal dispatch task.
//! 3. The dispatch task interprets each event:
//!    - `Output { pane_id, data }` → resolve the pane → xsterm session id
//!      binding and emit `"session-output"` via [`AppBackend`].
pub(crate) mod handshake;
pub(crate) mod id_map;
pub(crate) mod subscriber;

// Re-export so existing `controller::TmuxController` callers keep working.
pub use self::handshake::{
    execute_plan, execute_step, parse_probe, plan_for, FirstPane, HandshakeError, HandshakePlan,
    HandshakeResult, HandshakeStep, ProbeResult, HANDSHAKE_STEP_TIMEOUT,
};
pub use self::id_map::{CommandRegistry, RegisteredCommand, send_to_waiter};
pub use self::subscriber::{RouterAction, RouterState};

use super::commands as tmux_cmd;
use super::dispatch::spawn_dispatch_task;
use super::events::ProtocolEvent;
use super::parser::ProtocolParser;
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::SshBackend;
use crate::infrastructure::tmux::backend::{LocalTmuxBackend, SshTmuxBackend, TmuxBackend};
use crate::models::session::{SplitDirection, TmuxCcConfig};

/// Default initial pane size in rows when [`TmuxCcConfig::initial_rows`] is
/// `None`. Mirrors `portable_pty::default_pty_size()` so behaviour is
/// consistent across local PTY and tmux panes.
const DEFAULT_INITIAL_ROWS: u16 = 24;
/// Default initial pane size in columns when [`TmuxCcConfig::initial_cols`]
/// is `None`.
const DEFAULT_INITIAL_COLS: u16 = 80;
/// Timeout for [`TmuxController::await_first_pane`]. tmux typically emits
/// the first `%window-pane-changed` within milliseconds; 5 s is a
/// comfortable upper bound that still fails fast on a stuck spawn.
const AWAIT_FIRST_PANE_TIMEOUT: Duration = Duration::from_secs(5);
/// Timeout for a single [`TmuxController::split_pane`] request waiting on
/// the matching `%window-pane-changed` reply. tmux emits the reply within
/// milliseconds; 5 s is a defensive upper bound that fails fast on a
/// stuck child or a stale send.
const SPLIT_PANE_TIMEOUT: Duration = Duration::from_secs(5);
/// Timeout for a single [`TmuxController::new_window`] request waiting on
/// the matching `%window-pane-changed` reply. Mirrors
/// [`SPLIT_PANE_TIMEOUT`]; `new-window` and `split-window` follow the same
/// dispatch handshake.
const NEW_WINDOW_TIMEOUT: Duration = Duration::from_secs(5);
/// Timeout for a single [`TmuxController::capture_pane`] request waiting on
/// the matching `%begin..%end` reply. tmux replies within milliseconds for
/// small scrollbacks; 5 s is a defensive upper bound that fails fast on
/// a stuck child.
const CAPTURE_PANE_TIMEOUT: Duration = Duration::from_secs(5);
/// Default tmux socket name when [`TmuxCcConfig::socket_name`] is `None`.
const DEFAULT_TMUX_SOCKET_NAME: &str = "default";

/// Result of a [`TmuxController::split_pane`] request.
///
/// `Ok(xsterm_session_id, tmux_pane_id, tmux_window_id)` once tmux confirms
/// the split via `%window-pane-changed`. `Err(message)` on timeout, on a
/// closed channel, or when tmux itself reports a command error (the
/// dispatch task propagates the error string into the oneshot so the
/// awaiting Tauri command returns a clean `Err` to the frontend).
type SplitResult = Result<(u32, String, String), String>;

/// Result of a [`TmuxController::new_window`] request.
///
/// `Ok(xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id)`
/// once tmux confirms the new window via `%window-pane-changed` (the
/// first pane of the new window is reported in the same reply chain).
/// `Err(message)` on timeout, on a closed channel, or when tmux itself
/// reports a command error.
type NewWindowResult = Result<(u32, String, u32, String), String>;

/// Result of a [`TmuxController::capture_pane`] request.
///
/// `Ok(text)` once tmux confirms via `%end` (body lines joined with `\n`).
/// `Err(message)` on timeout, on a closed channel, on a `%error` reply,
/// or when tmux itself reports the command failed.
type CaptureResult = Result<String, String>;

/// Handle to one running `tmux -CC` child process and its I/O tasks.
///
/// Wave 1 changed the public surface: there is no longer an
/// `events()` receiver to take — the controller consumes its own
/// events and forwards them to the injected [`AppBackend`]. Callers
/// drive the controller via [`TmuxController::send_keys`] /
/// [`TmuxController::resize_pane`] / [`TmuxController::kill_pane`] /
/// [`TmuxController::split_pane`] /
/// [`TmuxController::new_window`] /
/// [`TmuxController::kill_window`] /
/// [`TmuxController::rename_window`] /
/// [`TmuxController::close`] /
/// [`TmuxController::await_first_pane`] and observe state through the
/// events emitted on the backend.
///
/// ## transport abstraction
///
/// The Wave 1 implementation held an `Arc<Mutex<Option<Child>>>` of the
/// `tokio::process::Child` directly. Wave 5 replaces that with a
/// [`Box<dyn TmuxBackend>`] so the same reader / writer / monitor task
/// machinery drives both local PTY and SSH-exec backends. See
/// [`crate::infrastructure::tmux::backend`] for the trait surface and
/// the two implementations.
pub struct TmuxController {
    /// Stable id allocated by the [`SessionManager`](crate::services::session_manager::SessionManager).
    controller_id: u32,
    /// backend that owns the tmux child / channel. Wrapped in
    /// `Arc<Mutex<Option<_>>>` so [`TmuxController::close`] and the
    /// monitor task race for ownership exactly the same way the Wave 1
    /// `Arc<Mutex<Option<Child>>>` design did.
    ///
    /// - The reader / writer / monitor tasks `take_stdout()` /
    ///   `take_stdin()` / `take_stderr()` from the backend **before**
    ///   this slot is populated. (The three `take_*` methods consume
    ///   the pipes and leave the rest of the backend untouched.)
    /// - The monitor task then locks the slot, takes the backend, and
    ///   awaits `wait()`. [`TmuxController::close`] does a `try_lock`
    ///   and, if successful, takes the backend and calls `kill()`.
    /// - Whoever wins the race owns the backend for the rest of its
    ///   lifetime; the loser sees `None` and exits silently.
    backend: Arc<tokio::sync::Mutex<Option<Box<dyn TmuxBackend>>>>,
    /// Set to `true` by [`TmuxController::close`] so the monitor task
    /// knows not to emit an `Exit` event for a teardown we initiated.
    killed: Arc<AtomicBool>,
    /// Clone of the writer task's command sender. Held by `self` so that
    /// dropping `self` (via `close`) signals the writer task to drain and
    /// exit.
    pub(crate) stdin_tx: mpsc::UnboundedSender<String>,
    /// Sink for the dispatch task. Held inside the controller purely so the
    /// `AppBackend` clone lives for the controller's lifetime.
    app_backend: Arc<dyn AppBackend>,
    /// `tmux_pane_id → xsterm_session_id` map. Populated lazily by the
    /// dispatch task on each first-sighting `WindowPaneChanged`; read by
    /// `send_keys` / `resize_pane` / `unbind_pane` and the dispatch task
    /// itself.
    pub(crate) pane_bindings: std::sync::Mutex<HashMap<String, u32>>,
    /// `tmux_pane_id → tmux_window_id` map. Populated by the
    /// dispatch task when a new pane is registered; used by
    /// [`TmuxController::tmux_window_id_for_pane`] so
    /// [`SessionManager::create_tmux`](crate::services::session_manager::SessionManager::create_tmux)
    /// can build a `SessionInfo` carrying the bootstrap pane's tmux
    /// window id.
    pub(crate) pane_window_bindings: std::sync::Mutex<HashMap<String, String>>,
    /// Monotonically increasing allocator for the xsterm session id of each
    /// pane that this controller registers. Starts at the manager-allocated
    /// base (`controller_id`) so xsterm ids across controllers do not
    /// collide.
    next_xsterm_id: AtomicU32,
    /// monotonically increasing allocator for the xsterm window id
    /// of each tmux window the controller tracks. Uses a parallel
    /// `controller_id * 1_000_000 + 1` offset to keep window ids out of the
    /// pane-id space.
    next_xsterm_window_id: AtomicU32,
    /// Signalled by the dispatch task on the first `WindowPaneChanged` and
    /// consumed by [`TmuxController::await_first_pane`]. Implemented as a
    /// buffered `oneshot` channel rather than `tokio::sync::Notify` to
    /// close a T2→T3 race: `Notify::notify_waiters()` only wakes currently-
    /// registered waiters, but a `notified()` future isn't registered until
    /// it is first polled, so a dispatcher firing between result-check and
    /// await would lose the signal. `oneshot::Sender` buffers the value
    /// until the receiver awaits, closing the race completely.
    first_pane_rx: tokio::sync::Mutex<Option<oneshot::Receiver<(u32, String)>>>,
    /// Sender half of `first_pane_rx`. Held in a `std::sync::Mutex` so the
    /// dispatch task can `.take()` it on `record_first_pane` (one-shot
    /// semantics — second call is a no-op).
    pub(crate) first_pane_tx: std::sync::Mutex<Option<oneshot::Sender<(u32, String)>>>,
    /// FIFO queue of [`oneshot::Sender`]s awaiting the result of a
    /// [`TmuxController::split_pane`] request. The dispatch task pushes
    /// `split_pane` callers onto this queue (before writing `split-window`
    /// to stdin), then pops the front sender on the matching
    /// `%window-pane-changed` reply and resolves it with the new pane's
    /// `(xsterm_session_id, tmux_pane_id, tmux_window_id)`. Multiple
    /// concurrent splits are handled in tmux's reply order (FIFO).
    pub(crate) pending_splits: std::sync::Mutex<VecDeque<oneshot::Sender<SplitResult>>>,
    /// FIFO queue of [`oneshot::Sender`]s awaiting the result of a
    /// [`TmuxController::new_window`] request. Mirrors `pending_splits`
    /// exactly — `new_window` callers push a sender here before writing
    /// `new-window` to stdin, and the dispatch task pops the front sender
    /// once the matching `%window-pane-changed` reply arrives.
    pub(crate) pending_windows: std::sync::Mutex<VecDeque<oneshot::Sender<NewWindowResult>>>,
    /// side-map `tmux_window_id → PendingWindow` that bridges
    /// `%window-add` and the matching `%window-pane-changed`. The dispatch
    /// task stores the freshly-allocated xsterm window id here on
    /// `WindowAdd`, then removes the entry and resolves any pending
    /// sender / emits `tmux-window-added` on `WindowPaneChanged`. The
    /// `sender` is `Some` for user-driven `new-window` requests and
    /// `None` for the bootstrap window (which is already known to the
    /// frontend).
    pub(crate) pending_window_pane: std::sync::Mutex<HashMap<String, PendingWindow>>,
    /// `tmux_window_id → xsterm_window_id` map for every tmux
    /// window this controller has observed (bootstrap, user-driven, and
    /// — in the future — external). Used by `kill_window` /
    /// `rename_window` to validate the caller's input and by the dispatch
    /// task's `WindowClose` / `WindowRenamed` handlers to look up the
    /// xsterm id to emit on `tmux-window-closed` / `tmux-window-renamed`.
    pub(crate) window_bindings: std::sync::Mutex<HashMap<String, u32>>,
    /// tmux session name for `tmux -CC attach-session` (set by
    /// `spawn_attach`; `None` for `spawn_local`). Wrapped in a `Mutex`
    /// because `spawn_attach` writes it via the returned `Arc` after
    /// `spawn_with_args` returns. Used by the `attachedTmuxServers`
    /// persistence so we can re-attach on restart.
    session_name: std::sync::Mutex<Option<String>>,
    /// in-flight `capture_pane` awaiter. Exactly one capture may
    /// be in flight at a time — tmux serialises command replies in order,
    /// and `capture_lock` enforces single-caller semantics so the
    /// dispatch task can unambiguously route the next `%begin/%end`
    /// block to either the pending sender (match) or some other command
    /// (no match — ignore).
    pub(crate) pending_capture: std::sync::Mutex<Option<oneshot::Sender<CaptureResult>>>,
    /// body lines being assembled for the in-flight capture.
    /// Reset to empty on each `CommandBegin` and drained on `CommandEnd`.
    pub(crate) pending_capture_body: std::sync::Mutex<Vec<String>>,
    /// tokio mutex serialising concurrent `capture_pane` callers
    /// so two requests never overlap their `%begin..%end` block.
    capture_lock: tokio::sync::Mutex<()>,

    /// Current fire-and-forget command id (set by `CommandOutput` with a
    /// new id, flushed by `CommandEnd`). Used by the dispatch task to
    /// accumulate body lines belonging to a single `%begin..%end` block
    /// (e.g. `list-windows` / `list-panes` bootstrap queries) so the
    /// end-event can classify the whole body as `WindowList` /
    /// `PaneList` / generic `CommandResponse` (see
    /// `dispatch_event::handle_classified_response`).
    pub(crate) current_command_id: std::sync::Mutex<Option<u32>>,
    /// Body lines being assembled for `current_command_id`. Reset on
    /// each `CommandOutput` whose id differs from
    /// `current_command_id`, and drained by the matching `CommandEnd`.
    pub(crate) current_command_lines: std::sync::Mutex<Vec<String>>,
    /// Override hook used by tests to shorten [`SPLIT_PANE_TIMEOUT`]. In
    /// production this stays at [`SPLIT_PANE_TIMEOUT`]; the
    /// `split_pane_times_out_when_no_response` test substitutes a smaller
    /// value so the test does not have to wait 5 s for the timeout.
    split_pane_timeout: Duration,
}

/// Delay before the initial state sync query (Bug 017). The control-
/// mode forwarder needs this long to start reading responses before
/// we send the first query; otherwise the query and `new-window`
/// race and the server returns the wrong thing.
const INITIAL_STATE_SYNC_DELAY: Duration = Duration::from_millis(500);

/// Schedule a delayed `list-windows` query on a background OS thread so
/// the control-mode forwarder has time to start reading responses. The
/// dispatch task's `WindowList` handler then automatically issues a
/// follow-up `list-panes ""` query and registers the first pane for
/// `await_first_pane` — eliminating the race in Bug 016 / 017 where
/// the `list-panes` response was processed before its sender was
/// installed on the controller.
fn schedule_initial_state_sync(stdin_tx: mpsc::UnboundedSender<String>) {
    thread::spawn(move || {
        thread::sleep(INITIAL_STATE_SYNC_DELAY);
        let command = tmux_cmd::list_windows("");
        if stdin_tx.send(command).is_err() {
            tracing::debug!(
                "schedule_initial_state_sync: controller already closed stdin_tx; skipping"
            );
        }
    });
}

/// per-window bookkeeping stored in
/// [`TmuxController::pending_window_pane`] between `%window-add` and the
/// matching `%window-pane-changed`.
///
/// `sender` is `Some` only for user-driven `new-window` requests
/// (resolved by the dispatch task with the new pane's quadruple); the
/// bootstrap window's entry has `sender = None` because the frontend
/// already owns the corresponding xsterm Window — we just need the
/// dispatch task to populate `window_bindings` and `pane_window_bindings`
/// so `tmux-pane-added` carries the bootstrap tmux window id.
pub(crate) struct PendingWindow {
    /// xsterm window id allocated on `%window-add`.
    pub(crate) xsterm_window_id: u32,
    /// `Some` for user-driven new-window requests, `None` for the
    /// bootstrap window.
    pub(crate) sender: Option<oneshot::Sender<NewWindowResult>>,
}

impl TmuxController {
    /// Spawn a `tmux -CC` controller for a [`TmuxCcConfig`] and wire the
    /// internal dispatch task.
    ///
    /// routes through SSH when [`TmuxCcConfig::ssh`] is `Some(_)`
    /// (uses [`SshBackend::connect_exec`] to open a remote exec channel
    /// running `tmux -CC <args>`) and through a local `tokio::process::Command`
    /// child otherwise. Both paths feed into the same reader / writer /
    /// monitor task machinery via the [`TmuxBackend`] trait.
    ///
    /// `ssh_backend` is unused on the local path but the parameter exists
    /// so callers don't have to branch before calling.
    pub fn spawn_local(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        if let Some(ssh_cfg) = config.ssh.as_ref() {
            // SSH path: build the remote `tmux -CC ...` argv, run
            // it through an SSH exec channel, and wrap the resulting
            // `SshConnectResult` in a `SshTmuxBackend`.
            let argv_strings = build_tmux_argv(config)?;
            let command = format!("tmux {}", argv_strings.join(" "));
            let result = ssh_backend.connect_exec(ssh_cfg, &command)?;
            let backend: Box<dyn TmuxBackend> =
                Box::new(SshTmuxBackend::from_connect_result(result));
            return Self::spawn_with_backend(backend, app_backend, controller_id);
        }

        // Local path: spawn `tmux` as a tokio child process.
        let argv_strings = build_tmux_argv(config)?;
        let argv_refs: Vec<&str> = argv_strings.iter().map(String::as_str).collect();
        let mut cmd = Command::new("tmux");
        cmd.args(&argv_refs)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd.spawn().map_err(|e| tmux_spawn_err(e, &argv_refs))?;
        let backend: Box<dyn TmuxBackend> = Box::new(LocalTmuxBackend::new(child));
        Self::spawn_with_backend(backend, app_backend, controller_id)
    }

    /// Lower-level constructor — spawns tmux with `argv[1..]` already
    /// built. `argv[0]` is always `"tmux"` and is added internally.
    ///
    /// takes a `tokio::process::Child` instead of building one
    /// internally; the SSH path goes through [`spawn_local`] instead.
    /// Kept for backward compatibility with the existing test suite.
    #[allow(dead_code)] // exercised only by the unit-test fixture suite
    pub fn spawn_with_args(
        args: &[&str],
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let mut cmd = Command::new("tmux");
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd.spawn().map_err(|e| tmux_spawn_err(e, args))?;
        let backend: Box<dyn TmuxBackend> = Box::new(LocalTmuxBackend::new(child));
        Self::spawn_with_backend(backend, app_backend, controller_id)
    }

    /// build a [`TmuxController`] around an already-constructed
    /// [`TmuxBackend`]. Used by both the local and SSH spawn paths.
    ///
    /// The backend is wrapped in an `Arc<Mutex<Option<_>>>` so
    /// [`TmuxController::close`] (via `try_lock`) and the monitor task
    /// (via `lock().await`) race for ownership exactly the same way the
    /// Wave 1 `Arc<Mutex<Option<Child>>>` design did. Whoever wins runs
    /// with the backend; the loser sees `None` and exits silently.
    fn spawn_with_backend(
        mut backend: Box<dyn TmuxBackend>,
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let stdout = backend
            .take_stdout()
            .map_err(|e| format!("tmux backend has no stdout: {e}"))?;
        let stdin = backend
            .take_stdin()
            .map_err(|e| format!("tmux backend has no stdin: {e}"))?;
        let stderr = backend
            .take_stderr()
            .map_err(|e| format!("tmux backend has no stderr: {e}"))?;

        let (stdin_tx, stdin_rx) = mpsc::unbounded_channel::<String>();
        let (dispatch_tx, dispatch_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        let (pane_tx_init, pane_rx_init) = oneshot::channel::<(u32, String)>();

        let killed = Arc::new(AtomicBool::new(false));
        let backend_slot: Arc<tokio::sync::Mutex<Option<Box<dyn TmuxBackend>>>> =
            Arc::new(tokio::sync::Mutex::new(Some(backend)));

        spawn_reader_task(stdout, dispatch_tx.clone());
        spawn_writer_task(stdin, stdin_rx);
        spawn_stderr_drain_task(stderr);
        spawn_monitor_task(Arc::clone(&backend_slot), killed.clone(), dispatch_tx);

        let controller = Arc::new(Self {
            controller_id,
            backend: backend_slot,
            killed,
            stdin_tx,
            app_backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(controller_id.saturating_mul(1_000_000) + 1),
            next_xsterm_window_id: AtomicU32::new(controller_id.saturating_mul(1_000_000) + 1),
            first_pane_tx: std::sync::Mutex::new(Some(pane_tx_init)),
            first_pane_rx: tokio::sync::Mutex::new(Some(pane_rx_init)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            // initialised to None; `spawn_attach` rewrites this
            // after construction via the returned Arc.
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),
            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),
            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        spawn_dispatch_task(
            dispatch_rx,
            controller.clone(),
            Arc::clone(&controller.app_backend),
            controller_id,
        );

        // Register this child process as a tmux control client. tmux
        // server closes the control session and exits the client with
        // code 0 if no client sends `refresh-client -C` after the
        // initial `%begin` block, so we push it onto the writer
        // task's FIFO *before* returning — the writer task is the
        // sole owner of `stdin_rx`, and `stdin_tx.send` is non-blocking.
        // Bug 015: server creates the control session (via
        // `new-session -A` in the `tmux -CC` argv) but does NOT
        // automatically create a window/pane. We must explicitly
        // `new-window` to trigger `%window-add` + `%window-pane-changed`
        // notifications needed to register the first pane.
        controller
            .stdin_tx
            .send(tmux_cmd::new_window_in_current(None))
            .map_err(|e| format!("failed to enqueue new-window: {e}"))?;

        // Bug 017: instead of racing `list-panes` with `new-window`, we
        // schedule a delayed `list-windows` query that the dispatch
        // task's `WindowList` handler responds to by issuing a
        // follow-up `list-panes ""` and registering the first pane
        // for `await_first_pane`. The race-free chain is:
        //   new-window → %window-add → list-windows → %WindowList →
        //   list-panes → %PaneList → register_first_pane.
        schedule_initial_state_sync(controller.stdin_tx.clone());
        tracing::info!(
            "tmux controller {}: enqueued `new-window`; reader/writer/dispatch/monitor tasks spawned; initial state sync scheduled",
            controller_id
        );

        Ok(controller)
    }

    /// spawn a `tmux -CC attach-session` child process and wire the
    /// internal dispatch task.
    ///
    /// Unlike `spawn_local` (which always opens a *new* detached session),
    /// this constructor attaches to an **existing** tmux session so the
    /// bootstrap pane tmux owns carries the user's previous shell state
    /// forward into xsterm. Used by
    /// [`SessionManager::attach_tmux`](crate::services::session_manager::SessionManager::attach_tmux)
    /// (Wave 4 §D4 + req-006 §5).
    ///
    /// The tmux session name is **required** because attaching to "the
    /// server's current session" is non-deterministic when several sessions
    /// exist on the same socket. Returns `Err` with a clear validation
    /// message when [`TmuxCcConfig::tmux_session_name`] is `None`.
    ///
    /// tmux is resolved through `$PATH`; if it cannot be found, returns
    /// `Err` containing the OS error description (same as `spawn_local`).
    pub fn spawn_attach(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
    ) -> Result<Arc<Self>, String> {
        let session_name = config.tmux_session_name.as_deref().ok_or_else(|| {
            "tmux -CC attach requires `tmuxSessionName` in TmuxCcConfig".to_string()
        })?;

        let backend: Box<dyn TmuxBackend> = if let Some(ssh_cfg) = config.ssh.as_ref() {
            let socket = config
                .socket_name
                .as_deref()
                .unwrap_or(DEFAULT_TMUX_SOCKET_NAME);
            let command = format!(
                "tmux -CC -L {} attach-session -t {}",
                shell_quote(socket),
                shell_quote(session_name)
            );
            let result = ssh_backend.connect_exec(ssh_cfg, &command)?;
            Box::new(SshTmuxBackend::from_connect_result(result))
        } else {
            let socket = config
                .socket_name
                .as_deref()
                .unwrap_or(DEFAULT_TMUX_SOCKET_NAME);
            let argv: Vec<String> = vec![
                "-CC".to_string(),
                "-L".to_string(),
                socket.to_string(),
                "attach-session".to_string(),
                "-t".to_string(),
                session_name.to_string(),
            ];
            let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
            let mut cmd = Command::new("tmux");
            cmd.args(&argv_refs)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let child = cmd.spawn().map_err(|e| tmux_spawn_err(e, &argv_refs))?;
            Box::new(LocalTmuxBackend::new(child))
        };

        let arc = Self::spawn_with_backend(backend, app_backend, controller_id)?;
        // Stash the session name on the controller so the persistence layer
        // (`SessionManager::list_attached_tmux_servers`) can read it
        // without re-parsing the config.
        if let Ok(mut slot) = arc.session_name.lock() {
            *slot = Some(session_name.to_string());
        }
        Ok(arc)
    }

    /// Write raw bytes (typically user keystrokes) to the pane.
    ///
    /// Internally builds the `send-keys -t %<pane> <escaped-data>` command
    /// via [`tmux_cmd::send_keys`] and pushes it onto the writer task's
    /// FIFO queue. Returns `Err` if the writer task has already exited
    /// (e.g. after [`TmuxController::close`]) or if the pane id is not
    /// registered with this controller.
    pub fn send_keys(&self, tmux_pane_id: &str, keys: &[u8]) -> Result<(), String> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            ));
        }
        let cmd = tmux_cmd::send_keys(tmux_pane_id, keys);
        self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        })
    }

    /// Resize a pane to `cols` × `rows` characters.
    ///
    /// Builds `resize-pane -t %<pane> -x <cols> -y <rows>` via
    /// [`tmux_cmd::resize_pane`] and queues it for dispatch. Same error
    /// semantics as [`TmuxController::send_keys`].
    pub fn resize_pane(&self, tmux_pane_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            ));
        }
        let cmd = tmux_cmd::resize_pane(tmux_pane_id, cols, rows);
        self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        })
    }

    /// read up to `lines` lines of scrollback from the pane via
    /// `capture-pane -p -e -J -S -<lines>` and return the captured text.
    ///
    /// This is the Promise coordination the dispatch task routes
    /// `%begin..%end` blocks for. tmux writes the captured lines inside a
    /// single reply block (one `%begin`, N `CommandOutput`s, one `%end`),
    /// and the dispatch task stitches them back together before resolving
    /// the oneshot sender this method returns via `await`.
    ///
    /// Exactly **one** capture may be in flight at a time. Concurrency is
    /// bounded via the `capture_lock` tokio mutex; a second concurrent
    /// caller waits until the first capture's `%end` has been processed.
    /// tmux serialises command replies, so single-capture is sufficient
    /// and avoids the four-state correlation dance a multi-pending design
    /// would require.
    ///
    /// Errors:
    /// - `Err("parent pane not registered")` when `tmux_pane_id` is not in
    ///   `pane_bindings` (mirrors the `send_keys` / `resize_pane` guard).
    /// - `Err` from the dispatcher when tmux itself replies with
    ///   `%error` (e.g. the pane vanished mid-capture).
    /// - `Err("capture-pane timed out")` after [`CAPTURE_PANE_TIMEOUT`].
    /// - `Err("response channel closed")` if the dispatch task exited
    ///   before the reply arrived.
    pub async fn capture_pane(&self, tmux_pane_id: &str, lines: i32) -> CaptureResult {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            ));
        }

        // Serialise concurrent capture_pane callers — only one capture
        // can be in flight at a time.
        let _guard = self.capture_lock.lock().await;

        // Register the sender BEFORE writing the command so the dispatch
        // task routes the matching %end back to us even when tmux
        // replies faster than the writer's loop schedules the command.
        let (tx, rx) = oneshot::channel::<CaptureResult>();
        {
            let mut slot = self.pending_capture.lock().map_err_string()?;
            // Should never observe a stuck sender — guard above
            // serialises. Defensive clear anyway so we don't strand an
            // already-orphaned sender from a previous timeout.
            if slot.is_some() {
                if let Ok(mut body) = self.pending_capture_body.lock() {
                    body.clear();
                }
            }
            *slot = Some(tx);
        }

        let cmd = tmux_cmd::capture_pane(tmux_pane_id, lines);
        if let Err(e) = self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        }) {
            // Roll back so the dispatch task doesn't observe a stale
            // sender after we returned.
            if let Ok(mut slot) = self.pending_capture.lock() {
                *slot = None;
            }
            return Err(e);
        }

        match tokio::time::timeout(CAPTURE_PANE_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_canceled)) => Err(format!(
                "tmux controller {}: capture response channel closed",
                self.controller_id
            )),
            Err(_elapsed) => {
                // Drop our half so the dispatch task's later CommandEnd
                // sees a closed channel and silently discards (we already
                // gave up).
                if let Ok(mut slot) = self.pending_capture.lock() {
                    *slot = None;
                }
                if let Ok(mut body) = self.pending_capture_body.lock() {
                    body.clear();
                }
                Err(format!(
                    "tmux controller {}: capture timed out after {:?}",
                    self.controller_id, CAPTURE_PANE_TIMEOUT
                ))
            }
        }
    }

    /// tmux session name this controller is attached to.
    ///
    /// `Some(name)` for controllers built with [`TmuxController::spawn_attach`]
    /// (and only those), `None` for `spawn_local` / unknown sessions.
    /// Used by `SessionManager::list_attached_tmux_servers` to populate
    /// the persisted `attachedTmuxServers` list.
    pub fn session_name(&self) -> Option<String> {
        self.session_name.lock().ok().and_then(|g| g.clone())
    }

    /// Test-only: inject a `session_name` from outside `spawn_attach`.
    /// `#[cfg(test)]` so it never links into production binaries.
    #[cfg(test)]
    pub(crate) fn set_session_name_for_tests(&self, name: impl Into<String>) {
        if let Ok(mut slot) = self.session_name.lock() {
            *slot = Some(name.into());
        }
    }

    /// Tear the controller down.
    ///
    /// - Sets the `killed` flag so the monitor task does not emit a
    ///   spurious `Exit` event.
    /// - Kills the backend (idempotent — best-effort via the
    ///   [`TmuxBackend::kill`] trait method, which wraps
    ///   `tokio::process::Child::start_kill` for the local path and
    ///   drops senders / triggers EOF on the SSH channel for the remote
    ///   path).
    /// - Drops the `stdin_tx` (when `self` falls out of scope) which
    ///   signals the writer task to drain any pending commands and then
    ///   shut down its stdin.
    ///
    /// Background tasks unwind asynchronously; this call does **not**
    /// wait for them to finish. The dispatch task will observe the writer
    /// task's exit and finish its own loop.
    pub fn close(&self) -> Result<(), String> {
        self.killed.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.backend.try_lock() {
            if let Some(mut backend) = guard.take() {
                if let Err(e) = backend.kill() {
                    tracing::error!(
                        "tmux controller {}: backend kill failed: {e}",
                        self.controller_id
                    );
                }
            }
        }
        // wake the pending capture-pane awaiter too, otherwise
        // a teardown would let it sit on the full CAPTURE_PANE_TIMEOUT
        // even though we know the child is dead. We hold no lock here;
        // the dispatch task may still process a stale %begin/%end after
        // we set the slot to None, but `oneshot::Sender::send` on an
        // already-dropped receiver just returns Err and we ignore it.
        if let Ok(mut slot) = self.pending_capture.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(Err(format!(
                    "tmux controller {}: controller closed",
                    self.controller_id
                )));
            }
        }
        if let Ok(mut body) = self.pending_capture_body.lock() {
            body.clear();
        }
        // Wake every awaiter blocked on a split reply; without this the
        // Tauri command would wait the full `split_pane_timeout` before
        // surfacing an error, even though we already know the controller
        // is going away.
        self.drain_pending_splits_with_error("controller closed");
        // same dance for `new_window` awaiters.
        self.drain_pending_windows_with_error("controller closed");
        tracing::debug!(
            "tmux controller {}: close complete (tasks unwind async)",
            self.controller_id
        );
        Ok(())
    }

    /// Block until the first pane is registered, returning its
    /// `(xsterm_session_id, tmux_pane_id)` pair.
    ///
    /// Times out after [`AWAIT_FIRST_PANE_TIMEOUT`] and returns
    /// `Err("timed out waiting for first pane")`. Only the bootstrap caller
    /// should `await` it; subsequent calls return immediately with the
    /// cached first-pane result if available, otherwise the same timeout
    /// error.
    pub async fn await_first_pane(&self) -> Result<(u32, String), String> {
        tracing::info!(
            "tmux controller {}: await_first_pane called (will block up to {:?}s waiting for record_first_pane from dispatcher)",
            self.controller_id,
            AWAIT_FIRST_PANE_TIMEOUT.as_secs()
        );

        // Bug 016: the dispatch task's `handle_classified_response`
        // hook already registers the first pane from the `list-panes`
        // response (see `dispatch.rs::emit_pane_list`), so we don't
        // need a separate `bootstrap_rx` one-shot here — just fall
        // through to the normal `first_pane_rx` wait. The first
        // pane is registered as a side effect of the dispatch chain,
        // which wakes this future promptly.

        // Take the receiver (one-shot). If already taken, return an error.
        let rx = {
            let mut guard = self.first_pane_rx.lock().await;
            guard.take()
        };
        let rx = rx.ok_or_else(|| {
            format!(
                "tmux controller {}: first pane already awaited",
                self.controller_id
            )
        })?;
        // Await with the standard 5s timeout. The receiver buffers the
        // dispatcher's `.send()`, so this doesn't lose notifications the
        // way `Notify` did (Notify's `notified()` future is only
        // registered as a waiter on first poll, leaving a T2→T3 race).
        match tokio::time::timeout(AWAIT_FIRST_PANE_TIMEOUT, rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err(format!(
                "tmux controller {}: first pane channel closed unexpectedly",
                self.controller_id
            )),
            Err(_) => Err(format!(
                "tmux controller {}: timed out waiting for first pane",
                self.controller_id
            )),
        }
    }

    /// Snapshot of every pane currently registered with this controller.
    /// Returns `(tmux_pane_id, xsterm_session_id)` pairs.
    #[allow(dead_code)] // test-only introspection; not consumed by production code
    pub fn pane_bindings(&self) -> Vec<(String, u32)> {
        self.pane_bindings
            .lock()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
            .unwrap_or_default()
    }

    /// Look up the xsterm session id for a given tmux pane id. `None` if
    /// the pane has not been registered with this controller (e.g. it has
    /// been unbound via [`TmuxController::unbind_pane`]).
    pub fn xsterm_id_for_pane(&self, tmux_pane_id: &str) -> Option<u32> {
        self.pane_bindings
            .lock()
            .ok()
            .and_then(|m| m.get(tmux_pane_id).copied())
    }

    /// Remove the binding for `tmux_pane_id`. Called by
    /// [`TmuxPaneHandle::close`](crate::services::session_manager::TmuxPaneHandle::close)
    /// when a per-pane session is torn down; the controller itself stays
    /// alive (other panes may still be open).
    ///
    /// Does **not** issue `kill-pane` — that is the caller's responsibility
    /// if the underlying tmux pane should also disappear.
    pub fn unbind_pane(&self, tmux_pane_id: &str) -> Result<(), String> {
        let mut map = self.pane_bindings.lock().map_err_string()?;
        if map.remove(tmux_pane_id).is_none() {
            return Err(format!(
                "tmux pane '{}' is not bound to controller {}",
                tmux_pane_id, self.controller_id
            ));
        }
        tracing::debug!(
            "tmux controller {}: unbound pane {}",
            self.controller_id,
            tmux_pane_id
        );
        Ok(())
    }

    /// Split `parent_tmux_pane_id` and return the new pane's
    /// `(xsterm_session_id, tmux_pane_id, tmux_window_id)` triple.
    ///
    /// Flow:
    /// 1. Register a [`oneshot::Sender`] in `pending_splits` so the
    ///    dispatch task can route the matching `%window-pane-changed`
    ///    reply back to this future. The sender is pushed **before** the
    ///    `split-window` command is written to stdin, eliminating the
    ///    race where tmux replies faster than the caller can register.
    /// 2. Write `split-window <flag> -t %<parent>` (built via
    ///    [`tmux_cmd::split_window`]) to stdin. The writer task drains
    ///    the FIFO in a single background thread, preserving tmux's
    ///    expected command ordering.
    /// 3. `await` the oneshot with [`SPLIT_PANE_TIMEOUT`].
    ///
    /// Errors:
    /// - `Err("parent pane not bound")` if `parent_tmux_pane_id` is not
    ///   registered (the parent pane must already exist on this
    ///   controller).
    /// - `Err("timed out")` after [`SPLIT_PANE_TIMEOUT`] — the dispatch
    ///   task did not see a matching `%window-pane-changed` reply.
    /// - `Err("response channel closed")` if the controller's dispatch
    ///   task already exited (the child died before we got the reply).
    pub async fn split_pane(
        &self,
        parent_tmux_pane_id: &str,
        direction: SplitDirection,
    ) -> SplitResult {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(parent_tmux_pane_id)
        {
            return Err(format!(
                "tmux pane '{}' is not registered with controller {}",
                parent_tmux_pane_id, self.controller_id
            ));
        }

        let (tx, rx) = oneshot::channel::<SplitResult>();
        {
            let mut queue = self.pending_splits.lock().map_err_string()?;
            queue.push_back(tx);
        }

        let cmd = format!(
            "split-window {} -t {}\n",
            direction.flag(),
            parent_tmux_pane_id
        );
        if let Err(e) = self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        }) {
            // Roll back: remove the sender we just pushed so the dispatch
            // task does not wait on a stale channel forever.
            if let Ok(mut queue) = self.pending_splits.lock() {
                queue.pop_back();
            }
            return Err(e);
        }

        match tokio::time::timeout(self.split_pane_timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_canceled)) => Err(format!(
                "tmux controller {}: split response channel closed",
                self.controller_id
            )),
            Err(_elapsed) => Err(format!(
                "tmux controller {}: split timed out after {:?}",
                self.controller_id, self.split_pane_timeout
            )),
        }
    }

    /// Send `kill-pane -t %<tmux_pane_id>` to tmux.
    ///
    /// Synchronous: writes the command to the writer-task FIFO and returns.
    /// The dispatch task will later receive `%pane-exited` from tmux and
    /// emit `tmux-pane-removed`, which the frontend listens for to drop
    /// the matching `Session` from React state.
    ///
    /// Returns `Err` if the pane is not bound to this controller or if the
    /// writer channel has already closed.
    pub fn kill_pane(&self, tmux_pane_id: &str) -> Result<(), String> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            ));
        }
        let cmd = tmux_cmd::kill_pane(tmux_pane_id);
        self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        })
    }

    /// open a new tmux window and return its
    /// `(xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id)`
    /// quadruple once tmux confirms via `%window-pane-changed`.
    ///
    /// Flow:
    /// 1. Register a [`oneshot::Sender`] in `pending_windows` so the
    ///    dispatch task can route the matching `%window-add` /
    ///    `%window-pane-changed` reply pair back to this future. The
    ///    sender is pushed **before** the `new-window` command is written
    ///    to stdin, eliminating the race where tmux replies faster than
    ///    the caller can register.
    /// 2. Write `new-window [-n <name>]` (built via
    ///    [`tmux_cmd::new_window_in_current`]) to stdin. No `-t <session>`
    ///    flag because the `tmux -CC` controller is attached to its own
    ///    tmux session and `new-window` defaults to the current session.
    /// 3. `await` the oneshot with [`NEW_WINDOW_TIMEOUT`].
    ///
    /// Errors:
    /// - `Err("new-window timed out")` after [`NEW_WINDOW_TIMEOUT`] — the
    ///   dispatch task did not see a matching `%window-pane-changed` reply.
    /// - `Err("new-window response channel closed")` if the controller's
    ///   dispatch task already exited (the child died before we got the
    ///   reply).
    pub async fn new_window(&self, window_name: Option<&str>) -> NewWindowResult {
        let (tx, rx) = oneshot::channel::<NewWindowResult>();
        {
            let mut queue = self.pending_windows.lock().map_err_string()?;
            queue.push_back(tx);
        }

        let cmd = tmux_cmd::new_window_in_current(window_name);
        if let Err(e) = self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        }) {
            // Roll back: remove the sender we just pushed so the dispatch
            // task does not wait on a stale channel forever.
            if let Ok(mut queue) = self.pending_windows.lock() {
                queue.pop_back();
            }
            return Err(e);
        }

        match tokio::time::timeout(NEW_WINDOW_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_canceled)) => Err(format!(
                "tmux controller {}: new-window response channel closed",
                self.controller_id
            )),
            Err(_elapsed) => Err(format!(
                "tmux controller {}: new-window timed out after {:?}",
                self.controller_id, NEW_WINDOW_TIMEOUT
            )),
        }
    }

    /// send `kill-window -t @<tmux_window_id>` to tmux.
    ///
    /// Synchronous: writes the command to the writer-task FIFO and returns.
    /// The dispatch task will later receive `%window-close @<id>` from
    /// tmux and emit `tmux-window-closed`, which the frontend listener
    /// uses to drop every `Session` in the matching xsterm Window and then
    /// drop the Window itself.
    ///
    /// Returns `Err` if the window is not bound to this controller or if
    /// the writer channel has already closed.
    pub fn kill_window(&self, tmux_window_id: &str) -> Result<(), String> {
        if !self
            .window_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_window_id)
        {
            return Err(format!(
                "tmux window '{}' is not registered with controller {}",
                tmux_window_id, self.controller_id
            ));
        }
        let cmd = tmux_cmd::kill_window(tmux_window_id);
        self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        })
    }

    /// send `rename-window -t @<id> <new_name>` to tmux.
    ///
    /// Synchronous: writes the command to the writer-task FIFO and returns.
    /// The dispatch task will later receive `%window-renamed @<id> <name>`
    /// from tmux and emit `tmux-window-renamed`, which the frontend
    /// listener uses to update the matching xsterm Window's `name`.
    ///
    /// Returns `Err` if the window is not bound to this controller or if
    /// the writer channel has already closed.
    pub fn rename_window(&self, tmux_window_id: &str, name: &str) -> Result<(), String> {
        if !self
            .window_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_window_id)
        {
            return Err(format!(
                "tmux window '{}' is not registered with controller {}",
                tmux_window_id, self.controller_id
            ));
        }
        let cmd = tmux_cmd::rename_window(tmux_window_id, name);
        self.stdin_tx.send(cmd).map_err(|_| {
            format!(
                "tmux controller {} writer channel is closed",
                self.controller_id
            )
        })
    }

    /// snapshot of every pane currently registered with this
    /// controller. Returns `(tmux_pane_id, tmux_window_id)` pairs. Used by
    /// [`SessionManager::kill_tmux_window`](crate::services::session_manager::SessionManager::kill_tmux_window)
    /// to find every pane that belongs to a window the caller is about
    /// to close so they can be unbound from the controller.
    #[allow(dead_code)]
    pub fn panes_for_window(&self, tmux_window_id: &str) -> Vec<String> {
        self.pane_window_bindings
            .lock()
            .map(|m| {
                m.iter()
                    .filter_map(|(pane, win)| (win == tmux_window_id).then(|| pane.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// look up the tmux window id for a given tmux pane id. Used by
    /// [`SessionManager::create_tmux`](crate::services::session_manager::SessionManager::create_tmux)
    /// so the bootstrap pane's `SessionInfo` carries the bootstrap
    /// window's tmux id. `None` if the pane is not registered with this
    /// controller.
    pub fn tmux_window_id_for_pane(&self, tmux_pane_id: &str) -> Option<String> {
        self.pane_window_bindings
            .lock()
            .ok()
            .and_then(|m| m.get(tmux_pane_id).cloned())
    }

    /// snapshot of every window currently bound to this
    /// controller. Returns `(tmux_window_id, xsterm_window_id)` pairs.
    pub fn window_bindings(&self) -> Vec<(String, u32)> {
        self.window_bindings
            .lock()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
            .unwrap_or_default()
    }

    /// Drain every pending split sender with an error.
    ///
    /// Called by [`TmuxController::close`] so a Tauri command awaiting a
    /// split result does not block forever on a child that is being torn
    /// down. Each sender gets an `Err("controller closed")` so the awaiter
    /// surfaces a clean error to the frontend.
    fn drain_pending_splits_with_error(&self, reason: &str) {
        let drained: Vec<oneshot::Sender<SplitResult>> = {
            let mut queue = match self.pending_splits.lock() {
                Ok(q) => q,
                Err(_) => return,
            };
            queue.drain(..).collect()
        };
        for tx in drained {
            let _ = tx.send(Err(format!(
                "tmux controller {}: {reason}",
                self.controller_id
            )));
        }
    }

    /// drain every pending new-window sender with an error. Mirrors
    /// [`TmuxController::drain_pending_splits_with_error`].
    fn drain_pending_windows_with_error(&self, reason: &str) {
        let drained: Vec<oneshot::Sender<NewWindowResult>> = {
            let mut queue = match self.pending_windows.lock() {
                Ok(q) => q,
                Err(_) => return,
            };
            queue.drain(..).collect()
        };
        for tx in drained {
            let _ = tx.send(Err(format!(
                "tmux controller {}: {reason}",
                self.controller_id
            )));
        }
    }

    /// Override the [`SPLIT_PANE_TIMEOUT`] used by
    /// [`TmuxController::split_pane`]. Test-only — production code paths
    /// use the default. Made `pub(crate)` so unit tests in the same crate
    /// can swap in a shorter timeout.
    #[cfg(test)]
    pub(crate) fn set_split_pane_timeout_for_tests(&mut self, timeout: Duration) {
        self.split_pane_timeout = timeout;
    }

    /// Allocate the next xsterm session id for a newly registered pane.
    /// Visible to the dispatch task via `pub(crate)`.
    pub(crate) fn allocate_xsterm_id(&self) -> u32 {
        self.next_xsterm_id.fetch_add(1, Ordering::Relaxed)
    }

    /// allocate the next xsterm window id for a newly tracked tmux
    /// window. Visible to the dispatch task via `pub(crate)`. Uses the
    /// parallel `controller_id * 1_000_000 + 1` offset so window ids stay
    /// out of the pane-id space and never collide across controllers.
    pub(crate) fn allocate_xsterm_window_id(&self) -> u32 {
        self.next_xsterm_window_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Construct a `TmuxController` for unit tests without spawning a
    /// real `tmux -CC` child process. The returned controller has an
    /// empty backend slot (no monitor task is spawned) and the supplied
    /// `stdin_tx` / `app_backend`. The dispatch task is NOT spawned
    /// here — tests that need it call
    /// [`spawn_dispatch_task`] directly with their own
    /// `mpsc::UnboundedSender<ProtocolEvent>`.
    ///
    /// `pub(crate)` so tests in `services::session_manager` (and
    /// future sibling crates) can wire end-to-end flows against a
    /// fake backend. Production callers must use
    /// [`TmuxController::spawn_local`] / [`TmuxController::spawn_with_args`].
    #[cfg(test)]
    pub(crate) fn new_for_tests(
        controller_id: u32,
        base_xsterm_id: u32,
        stdin_tx: mpsc::UnboundedSender<String>,
        app_backend: Arc<dyn AppBackend>,
    ) -> Arc<Self> {
        use std::collections::VecDeque;
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        Arc::new(Self {
            controller_id,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(base_xsterm_id),
            // Use a parallel window-id offset (controller_id + 1_000_000)
            // so tests that share a controller never collide with the
            // pane-id allocator.
            next_xsterm_window_id: AtomicU32::new(base_xsterm_id + 500_000),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            // 5 s mirrors the production SPLIT_PANE_TIMEOUT (kept in
            // sync by hand — the constant is private to this module).
            split_pane_timeout: Duration::from_secs(5),
        })
    }

    /// Insert `(pane_id → xsterm_session_id)` into the binding map. The
    /// caller is responsible for picking the xsterm id via
    /// [`TmuxController::allocate_xsterm_id`].
    ///
    /// Returns `true` on first registration, `false` if the pane id is
    /// already bound (the existing mapping is left untouched — re-registration
    /// must not overwrite the original xsterm id).
    pub(crate) fn register_pane(&self, tmux_pane_id: String, xsterm_id: u32) -> bool {
        let mut map = match self.pane_bindings.lock() {
            Ok(m) => m,
            Err(_) => return false,
        };
        if map.contains_key(&tmux_pane_id) {
            return false;
        }
        map.insert(tmux_pane_id, xsterm_id);
        true
    }

    /// Record `(xsterm_id, pane_id)` as the first pane and wake one waiter
    /// of [`TmuxController::await_first_pane`]. Idempotent: subsequent
    /// calls are no-ops.
    pub(crate) fn record_first_pane(&self, xsterm_id: u32, pane_id: String) {
        tracing::info!(
            "tmux controller {}: record_first_pane(xsterm_id={}, pane_id={:?}) called by dispatcher",
            self.controller_id,
            xsterm_id,
            pane_id
        );
        if let Ok(mut slot) = self.first_pane_tx.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send((xsterm_id, pane_id));
            } else {
                tracing::warn!(
                    "tmux controller {}: first_pane_tx already consumed (await_first_pane may have already returned)",
                    self.controller_id
                );
            }
        }
    }

    /// record that `pane_id` belongs to `tmux_window_id`. Called by
    /// the dispatch task when it allocates a fresh xsterm pane id, alongside
    /// [`TmuxController::register_pane`]. Used by
    /// [`TmuxController::tmux_window_id_for_pane`] so
    /// [`SessionManager::create_tmux`](crate::services::session_manager::SessionManager::create_tmux)
    /// can populate the bootstrap pane's `tmux_window_id` on its
    /// `SessionInfo`.
    pub(crate) fn record_pane_window(&self, pane_id: String, tmux_window_id: String) {
        if let Ok(mut map) = self.pane_window_bindings.lock() {
            map.insert(pane_id, tmux_window_id);
        }
    }

    /// Return the stable controller id allocated by the [`SessionManager`].
    pub fn controller_id(&self) -> u32 {
        self.controller_id
    }
}

/// Build the `argv` slice for `tmux -CC …` from a [`TmuxCcConfig`].
///
/// Returns owned args so we can hand `&[&str]` to [`Command::args`] without
/// lifetime gymnastics. The layout is:
///
/// ```text
/// tmux -CC [-L <socket>] new-session -d -s <name> -x <cols> -y <rows>
/// ```
///
/// `-d` starts the session detached so the bootstrap pane does not grab
/// the terminal; `-x` / `-y` fix the initial geometry.
fn build_tmux_argv(config: &TmuxCcConfig) -> Result<Vec<String>, String> {
    let mut argv: Vec<String> = Vec::with_capacity(10);
    argv.push("-CC".to_string());

    let socket = config
        .socket_name
        .as_deref()
        .unwrap_or(DEFAULT_TMUX_SOCKET_NAME);
    argv.push("-L".to_string());
    argv.push(socket.to_string());

    argv.push("new-session".to_string());
    // `-A` (attach) instead of `-d` (detached) so the control-mode
    // client is bound to the newly created session immediately. With
    // `-d` tmux creates a detached session and the server closes the
    // control session as soon as `refresh-client -C` arrives (Bug 014).
    argv.push("-A".to_string());

    if let Some(session_name) = config.tmux_session_name.as_deref() {
        argv.push("-s".to_string());
        argv.push(session_name.to_string());
    }

    let rows = config.initial_rows.unwrap_or(DEFAULT_INITIAL_ROWS);
    let cols = config.initial_cols.unwrap_or(DEFAULT_INITIAL_COLS);
    argv.push("-x".to_string());
    argv.push(cols.to_string());
    argv.push("-y".to_string());
    argv.push(rows.to_string());

    Ok(argv)
}

/// Translate a `std::io::Error` from spawning the `tmux` child into
/// a user-friendly message.
///
/// The most common failure on Windows is `tmux` not being on `PATH`
/// — users who have not installed tmux via WSL / MSYS2 / git-bash
/// yet hit this when they try to create their first tmux session.
/// `tokio::process::Command::spawn` reports that as
/// `io::ErrorKind::NotFound`, whose `Display` is the unhelpful
/// `"program not found"` — there is no hint of *which* program was
/// missing. This helper upgrades that single case into an actionable
/// error that names `tmux`, points to common Windows install paths,
/// and shows the argv that was being attempted.
fn tmux_spawn_err(e: std::io::Error, argv: &[&str]) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!(
            "tmux executable not found in PATH. Please install tmux (>= 3.0) and \
             ensure `tmux -V` works from your shell. On Windows, common sources are \
             WSL (`wsl --install`, then install tmux inside the distro), MSYS2 \
             (`pacman -S tmux`), or git-bash (which bundles tmux on newer \
             releases). \
             (Original error: {e}; argv: tmux {})",
            argv.join(" "),
        )
    } else {
        e.to_string()
    }
}

/// POSIX shell-style single-quote escape. Used to compose a single
/// `tmux -CC ...` command string for the SSH exec path. tmux argv
/// arguments may contain spaces (session names with spaces, socket
/// names with hyphens, etc.); wrapping every argument in single quotes
/// with embedded single quotes doubled is the standard portable form.
fn shell_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Spawn the stdout reader task.
///
/// Reads lines from `stdout`, feeds each line through a fresh
/// [`ProtocolParser`], and pushes the resulting [`ProtocolEvent`]s into
/// `dispatch_tx`. Exits when `stdout` returns EOF (tmux closed the pipe,
/// e.g. on `kill -9`) or when the consumer drops `dispatch_tx`.
///
/// **`tmux -CC` wraps its wire protocol in a DCS (Device Control
/// String) passthrough sequence**: stdout looks like
///
/// ```text
/// ESC P 1000 p %begin 1788701964 296 0 \n
/// %output %5 hello\n
/// %end 1788701964 296 0 \n
/// ESC \
/// ```
///
/// The DCS start marker (`ESC P 1000 p`, 7 bytes) is concatenated
/// to the first notification line with no intervening newline, and
/// the DCS end marker (`ESC \`, 2 bytes) may be appended to the last
/// notification. A naive `\n`-line splitter therefore hands the
/// parser a line like `"ESC P 1000 p%begin ..."` — the leading
/// `ESC P 1000 p` prefix causes the parser's `Unknown` branch to
/// drop the *entire* line (including the `%begin` notification
/// inside it). Strip both markers before feeding the parser.
fn spawn_reader_task<R>(stdout: R, dispatch_tx: mpsc::UnboundedSender<ProtocolEvent>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut parser = ProtocolParser::new();
        let mut lines = BufReader::new(stdout).lines();
        tracing::info!("tmux reader: task started");
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    // DEBUG AID: log every raw byte tmux emits so we can
                    // diagnose wire-protocol mismatches from the rolling
                    // log without re-running with a debugger.
                    tracing::info!(
                        "tmux reader: RAW line ({} bytes, hex preview {:?}): {:?}",
                        line.len(),
                        preview_hex(&line, 64),
                        line
                    );
                    // Strip DCS passthrough markers so the parser sees
                    // a clean `%xxx` line stream. See the function
                    // doc above for the byte sequence.
                    const DCS_START: &str = "\u{1b}P1000p";
                    const DCS_END: &str = "\u{1b}\\";
                    let stripped = line
                        .strip_prefix(DCS_START)
                        .unwrap_or(&line)
                        .trim_end_matches(DCS_END);
                    let was_dcs =
                        stripped.as_ptr() != line.as_ptr() || stripped.len() != line.len();
                    tracing::info!(
                        "tmux reader: stripped line (DCS {}): {:?}",
                        if was_dcs { "yes" } else { "no" },
                        stripped
                    );
                    if let Some(event) = parser.feed(stripped) {
                        tracing::info!("tmux reader: parser emitted event: {:?}", event);
                        if dispatch_tx.send(event).is_err() {
                            tracing::debug!("tmux reader: dispatch channel closed, exiting");
                            break;
                        }
                    }
                }
                Ok(None) => {
                    tracing::info!("tmux reader: stdout EOF (tmux closed pipe or exited)");
                    break;
                }
                Err(e) => {
                    tracing::error!("tmux reader: line read error: {e}");
                    break;
                }
            }
        }
        tracing::info!("tmux reader: task exiting");
    });
}

/// First `max_bytes` of `s` rendered as escaped hex (each byte
/// `"\\xNN"`), used by `spawn_reader_task` for a compact diagnostic
/// preview of long lines without flooding the rolling log.
fn preview_hex(s: &str, max_bytes: usize) -> String {
    let bytes = s.as_bytes();
    let take = bytes.len().min(max_bytes);
    let mut out = String::with_capacity(take * 4 + 8);
    for &b in &bytes[..take] {
        if b.is_ascii_graphic() || b == b' ' {
            out.push(b as char);
        } else {
            out.push_str(&format!("\\x{:02x}", b));
        }
    }
    if bytes.len() > take {
        out.push_str(&format!("…(+{} bytes)", bytes.len() - take));
    }
    out
}

/// Spawn the stdin writer task.
///
/// Drains `stdin_rx` and writes each command (newline-terminated, no
/// further framing needed) to `stdin`. Exits when all senders are
/// dropped (the last sender is `TmuxController::stdin_tx`, dropped by
/// [`TmuxController::close`]). On exit, calls `shutdown().await` on
/// `stdin` so tmux sees EOF on its stdin.
fn spawn_writer_task<W>(mut stdin: W, mut stdin_rx: mpsc::UnboundedReceiver<String>)
where
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        while let Some(cmd) = stdin_rx.recv().await {
            if let Err(e) = stdin.write_all(cmd.as_bytes()).await {
                tracing::error!("tmux writer: write failed: {e}");
                break;
            }
            if let Err(e) = stdin.flush().await {
                tracing::error!("tmux writer: flush failed: {e}");
                break;
            }
        }
        let _ = stdin.shutdown().await;
    });
}

/// Spawn a stderr drain task.
///
/// tmux -CC does not normally write to stderr, but if it does (e.g. for a
/// tmux-internal warning) we want it in the rolling log file, not lost.
fn spawn_stderr_drain_task<R>(stderr: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!("tmux stderr: {line}");
        }
    });
}

/// Spawn the child-exit monitor task.
///
/// Takes the backend out of the shared mutex and `await`s
/// `backend.wait()`. If the backend exited on its own (i.e.
/// [`TmuxController::close`] did not set the `killed` flag), pushes a
/// synthetic [`ProtocolEvent::Exit`] with the captured status as the
/// reason.
///
/// takes a `Box<dyn TmuxBackend>` slot instead of a `Child`
/// directly — the trait's `wait()` abstracts over the local `Child` and
/// the SSH channel.
fn spawn_monitor_task(
    backend: Arc<Mutex<Option<Box<dyn TmuxBackend>>>>,
    killed: Arc<AtomicBool>,
    dispatch_tx: mpsc::UnboundedSender<ProtocolEvent>,
) {
    tokio::spawn(async move {
        let mut backend = {
            let mut guard = backend.lock().await;
            match guard.take() {
                Some(b) => b,
                None => return, // close() already took it.
            }
        };
        let reason = match backend.wait().await {
            Ok(0) => None,
            Ok(code) => Some(format!("exit code: {code}")),
            Err(e) => Some(format!("wait error: {e}")),
        };
        tracing::info!(
            "tmux controller monitor: backend.wait() returned reason={:?}, killed={}",
            reason,
            killed.load(Ordering::SeqCst)
        );
        if !killed.load(Ordering::SeqCst) {
            let _ = dispatch_tx.send(ProtocolEvent::Exit { reason });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::io::{duplex, AsyncReadExt};
    use tokio::time::timeout;

    /// Pull up to `max` events from `rx` with a short per-recv timeout, so the
    /// test fails fast instead of hanging on an empty channel.
    async fn drain_events(
        rx: &mut mpsc::UnboundedReceiver<ProtocolEvent>,
        max: usize,
    ) -> Vec<ProtocolEvent> {
        let mut out = Vec::new();
        for _ in 0..max {
            match timeout(std::time::Duration::from_millis(100), rx.recv()).await {
                Ok(Some(ev)) => out.push(ev),
                _ => break,
            }
        }
        out
    }

    /// Hand-rolled `AppBackend` for unit tests — records every emit
    /// through an `Arc<Mutex<Vec<…>>>` so assertions can scan the timeline.
    #[derive(Clone)]
    struct RecordingBackend {
        events: Arc<StdMutex<Vec<(String, serde_json::Value)>>>,
        fail_next: Arc<StdMutex<bool>>,
    }

    impl RecordingBackend {
        fn new() -> Self {
            Self {
                events: Arc::new(StdMutex::new(Vec::new())),
                fail_next: Arc::new(StdMutex::new(false)),
            }
        }
        fn recorded(&self) -> Vec<(String, serde_json::Value)> {
            self.events.lock().unwrap().clone()
        }
    }

    impl AppBackend for RecordingBackend {
        fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
            let fail = *self.fail_next.lock().unwrap();
            if fail {
                *self.fail_next.lock().unwrap() = false;
                return Err("RecordingBackend: forced emit failure".to_string());
            }
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload.clone()));
            Ok(())
        }
        fn emit_binary(&self, _bytes: Vec<u8>) -> Result<(), String> {
            Ok(())
        }
        fn spawn(&self, _f: Box<dyn FnOnce() + Send>) {}
    }

    #[tokio::test]
    async fn reader_task_emits_parsed_events_until_eof() {
        let stdout = Cursor::new(
            b"%begin 1 7 0\nline one\nline two\n%end 1 7 0\n%sessions-changed\n".to_vec(),
        );
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_reader_task(stdout, event_tx);

        let mut events = Vec::new();
        while let Some(ev) = event_rx.recv().await {
            events.push(ev);
        }

        assert!(events.contains(&ProtocolEvent::CommandBegin {
            id: 7,
            timestamp: 1,
            flags: 0
        }));
        assert!(events.contains(&ProtocolEvent::CommandOutput {
            id: 7,
            line: "line one".to_string()
        }));
        assert!(events.contains(&ProtocolEvent::CommandOutput {
            id: 7,
            line: "line two".to_string()
        }));
        assert!(events.contains(&ProtocolEvent::CommandEnd {
            id: 7,
            timestamp: 1,
            flags: 0
        }));
        assert!(events.contains(&ProtocolEvent::SessionsChanged));
    }

    /// `tmux -CC` wraps its wire protocol in a DCS passthrough
    /// sequence (`ESC P 1000 p ... ESC \`). The DCS start marker is
    /// concatenated to the first notification line with no
    /// intervening newline, so the reader's `BufReader::lines()`
    /// splits as one line: `"ESC P 1000 p%begin 1 7 0"`. Without
    /// DCS stripping the parser would drop the whole line as
    /// `Unknown` and miss the `%begin` — the corresponding
    /// command block never opens, the `%end` falls back to
    /// `Unknown`, and no events are emitted.
    ///
    /// Regression test for Bug 009.
    #[tokio::test]
    async fn reader_task_strips_dcs_passthrough_start_marker() {
        let stdout = Cursor::new(
            b"\x1bP1000p%begin 1 7 0\nline one\nline two\n%end 1 7 0\n%sessions-changed\n".to_vec(),
        );
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_reader_task(stdout, event_tx);

        let mut events = Vec::new();
        while let Some(ev) = event_rx.recv().await {
            events.push(ev);
        }

        assert!(events.contains(&ProtocolEvent::CommandBegin {
            id: 7,
            timestamp: 1,
            flags: 0
        }));
        assert!(events.contains(&ProtocolEvent::CommandOutput {
            id: 7,
            line: "line one".to_string()
        }));
        assert!(events.contains(&ProtocolEvent::CommandOutput {
            id: 7,
            line: "line two".to_string()
        }));
        assert!(events.contains(&ProtocolEvent::CommandEnd {
            id: 7,
            timestamp: 1,
            flags: 0
        }));
        assert!(events.contains(&ProtocolEvent::SessionsChanged));
    }

    /// The DCS end marker (`ESC \`, 2 bytes) may be concatenated
    /// to the final notification line. After stripping it the
    /// parser should still see a clean `%xxx` line.
    #[tokio::test]
    async fn reader_task_strips_dcs_passthrough_end_marker() {
        let stdout = Cursor::new(b"%sessions-changed\x1b\\\n".to_vec());
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_reader_task(stdout, event_tx);

        let mut events = Vec::new();
        while let Some(ev) = event_rx.recv().await {
            events.push(ev);
        }

        assert!(events.contains(&ProtocolEvent::SessionsChanged));
    }

    #[tokio::test]
    async fn reader_task_decodes_escaped_output_payload() {
        let stdout = Cursor::new(b"%output %5 hello\\012world\n".to_vec());
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_reader_task(stdout, event_tx);

        let events = drain_events(&mut event_rx, 4).await;
        assert!(events.iter().any(|e| matches!(e,
            ProtocolEvent::Output { pane_id, data }
                if pane_id == "%5" && data == b"hello\nworld"
        )));
    }

    #[tokio::test]
    async fn reader_task_drops_empty_lines_outside_block() {
        let stdout = Cursor::new(b"\n\n%sessions-changed\n\n".to_vec());
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_reader_task(stdout, event_tx);

        let mut events = Vec::new();
        while let Some(ev) = event_rx.recv().await {
            events.push(ev);
        }
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ProtocolEvent::SessionsChanged));
    }

    #[tokio::test]
    async fn writer_task_writes_commands_in_order_and_exits_on_drop() {
        let (a, mut b) = duplex(4096);
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<String>();
        spawn_writer_task(a, cmd_rx);

        cmd_tx
            .send("send-keys -t %5 a\\012\n".to_string())
            .expect("send 1");
        cmd_tx.send("list-sessions\n".to_string()).expect("send 2");
        drop(cmd_tx);

        let mut buf = Vec::new();
        b.read_to_end(&mut buf).await.expect("read_to_end succeeds");
        let s = String::from_utf8(buf).expect("ascii output");
        assert!(s.contains("send-keys -t %5 a\\012"));
        assert!(s.contains("list-sessions"));
    }

    #[tokio::test]
    async fn write_command_on_closed_channel_returns_err() {
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        drop(rx);
        let res = tx.send("cmd\n".to_string());
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn stdin_tx_clone_allows_multiple_writers() {
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let tx2 = tx.clone();
        tx.send("a\n".to_string()).unwrap();
        tx2.send("b\n".to_string()).unwrap();
        drop(tx);
        drop(tx2);

        let mut received = Vec::new();
        while let Some(s) = rx.recv().await {
            received.push(s);
        }
        assert_eq!(received, vec!["a\n".to_string(), "b\n".to_string()]);
    }

    #[test]
    fn build_tmux_argv_includes_cc_socket_session_and_size() {
        let cfg = TmuxCcConfig {
            name: None,
            tmux_session_name: Some("work".to_string()),
            socket_name: Some("dev".to_string()),
            base_config_id: None,
            start_command: None,
            env_config: None,
            initial_rows: Some(40),
            initial_cols: Some(120),
            ssh: None,
        };
        let argv = build_tmux_argv(&cfg).expect("build argv");
        // Convert to Vec<&str> so assertion indexing is straightforward.
        let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
        assert_eq!(argv_refs[0], "-CC");
        assert_eq!(argv_refs[1], "-L");
        assert_eq!(argv_refs[2], "dev");
        assert_eq!(argv_refs[3], "new-session");
        assert_eq!(argv_refs[4], "-A");
        assert_eq!(argv_refs[5], "-s");
        assert_eq!(argv_refs[6], "work");
        assert_eq!(argv_refs[7], "-x");
        assert_eq!(argv_refs[8], "120");
        assert_eq!(argv_refs[9], "-y");
        assert_eq!(argv_refs[10], "40");
    }

    #[test]
    fn build_tmux_argv_uses_defaults_when_config_is_sparse() {
        let cfg = TmuxCcConfig::default();
        let argv = build_tmux_argv(&cfg).expect("build argv");
        let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
        assert_eq!(argv_refs[0], "-CC");
        assert_eq!(argv_refs[2], DEFAULT_TMUX_SOCKET_NAME);
        // No -s flag when tmux_session_name is None.
        assert!(!argv_refs.contains(&"-s"));
        // Last element is the rows value; the column before that is the -y flag.
        assert_eq!(
            argv_refs[argv_refs.len() - 1],
            DEFAULT_INITIAL_ROWS.to_string()
        );
        assert_eq!(
            argv_refs[argv_refs.len() - 3],
            DEFAULT_INITIAL_COLS.to_string()
        );
    }

    #[test]
    fn register_pane_idempotent_and_lookup_round_trip() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 1,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(1_000_001),
            next_xsterm_window_id: AtomicU32::new(1_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        assert!(controller.register_pane("%5".to_string(), 1001));
        assert!(
            !controller.register_pane("%5".to_string(), 1002),
            "duplicate registration must be rejected"
        );
        assert_eq!(controller.xsterm_id_for_pane("%5"), Some(1001));
        assert!(controller.xsterm_id_for_pane("%99").is_none());

        assert_eq!(controller.allocate_xsterm_id(), 1_000_001);
        assert_eq!(controller.allocate_xsterm_id(), 1_000_002);

        controller.record_first_pane(1_000_001, "%5".to_string());
        // Idempotent: second call is a no-op.
        controller.record_first_pane(1_000_002, "%6".to_string());
        // Sender must be taken (first call won).
        assert!(controller.first_pane_tx.lock().unwrap().is_none());
        // The buffered value on the receiver side must match the FIRST
        // call's args, proving the second call was a no-op.
        let mut rx = controller
            .first_pane_rx
            .blocking_lock()
            .take()
            .expect("receiver must still be present");
        assert_eq!(rx.try_recv().ok(), Some((1_000_001, "%5".to_string())));
    }

    #[test]
    fn unbind_pane_removes_entry_and_errors_for_unknown() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 2,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(2_000_001),
            next_xsterm_window_id: AtomicU32::new(2_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        controller.register_pane("%1".to_string(), 2001);
        assert!(controller.unbind_pane("%1").is_ok());
        assert!(controller.xsterm_id_for_pane("%1").is_none());

        let err = controller.unbind_pane("%1").unwrap_err();
        assert!(
            err.contains("not bound"),
            "expected 'not bound' in message, got: {err}"
        );
    }

    #[tokio::test]
    async fn dispatch_emits_session_output_for_registered_pane() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 3,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(3_000_001),
            next_xsterm_window_id: AtomicU32::new(3_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%7".to_string(), 7777);

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 3);
        tx.send(ProtocolEvent::Output {
            pane_id: "%7".to_string(),
            data: b"hi\n".to_vec(),
        })
        .unwrap();
        tx.send(ProtocolEvent::Output {
            pane_id: "%999".to_string(),
            data: b"orphan".to_vec(),
        })
        .unwrap();
        drop(tx);

        // Wait for the dispatch task to drain.
        for _ in 0..20 {
            if backend.recorded().len() >= 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let recorded = backend.recorded();
        let output_event = recorded
            .iter()
            .find(|(name, _)| name == "session-output")
            .expect("session-output must be emitted for the registered pane");
        let arr = output_event
            .1
            .as_array()
            .expect("payload is [xsterm_id, data]");
        assert_eq!(arr[0].as_u64().unwrap(), 7777);
        let data_bytes: Vec<u8> = arr[1]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as u8)
            .collect();
        assert_eq!(data_bytes, b"hi\n");
    }

    #[tokio::test]
    async fn dispatch_emits_pane_added_and_records_first_pane() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 4,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(4_000_001),
            next_xsterm_window_id: AtomicU32::new(4_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 4);

        tx.send(ProtocolEvent::WindowPaneChanged {
            window_id: "@1".to_string(),
            pane_id: "%3".to_string(),
        })
        .unwrap();
        // Duplicate — must be ignored.
        tx.send(ProtocolEvent::WindowPaneChanged {
            window_id: "@1".to_string(),
            pane_id: "%3".to_string(),
        })
        .unwrap();
        // External pane after bootstrap — must NOT be auto-bound in
        // happens out-of-band (e.g. inner-shell `split-window`), the
        // dispatch task logs and skips. The frontend
        // listener for `tmux-pane-added` relies on this so its pane tree
        // never sees a brand-new pane it does not know about.
        tx.send(ProtocolEvent::WindowPaneChanged {
            window_id: "@1".to_string(),
            pane_id: "%4".to_string(),
        })
        .unwrap();
        drop(tx);

        // Spin until the dispatch task has processed all four events.
        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                // Give the dispatch task a few extra ticks to drain.
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let recorded = backend.recorded();
        let pane_adds: Vec<&serde_json::Value> = recorded
            .iter()
            .filter(|(name, _)| name == "tmux-pane-added")
            .map(|(_, p)| p)
            .collect();
        assert_eq!(
            pane_adds.len(),
            1,
            "expected exactly 1 tmux-pane-added event (bootstrap only); got {recorded:?}"
        );
        let first = &pane_adds[0];
        assert_eq!(first["controller_id"].as_u64().unwrap(), 4);
        assert_eq!(first["tmux_pane_id"].as_str().unwrap(), "%3");
        assert_eq!(
            first["parent_tmux_window_id"].as_str().unwrap(),
            "@1",
            "Wave 2 payload must include parent_tmux_window_id"
        );
        assert!(
            first.get("is_hidden").is_none(),
            "Wave 2 payload must NOT include the legacy is_hidden field"
        );

        // The second pane (%4) must NOT be in pane_bindings because no
        // pending_splits sender existed and the bootstrap pane had
        // already been recorded.
        assert!(
            controller.xsterm_id_for_pane("%4").is_none(),
            "external pane %4 must NOT be auto-bound in Wave 2"
        );

        let (awaited_id, awaited_pane) = controller
            .await_first_pane()
            .await
            .expect("first pane must resolve");
        assert_eq!(awaited_pane, "%3");
        assert_eq!(
            awaited_id,
            first["xsterm_session_id"].as_u64().unwrap() as u32
        );
    }

    #[tokio::test]
    async fn dispatch_forwards_pause_continue_and_exit() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 5,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(5_000_001),
            next_xsterm_window_id: AtomicU32::new(5_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 5);

        tx.send(ProtocolEvent::Pause {
            pane_id: "%8".to_string(),
        })
        .unwrap();
        tx.send(ProtocolEvent::Continue {
            pane_id: "%8".to_string(),
        })
        .unwrap();
        tx.send(ProtocolEvent::Exit {
            reason: Some("killed".to_string()),
        })
        .unwrap();
        drop(tx);

        for _ in 0..30 {
            if backend.recorded().len() >= 3 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let recorded = backend.recorded();
        let names: Vec<&str> = recorded.iter().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"tmux-paused"), "recorded = {names:?}");
        assert!(names.contains(&"tmux-continued"), "recorded = {names:?}");
        assert!(
            names.contains(&"tmux-controller-exit"),
            "recorded = {names:?}"
        );

        let exit_payload = backend
            .recorded()
            .iter()
            .find(|(n, _)| n == "tmux-controller-exit")
            .unwrap()
            .1
            .clone();
        assert_eq!(exit_payload["controller_id"].as_u64().unwrap(), 5);
        assert_eq!(exit_payload["reason"].as_str().unwrap(), "killed");
    }

    #[tokio::test]
    async fn await_first_pane_resolves_when_record_first_pane_runs_before_caller() {
        // Regression: when the dispatch task records the first pane BEFORE
        // the caller invokes `await_first_pane`, the reorder fix ensures the
        // fast-path check inside `await_first_pane` reads the stored result
        // and returns immediately. Without the reorder, the buggy code
        // would re-create the `notified()` future *after* the result check,
        // racing against the dispatcher's `notify_waiters()` and risking a
        // lost notification. This test exercises the order where
        // `record_first_pane` runs strictly before `await_first_pane` is
        // awaited, which is the common production path (the dispatcher
        // records the first pane as soon as the bootstrap `WindowPaneChanged`
        // arrives, even if `create_tmux_session` hasn't reached the await
        // yet).
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 6,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(6_000_001),
            next_xsterm_window_id: AtomicU32::new(6_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        // Fire record_first_pane FIRST, with no sleep — simulate the
        // dispatcher winning the race over `await_first_pane`.
        controller.record_first_pane(6_000_042, "%42".to_string());

        let result = controller.await_first_pane().await;
        assert_eq!(result, Ok((6_000_042, "%42".to_string())));
    }

    #[tokio::test]
    async fn await_first_pane_resolves_after_record_first_pane() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 6,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(6_000_001),
            next_xsterm_window_id: AtomicU32::new(6_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        let controller_for_wait = Arc::clone(&controller);
        let waiter = tokio::spawn(async move { controller_for_wait.await_first_pane().await });
        // Give the waiter a tick to subscribe to the notify.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        controller.record_first_pane(6_000_042, "%42".to_string());

        let (xsterm_id, pane_id) = waiter
            .await
            .expect("waiter task did not panic")
            .expect("await_first_pane must resolve after record_first_pane");
        assert_eq!(xsterm_id, 6_000_042);
        assert_eq!(pane_id, "%42");
    }

    #[test]
    fn pane_bindings_snapshot_contains_all_registered_panes() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 7,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(7_000_001),
            next_xsterm_window_id: AtomicU32::new(7_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        controller.register_pane("%3".to_string(), 3003);
        controller.register_pane("%1".to_string(), 3001);
        controller.register_pane("%2".to_string(), 3002);

        let mut snapshot = controller.pane_bindings();
        snapshot.sort();
        assert_eq!(
            snapshot,
            vec![
                ("%1".to_string(), 3001),
                ("%2".to_string(), 3002),
                ("%3".to_string(), 3003),
            ]
        );
    }

    /// Drive the dispatch task directly (no real tmux) and feed it a
    /// `%pane-exited` for an already-bound pane. The dispatch task must
    /// emit `tmux-pane-removed` with the right `controller_id`,
    /// `tmux_pane_id`, and `xsterm_session_id` triple, and remove the
    /// binding from `pane_bindings`.
    #[tokio::test]
    async fn dispatch_routes_pane_exited_to_tmux_pane_removed() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 8,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(8_000_001),
            next_xsterm_window_id: AtomicU32::new(8_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%5".to_string(), 8_000_042);

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 8);

        tx.send(ProtocolEvent::PaneExited {
            pane_id: "%5".to_string(),
        })
        .unwrap();
        drop(tx);

        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let recorded = backend.recorded();
        let removed = recorded
            .iter()
            .find(|(n, _)| n == "tmux-pane-removed")
            .expect("tmux-pane-removed must be emitted for bound pane");
        assert_eq!(removed.1["controller_id"].as_u64().unwrap(), 8);
        assert_eq!(removed.1["tmux_pane_id"].as_str().unwrap(), "%5");
        assert_eq!(removed.1["xsterm_session_id"].as_u64().unwrap(), 8_000_042);

        // The binding must be removed so subsequent send_keys / resize_pane
        // calls fail fast with a "not registered" error.
        assert!(
            controller.xsterm_id_for_pane("%5").is_none(),
            "pane-exited must remove the binding"
        );
    }

    /// Same as above but with `%pane-died`. The dispatch path treats both
    /// events identically (look up + remove + emit).
    #[tokio::test]
    async fn dispatch_routes_pane_died_to_tmux_pane_removed() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 9,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(9_000_001),
            next_xsterm_window_id: AtomicU32::new(9_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%9".to_string(), 9_000_007);

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 9);

        tx.send(ProtocolEvent::PaneDied {
            pane_id: "%9".to_string(),
        })
        .unwrap();
        drop(tx);

        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let recorded = backend.recorded();
        let removed = recorded
            .iter()
            .find(|(n, _)| n == "tmux-pane-removed")
            .expect("tmux-pane-removed must be emitted on %pane-died");
        assert_eq!(removed.1["controller_id"].as_u64().unwrap(), 9);
        assert_eq!(removed.1["tmux_pane_id"].as_str().unwrap(), "%9");
        assert_eq!(removed.1["xsterm_session_id"].as_u64().unwrap(), 9_000_007);
    }

    /// Pane-exited / pane-died for an UNBOUND pane (e.g. an external
    /// pane created out-of-band, never registered) must NOT emit
    /// `tmux-pane-removed`. The frontend listener would otherwise drop
    /// a real `Session` from React state.
    #[tokio::test]
    async fn dispatch_does_not_emit_removed_for_unbound_pane() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 10,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(10_000_001),
            next_xsterm_window_id: AtomicU32::new(10_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 10);

        tx.send(ProtocolEvent::PaneExited {
            pane_id: "%404".to_string(),
        })
        .unwrap();
        drop(tx);

        // Drain whatever the dispatch task emits.
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let recorded = backend.recorded();
        assert!(
            recorded.iter().all(|(n, _)| n != "tmux-pane-removed"),
            "tmux-pane-removed must NOT fire for unbound pane, got {recorded:?}"
        );
    }

    /// Drive `split_pane` end-to-end without a real tmux:
    /// 1. Call `split_pane` on a bound parent pane.
    /// 2. Manually push a sender into `pending_splits` (simulating what
    ///    `split_pane` does internally) — actually we just call
    ///    `split_pane` directly so the sender registration happens.
    /// 3. Feed the dispatch task a `%window-pane-changed` for the new
    ///    pane id.
    /// 4. The oneshot receiver returns the `(xsterm_id, pane_id,
    ///    window_id)` triple and the dispatch task emits
    ///    `tmux-pane-added` with `parent_tmux_window_id`.
    #[tokio::test]
    async fn split_pane_resolves_when_dispatch_sees_window_pane_changed() {
        let backend = Arc::new(RecordingBackend::new());
        let (stdin_tx, mut _stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 11,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(11_000_001),
            next_xsterm_window_id: AtomicU32::new(11_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%5".to_string(), 11_000_042);
        // Pre-record the first pane so the dispatch task takes the
        // split-result path (case 2) instead of the bootstrap path
        // (case 3) for the reply we feed below.
        controller.record_first_pane(11_000_042, "%5".to_string());

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 11);

        // Kick off the split in a background task; it will block on the
        // oneshot until the dispatch task sees the reply.
        let controller_clone = Arc::clone(&controller);
        let split_handle = tokio::spawn(async move {
            controller_clone
                .split_pane("%5", SplitDirection::Horizontal)
                .await
        });

        // Yield to let the split task register its sender.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // Feed the matching reply.
        tx.send(ProtocolEvent::WindowPaneChanged {
            window_id: "@7".to_string(),
            pane_id: "%11".to_string(),
        })
        .unwrap();

        let result = tokio::time::timeout(std::time::Duration::from_secs(2), split_handle)
            .await
            .expect("split did not time out")
            .expect("split task did not panic");
        let (xsterm_id, tmux_pane_id, tmux_window_id) =
            result.expect("split must return Ok on matching reply");
        assert_eq!(xsterm_id, 11_000_001);
        assert_eq!(tmux_pane_id, "%11");
        assert_eq!(tmux_window_id, "@7");

        // The new pane must be registered, and the dispatch task must
        // have emitted `tmux-pane-added` with the Wave 2 payload.
        assert_eq!(controller.xsterm_id_for_pane("%11"), Some(11_000_001));

        drop(tx);
        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let recorded = backend.recorded();
        let added = recorded
            .iter()
            .find(|(n, _)| n == "tmux-pane-added")
            .expect("tmux-pane-added must be emitted for split result");
        assert_eq!(added.1["controller_id"].as_u64().unwrap(), 11);
        assert_eq!(added.1["tmux_pane_id"].as_str().unwrap(), "%11");
        assert_eq!(added.1["xsterm_session_id"].as_u64().unwrap(), 11_000_001);
        assert_eq!(added.1["parent_tmux_window_id"].as_str().unwrap(), "@7");
    }

    /// When no `%window-pane-changed` reply ever arrives (e.g. tmux
    /// hangs), `split_pane` must return an `Err` after
    /// `split_pane_timeout`. The test injects a 50 ms timeout via
    /// `set_split_pane_timeout_for_tests` so it runs in well under a
    /// second.
    #[tokio::test]
    async fn split_pane_times_out_when_no_response() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let mut controller = TmuxController {
            controller_id: 12,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(12_000_001),
            next_xsterm_window_id: AtomicU32::new(12_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        };
        controller.register_pane("%5".to_string(), 12_000_001);
        controller.set_split_pane_timeout_for_tests(Duration::from_millis(50));
        let controller = Arc::new(controller);

        // No dispatch task → no WindowPaneChanged reply ever arrives.
        let started = std::time::Instant::now();
        let result = controller.split_pane("%5", SplitDirection::Vertical).await;
        let elapsed = started.elapsed();

        let err = result.expect_err("split must time out without a reply");
        assert!(
            err.contains("timed out"),
            "expected 'timed out' in error, got: {err}"
        );
        // 50 ms timeout + a few ms of slack — should be far less than 1 s.
        assert!(
            elapsed < Duration::from_secs(1),
            "split should fail fast on timeout, took {elapsed:?}"
        );
    }

    /// `kill_pane` must reject an unbound pane and accept a bound pane,
    /// queueing `kill-pane -t %<id>` on the writer-task stdin channel.
    /// We verify by capturing what was sent into the channel via a
    /// duplex pipe.
    #[tokio::test]
    async fn kill_pane_writes_correct_command_to_stdin() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = TmuxController {
            controller_id: 13,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(13_000_001),
            next_xsterm_window_id: AtomicU32::new(13_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        };
        controller.register_pane("%0".to_string(), 13_000_001);

        // Unknown pane must error.
        let err = controller.kill_pane("%999").unwrap_err();
        assert!(err.contains("not registered"), "got: {err}");

        // Bound pane must succeed and queue the kill-pane command.
        controller
            .kill_pane("%0")
            .expect("kill_pane on bound pane must succeed");

        let cmd = stdin_rx
            .recv()
            .await
            .expect("a kill-pane command must be queued on stdin");
        assert_eq!(
            cmd, "kill-pane -t %0\n",
            "kill_pane must queue the literal kill-pane -t <pane>\\n command"
        );
    }

    /// `close` must drain every pending split sender with an error so a
    /// Tauri command awaiting a split result does not block the full
    /// `SPLIT_PANE_TIMEOUT` after the controller has been torn down.
    #[tokio::test]
    async fn close_drains_pending_splits_with_error() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 14,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(14_000_001),
            next_xsterm_window_id: AtomicU32::new(14_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%5".to_string(), 14_000_001);

        // Push a dummy sender directly so we can verify `close` drains
        // it without going through `split_pane` (which would try to
        // write to the no-op stdin_tx and fail).
        let (tx, rx) = oneshot::channel::<SplitResult>();
        controller.pending_splits.lock().unwrap().push_back(tx);

        controller.close().expect("close must succeed");

        let result = tokio::time::timeout(std::time::Duration::from_secs(1), rx)
            .await
            .expect("close must wake the pending sender within 1 s")
            .expect("oneshot must resolve with Err");
        let err = result.expect_err("drained sender must yield Err");
        assert!(
            err.contains("controller closed"),
            "expected 'controller closed' in error, got: {err}"
        );
    }

    // ===========================================================================
    // Wave 3 tests: tmux window / xsterm Window mapping
    // ===========================================================================

    /// drive the dispatch task end-to-end for a user-driven
    /// `new_window` request. The test pushes a sender into `pending_windows`
    /// (simulating what `new_window` does internally), feeds a
    /// `%window-add` then a `%window-pane-changed`, and verifies that:
    /// 1. The sender resolves with the correct quadruple.
    /// 2. The new pane is registered in `pane_bindings` /
    ///    `pane_window_bindings`.
    /// 3. `window_bindings` is populated.
    /// 4. `tmux-window-added` AND `tmux-pane-added` events are emitted
    ///    with the Wave 3 payload.
    #[tokio::test]
    async fn dispatch_resolves_new_window_via_window_add_then_pane_changed() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 15,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(15_000_001),
            next_xsterm_window_id: AtomicU32::new(15_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 15);

        // Pre-record the bootstrap pane so the dispatch task takes the
        // new-window path (not the legacy bootstrap fallback).
        controller.register_pane("%0".to_string(), 15_000_042);
        controller.record_first_pane(15_000_042, "%0".to_string());

        // Push a sender into pending_windows (simulating new_window).
        let (user_tx, user_rx) = oneshot::channel::<NewWindowResult>();
        controller
            .pending_windows
            .lock()
            .unwrap()
            .push_back(user_tx);

        // Yield so the dispatch task is ready to receive.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // Feed the WindowAdd reply.
        tx.send(ProtocolEvent::WindowAdd {
            window_id: "@9".to_string(),
        })
        .unwrap();

        // Give the dispatch task a tick to stash the pending entry.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // Feed the WindowPaneChanged reply (the first pane of the new window).
        tx.send(ProtocolEvent::WindowPaneChanged {
            window_id: "@9".to_string(),
            pane_id: "%13".to_string(),
        })
        .unwrap();

        let result = tokio::time::timeout(std::time::Duration::from_secs(2), user_rx)
            .await
            .expect("new_window sender must resolve within 2s")
            .expect("oneshot channel must not be dropped");
        let (xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id) =
            result.expect("new_window must return Ok on matching reply");
        assert_eq!(xsterm_window_id, 15_500_001);
        assert_eq!(tmux_window_id, "@9");
        assert_eq!(xsterm_session_id, 15_000_001);
        assert_eq!(tmux_pane_id, "%13");

        // Pane + window bindings must be populated.
        assert_eq!(controller.xsterm_id_for_pane("%13"), Some(15_000_001));
        assert_eq!(
            controller.window_bindings(),
            vec![("@9".to_string(), 15_500_001)]
        );
        assert_eq!(
            controller.tmux_window_id_for_pane("%13").as_deref(),
            Some("@9")
        );

        // Spin until the dispatch task has emitted both events.
        for _ in 0..30 {
            if backend.recorded().len() >= 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let recorded = backend.recorded();

        let pane_added = recorded
            .iter()
            .find(|(n, _)| n == "tmux-pane-added")
            .expect("tmux-pane-added must be emitted for the new window's first pane");
        assert_eq!(pane_added.1["controller_id"].as_u64().unwrap(), 15);
        assert_eq!(pane_added.1["tmux_pane_id"].as_str().unwrap(), "%13");
        assert_eq!(
            pane_added.1["xsterm_session_id"].as_u64().unwrap(),
            15_000_001
        );
        assert_eq!(
            pane_added.1["parent_tmux_window_id"].as_str().unwrap(),
            "@9"
        );

        let window_added = recorded
            .iter()
            .find(|(n, _)| n == "tmux-window-added")
            .expect("tmux-window-added must be emitted for user-driven new-window");
        assert_eq!(window_added.1["controller_id"].as_u64().unwrap(), 15);
        assert_eq!(window_added.1["tmux_window_id"].as_str().unwrap(), "@9");
        assert_eq!(
            window_added.1["xsterm_window_id"].as_u64().unwrap(),
            15_500_001
        );
        assert_eq!(
            window_added.1["xsterm_session_id"].as_u64().unwrap(),
            15_000_001
        );
        assert_eq!(window_added.1["xsterm_pane_id"].as_str().unwrap(), "%13");
    }

    /// the bootstrap window is the first `%window-add` we see
    /// when no `pending_windows` sender exists. The dispatch task must:
    /// 1. Allocate an xsterm window id.
    /// 2. Stash it in `pending_window_pane` with `sender = None`.
    /// 3. NOT emit `tmux-window-added` (the frontend already owns the
    ///    bootstrap Window).
    /// 4. On the matching `%window-pane-changed`, register the pane,
    ///    move the pending entry to `window_bindings`, emit
    ///    `tmux-pane-added`, and record the first pane for
    ///    `await_first_pane` to resolve.
    #[tokio::test]
    async fn dispatch_handles_bootstrap_window_without_pending_sender() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 16,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(16_000_001),
            next_xsterm_window_id: AtomicU32::new(16_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 16);

        // Feed WindowAdd for the bootstrap window — no pending_windows
        // sender, window_bindings is empty → bootstrap path.
        tx.send(ProtocolEvent::WindowAdd {
            window_id: "@1".to_string(),
        })
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // Feed WindowPaneChanged — should resolve the pending entry.
        tx.send(ProtocolEvent::WindowPaneChanged {
            window_id: "@1".to_string(),
            pane_id: "%0".to_string(),
        })
        .unwrap();
        drop(tx);

        // Spin until the dispatch task has processed both events.
        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let recorded = backend.recorded();

        // tmux-window-added must NOT be emitted for the bootstrap window.
        assert!(
            recorded.iter().all(|(n, _)| n != "tmux-window-added"),
            "tmux-window-added must NOT fire for bootstrap window, got {recorded:?}"
        );

        // tmux-pane-added must be emitted once (with the bootstrap pane).
        let pane_added = recorded
            .iter()
            .find(|(n, _)| n == "tmux-pane-added")
            .expect("tmux-pane-added must be emitted for the bootstrap pane");
        assert_eq!(pane_added.1["tmux_pane_id"].as_str().unwrap(), "%0");
        assert_eq!(
            pane_added.1["parent_tmux_window_id"].as_str().unwrap(),
            "@1"
        );
        assert_eq!(
            pane_added.1["xsterm_session_id"].as_u64().unwrap(),
            16_000_001
        );

        // window_bindings must be populated.
        assert_eq!(
            controller.window_bindings(),
            vec![("@1".to_string(), 16_500_001)]
        );
        // await_first_pane must resolve.
        let (xsterm_id, pane_id) = controller
            .await_first_pane()
            .await
            .expect("first pane must resolve after bootstrap dispatch");
        assert_eq!(xsterm_id, 16_000_001);
        assert_eq!(pane_id, "%0");
        assert_eq!(
            controller.tmux_window_id_for_pane("%0").as_deref(),
            Some("@1"),
            "bootstrap pane must have its tmux window id recorded"
        );
    }

    /// a `%window-close` for a bound window must emit
    /// `tmux-window-closed` with the matching xsterm window id and drop
    /// the binding. `%window-close` for an unbound window must NOT emit
    /// the event.
    #[tokio::test]
    async fn dispatch_routes_window_close_to_tmux_window_closed() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 17,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(17_000_001),
            next_xsterm_window_id: AtomicU32::new(17_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        // Pre-register a window + pane (simulates bootstrap done).
        controller
            .window_bindings
            .lock()
            .unwrap()
            .insert("@3".to_string(), 17_500_042);
        controller
            .pane_bindings
            .lock()
            .unwrap()
            .insert("%9".to_string(), 17_000_042);
        controller
            .pane_window_bindings
            .lock()
            .unwrap()
            .insert("%9".to_string(), "@3".to_string());

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 17);

        // Bound window-close → emit + drop binding + drop panes in that window.
        tx.send(ProtocolEvent::WindowClose {
            window_id: "@3".to_string(),
        })
        .unwrap();
        // Unbound window-close → no emit.
        tx.send(ProtocolEvent::WindowClose {
            window_id: "@99".to_string(),
        })
        .unwrap();
        drop(tx);

        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let recorded = backend.recorded();
        let closed_events: Vec<_> = recorded
            .iter()
            .filter(|(n, _)| n == "tmux-window-closed")
            .collect();
        assert_eq!(
            closed_events.len(),
            1,
            "exactly one tmux-window-closed must be emitted, got {recorded:?}"
        );
        let closed = closed_events[0].1.clone();
        assert_eq!(closed["controller_id"].as_u64().unwrap(), 17);
        assert_eq!(closed["tmux_window_id"].as_str().unwrap(), "@3");
        assert_eq!(closed["xsterm_window_id"].as_u64().unwrap(), 17_500_042);

        // Binding must be dropped.
        assert!(
            controller
                .window_bindings()
                .iter()
                .all(|(tid, _)| tid != "@3"),
            "window_bindings must drop @3 after WindowClose"
        );
        // Pane in that window must also be dropped defensively.
        assert!(
            controller.xsterm_id_for_pane("%9").is_none(),
            "pane bindings for the closed window must be dropped"
        );
        assert!(
            controller.tmux_window_id_for_pane("%9").is_none(),
            "pane_window_bindings for the closed window must be dropped"
        );
    }

    /// a `%window-renamed` for a bound window must emit
    /// `tmux-window-renamed` with the matching xsterm window id and the
    /// new name. `%window-renamed` for an unbound window must NOT emit
    /// the event.
    #[tokio::test]
    async fn dispatch_routes_window_renamed_to_tmux_window_renamed() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 18,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(18_000_001),
            next_xsterm_window_id: AtomicU32::new(18_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller
            .window_bindings
            .lock()
            .unwrap()
            .insert("@5".to_string(), 18_500_099);

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 18);

        tx.send(ProtocolEvent::WindowRenamed {
            window_id: "@5".to_string(),
            name: "editor".to_string(),
        })
        .unwrap();
        tx.send(ProtocolEvent::WindowRenamed {
            window_id: "@404".to_string(),
            name: "orphan".to_string(),
        })
        .unwrap();
        drop(tx);

        for _ in 0..30 {
            if backend.recorded().len() >= 1 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let recorded = backend.recorded();
        let renamed: Vec<_> = recorded
            .iter()
            .filter(|(n, _)| n == "tmux-window-renamed")
            .collect();
        assert_eq!(renamed.len(), 1, "got {recorded:?}");
        let payload = renamed[0].1.clone();
        assert_eq!(payload["controller_id"].as_u64().unwrap(), 18);
        assert_eq!(payload["tmux_window_id"].as_str().unwrap(), "@5");
        assert_eq!(payload["xsterm_window_id"].as_u64().unwrap(), 18_500_099);
        assert_eq!(payload["name"].as_str().unwrap(), "editor");
    }

    /// `kill_window` and `rename_window` must reject unbound
    /// windows and accept bound ones, queueing the right commands on the
    /// controller's stdin FIFO.
    #[tokio::test]
    async fn kill_window_and_rename_window_write_correct_commands_to_stdin() {
        let backend: Arc<dyn AppBackend> = Arc::new(RecordingBackend::new());
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = TmuxController {
            controller_id: 19,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(19_000_001),
            next_xsterm_window_id: AtomicU32::new(19_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        };
        controller
            .window_bindings
            .lock()
            .unwrap()
            .insert("@7".to_string(), 19_500_077);

        // Unknown window → Err.
        let err = controller.kill_window("@404").unwrap_err();
        assert!(err.contains("not registered"), "got: {err}");
        let err = controller.rename_window("@404", "x").unwrap_err();
        assert!(err.contains("not registered"), "got: {err}");

        // Bound window → success and correct commands queued.
        controller
            .kill_window("@7")
            .expect("kill_window on bound window must succeed");
        controller
            .rename_window("@7", "new name")
            .expect("rename_window on bound window must succeed");

        let cmd1 = stdin_rx
            .recv()
            .await
            .expect("kill-window command must arrive on stdin");
        assert_eq!(cmd1, "kill-window -t @7\n");
        let cmd2 = stdin_rx
            .recv()
            .await
            .expect("rename-window command must arrive on stdin");
        assert_eq!(cmd2, "rename-window -t @7 \"new name\"\n");
    }

    // ===========================================================================
    // Wave 4 tests: capture-pane + attach-session Promise coordination
    // ===========================================================================

    /// `capture_pane` resolves with the captured text when the
    /// dispatch task sees a matching `%begin..%output..%end` block. Also
    /// asserts that the right tmux command (`capture-pane -p -e -J -S
    /// -100 -t %42`) was written to stdin in FIFO order before tmux
    /// replies.
    #[tokio::test]
    async fn capture_pane_resolves_on_command_end_after_command_output() {
        let backend = Arc::new(RecordingBackend::new());
        let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 100,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(100_000_001),
            next_xsterm_window_id: AtomicU32::new(100_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%42".to_string(), 100_000_042);

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 100);

        // Kick off capture_pane in a background task.
        let controller_clone = Arc::clone(&controller);
        let capture_handle =
            tokio::spawn(async move { controller_clone.capture_pane("%42", 100).await });

        // Yield so capture_pane registers its sender + writes the command.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        // Drive the dispatch task with a synthetic %begin/%output/%end block.
        tx.send(ProtocolEvent::CommandBegin {
            id: 7,
            timestamp: 1,
            flags: 0,
        })
        .unwrap();
        tx.send(ProtocolEvent::CommandOutput {
            id: 7,
            line: "first line".to_string(),
        })
        .unwrap();
        tx.send(ProtocolEvent::CommandOutput {
            id: 7,
            line: "second line".to_string(),
        })
        .unwrap();
        tx.send(ProtocolEvent::CommandOutput {
            id: 7,
            line: "third line".to_string(),
        })
        .unwrap();
        tx.send(ProtocolEvent::CommandEnd {
            id: 7,
            timestamp: 1,
            flags: 0,
        })
        .unwrap();

        let result = tokio::time::timeout(std::time::Duration::from_secs(2), capture_handle)
            .await
            .expect("capture_pane must not time out")
            .expect("capture_pane task did not panic");
        let text = result.expect("capture_pane must return Ok on matching reply");
        assert_eq!(text, "first line\nsecond line\nthird line");
    }

    /// a `%error` reply resolves `capture_pane` with an `Err`
    /// carrying tmux's reported message (no body lines are surfaced).
    #[tokio::test]
    async fn capture_pane_resolves_with_err_on_command_error() {
        let backend = Arc::new(RecordingBackend::new());
        let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 101,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend.clone(),
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(101_000_001),
            next_xsterm_window_id: AtomicU32::new(101_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%9".to_string(), 101_000_009);

        let (tx, rx) = mpsc::unbounded_channel::<ProtocolEvent>();
        spawn_dispatch_task(rx, controller.clone(), backend.clone(), 101);

        let controller_clone = Arc::clone(&controller);
        let capture_handle =
            tokio::spawn(async move { controller_clone.capture_pane("%9", 50).await });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        tx.send(ProtocolEvent::CommandError {
            id: 11,
            timestamp: 2,
            flags: 0,
            message: "pane gone".to_string(),
        })
        .unwrap();

        let result = tokio::time::timeout(std::time::Duration::from_secs(2), capture_handle)
            .await
            .expect("capture_pane must not time out")
            .expect("capture_pane task did not panic");
        let err = result.expect_err("capture_pane must return Err on %error");
        assert!(
            err.contains("capture-pane failed") && err.contains("pane gone"),
            "expected error to surface tmux's message, got: {err}"
        );
    }

    /// `capture_pane` rejects an unbound pane with a clear
    /// "not registered" message and does NOT write anything to stdin.
    #[tokio::test]
    async fn capture_pane_errors_on_unbound_pane() {
        let backend = Arc::new(RecordingBackend::new());
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = TmuxController {
            controller_id: 102,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(102_000_001),
            next_xsterm_window_id: AtomicU32::new(102_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        };

        let err = controller
            .capture_pane("%999", 100)
            .await
            .expect_err("capture_pane on unbound pane must error");
        assert!(
            err.contains("not registered"),
            "expected 'not registered' in error, got: {err}"
        );
        // No command must have been queued on stdin.
        assert!(
            stdin_rx.try_recv().is_err(),
            "capture_pane must not write to stdin for unbound pane"
        );
    }

    /// `close` wakes an outstanding `capture_pane` awaiter with
    /// an `Err("controller closed")` so a Tauri command awaiting
    /// `capture_tmux_pane` does not block the full 5 s CAPTURE_PANE_TIMEOUT
    /// after the controller has been torn down.
    #[tokio::test]
    async fn close_drains_pending_capture_with_error() {
        let backend = Arc::new(RecordingBackend::new());
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        let controller = Arc::new(TmuxController {
            controller_id: 103,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx: mpsc::unbounded_channel::<String>().0,
            app_backend: backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            next_xsterm_id: AtomicU32::new(103_000_001),
            next_xsterm_window_id: AtomicU32::new(103_500_001),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            pending_splits: std::sync::Mutex::new(VecDeque::new()),
            pending_windows: std::sync::Mutex::new(VecDeque::new()),
            pending_window_pane: std::sync::Mutex::new(HashMap::new()),
            window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_name: std::sync::Mutex::new(None),
            pending_capture: std::sync::Mutex::new(None),

            current_command_id: std::sync::Mutex::new(None),
            current_command_lines: std::sync::Mutex::new(Vec::new()),

            pending_capture_body: std::sync::Mutex::new(Vec::new()),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: SPLIT_PANE_TIMEOUT,
        });
        controller.register_pane("%1".to_string(), 103_000_001);

        // Push a dummy sender directly so we can verify `close` drains
        // it without going through `capture_pane` (which would block on
        // stdin_tx that is a no-op channel).
        let (tx, rx) = oneshot::channel::<CaptureResult>();
        controller.pending_capture.lock().unwrap().replace(tx);

        controller.close().expect("close must succeed");

        let result = tokio::time::timeout(std::time::Duration::from_secs(1), rx)
            .await
            .expect("close must wake the pending sender within 1 s")
            .expect("oneshot must resolve with Err");
        let err = result.expect_err("drained sender must yield Err");
        assert!(
            err.contains("controller closed"),
            "expected 'controller closed' in error, got: {err}"
        );
    }
}
