//! Tmux control-mode controller.
//!
//! One `TmuxController` wraps one `tmux -CC` child process (local PTY or
//! SSH exec channel) and the I/O tasks that drive it:
//!
//! 1. Spawn `tmux` as a child process or open an SSH exec channel
//!    running `tmux -CC`, via the [`TmuxBackend`] trait abstraction.
//! 2. Read stdout line-by-line, feed each line through a
//!    [`ProtocolParser`], and hand the resulting [`ProtocolEvent`]s to
//!    a dispatch task.
//! 3. The dispatch task interprets each event, emits
//!    `"session-output"` / `"tmux-pane-added"` / etc. via
//!    [`AppBackend`], and resolves any in-flight public-method waiters
//!    (capture / split / new-window).
//!
//! The sub-modules `handshake`, `id_map`, and `subscriber` host the
//! handshake planner, command/event waiter registry, and event-router
//! state respectively; this file hosts the [`TmuxController`] struct,
//! its constructors, and its public API.
//!
//! [`TmuxBackend`]: crate::infrastructure::tmux::backend::TmuxBackend
//! [`AppBackend`]: crate::infrastructure::app_backend::AppBackend
//! [`ProtocolParser`]: crate::services::tmux::protocol::parser::ProtocolParser
//! [`ProtocolEvent`]: crate::services::tmux::protocol::events::ProtocolEvent

/// How this controller was created — drives the dispatch task's
/// behaviour on the `%window-add` / `%window-pane-changed` /
/// `list-panes` / `list-windows` replies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnMode {
    /// `spawn_create` / `spawn_with_args`. We asked tmux to `new-session
    /// -A`; the server should have created exactly one window for us
    /// (after the unconditional `new-window` we enqueue). The dispatch
    /// task only emits `tmux-pane-added` for the **first** pane per
    /// window so xsterm doesn't get spammed with stale panes.
    Create,
    /// `spawn_attach`. We asked tmux to `attach-session -t <name>`;
    /// the server has *N existing windows and panes*. The dispatch task
    /// emits `tmux-pane-added` for **every** pane `list-panes -a` returns
    /// so xsterm mirrors the server's full state.
    Attach,
}

pub(crate) mod handshake;
pub(crate) mod id_map;
pub(crate) mod subscriber;

#[cfg(test)]
mod tests;

// Re-export so existing `controller::TmuxController` callers keep working.
pub use self::handshake::{
    execute_plan, execute_step, parse_probe, plan_for, FirstPane, HandshakeError, HandshakePlan,
    HandshakeResult, HandshakeStep, ProbeResult, HANDSHAKE_STEP_TIMEOUT,
};
pub use self::id_map::{send_to_waiter, CommandRegistry, RegisteredCommand};
pub use self::subscriber::{RouterAction, RouterState};

use super::bridge::TmuxBridge;
use super::dispatch::spawn_dispatch_task;
use super::errors::{spawn_err, TmuxError};
use super::protocol::command::{
    CommandKind, EventWaiter, EventWaiterKind, EventWaiterSender, ResponseOutcome, ResponseWaiter,
};
use super::protocol::events::ProtocolEvent;
use super::protocol::parser::ProtocolParser;
use super::protocol::wire as tmux_cmd;
use std::collections::{HashMap, HashSet};
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
/// Reply timeout for `await_first_pane` / `split_pane` / `new_window`
/// / `capture_pane`. tmux replies within milliseconds; 5 s is a
/// defensive upper bound that fails fast on a stuck child.
const TMUX_REPLY_TIMEOUT: Duration = Duration::from_secs(5);
/// Default tmux socket name when [`TmuxCcConfig::socket_name`] is `None`.
const DEFAULT_TMUX_SOCKET_NAME: &str = "default";

/// Resolve the tmux socket name, falling back to
/// [`DEFAULT_TMUX_SOCKET_NAME`] when the config leaves it `None`.
fn tmux_socket_name(config: &TmuxCcConfig) -> &str {
    config
        .socket_name
        .as_deref()
        .unwrap_or(DEFAULT_TMUX_SOCKET_NAME)
}

/// Result of a [`TmuxController::split_pane`] request.
///
/// `Ok(xsterm_session_id, tmux_pane_id, tmux_window_id)` once tmux confirms
/// the split via `%window-pane-changed`. `Err(message)` on timeout, on a
/// closed channel, or when tmux itself reports a command error (the
/// dispatch task propagates the [`TmuxError`] into the oneshot so the
/// awaiting Tauri command returns a clean `Err` to the frontend —
/// the [`From<TmuxError> for String`] impl at `services/tmux/mod.rs`
/// bridges the two at the Tauri boundary).
pub(crate) type SplitResult = Result<(u32, String, String), TmuxError>;

/// Result of a [`TmuxController::new_window`] request.
///
/// `Ok(tmux_window_id, session_id, tmux_pane_id)` once tmux confirms
/// the new window via `%window-pane-changed` (the first pane of the
/// new window is reported in the same reply chain). The frontend uses
/// `tmux_window_id` directly as the `Window.id` (no parallel
/// `xsterm_window_id` exists any more); `session_id` is the Session.id
/// for the new window's first pane.
/// `Err(TmuxError)` on timeout, on a closed channel, or when tmux
/// itself reports a command error.
pub(crate) type NewWindowResult = Result<(String, u32, String), TmuxError>;

/// Result of a [`TmuxController::capture_pane`] request.
///
/// `Ok(text)` once tmux confirms via `%end` (body lines joined with `\n`).
/// `Err(TmuxError)` on timeout, on a closed channel, on a `%error`
/// reply, or when tmux itself reports the command failed.
pub(crate) type CaptureResult = Result<String, TmuxError>;

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
    /// Closure injected by [`SessionManager`](crate::services::session_manager::SessionManager)
    /// that delegates to the manager's shared
    /// [`SessionIdSource`](crate::models::session::SessionIdSource).
    /// The dispatch task calls it whenever it needs a fresh Session.id
    /// for a newly-registered pane (split, bootstrap-list-panes,
    /// etc.). For the bootstrap pane specifically, the manager
    /// pre-allocates the id and passes it via
    /// used for panes that arrive after the bootstrap.
    session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    /// Session.id pre-allocated by [`SessionManager`] for the
    /// bootstrap pane (the first pane tmux reports via
    /// `%window-pane-changed`). Consumed by
    /// [`TmuxController::record_first_pane`] on the dispatch task's
    /// first call; subsequent panes go through
    /// [`TmuxController::session_id_allocator`] instead.

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
    /// Buffered windows from the initial `list-windows` response. The
    /// dispatch task stashes them here instead of emitting a
    /// `tmux-window-list` event — the controller hands them to the
    /// caller (SessionManager) synchronously via
    /// [`TmuxController::take_initial_state`] so the new
    /// `create_tmux_session` / `attach_tmux_session` IA returns the
    /// full initial state in one round-trip.
    initial_windows: std::sync::Mutex<Option<Vec<crate::models::session::TmuxWindowInit>>>,
    /// Buffered panes from the initial `list-panes` response. Same IA
    /// rationale as [`TmuxController::initial_windows`].
    initial_panes: std::sync::Mutex<Option<Vec<crate::models::session::TmuxPaneInit>>>,
    /// Signalled by the dispatch task when **both** `list-windows` AND
    /// `list-panes` have been processed. Consumed by
    /// [`TmuxController::take_initial_state`] (one-shot). Buffered
    /// `oneshot` for the same T2→T3 race-avoidance reason as
    /// `first_pane_rx`.
    initial_state_rx: tokio::sync::Mutex<Option<oneshot::Receiver<()>>>,
    /// Sender half of `initial_state_rx`.
    pub(crate) initial_state_tx: std::sync::Mutex<Option<oneshot::Sender<()>>>,
    /// Set of every `tmux_window_id` this controller has observed
    /// (bootstrap, user-driven, and — in the future — external). Used by
    /// `kill_window` / `rename_window` to validate the caller's input
    /// and by the dispatch task's bootstrap-window detection. The
    /// `xsterm_window_id` value used to live here too; after dropping
    /// the parallel allocator the set is sufficient — the frontend
    /// uses `tmux_window_id` directly as the `Window.id`, and the
    /// bridge payloads no longer carry a separate `xsterm_window_id`.
    pub(crate) window_bindings: std::sync::Mutex<HashSet<String>>,
    /// tmux session name for `tmux -CC attach-session` (set by
    /// `spawn_attach`; `None` for `spawn_create`). Wrapped in a `Mutex`
    /// because `spawn_attach` writes it via the returned `Arc` after
    /// `spawn_with_args` returns. Used by the `attachedTmuxServers`
    /// persistence so we can re-attach on restart.
    session_name: std::sync::Mutex<Option<String>>,
    /// Whether this controller was created via `spawn_attach` (true) or
    /// `spawn_create` / `spawn_with_args` (false). The dispatch task
    /// uses this to decide whether to emit `tmux-pane-added` events
    /// for *every* pane the server reports (Attach: server already has
    /// windows/panes, we want xsterm to mirror them) or only the
    /// bootstrap pane (Create: only one window exists, the one we just
    /// asked the server to create).
    pub(crate) spawn_mode: SpawnMode,
    /// tokio mutex serialising concurrent `capture_pane` callers
    /// so two requests never overlap their `%begin..%end` block.
    capture_lock: tokio::sync::Mutex<()>,

    /// Override hook used by tests to shorten [`TMUX_REPLY_TIMEOUT`]. In
    /// production this stays at [`TMUX_REPLY_TIMEOUT`]; the
    /// `split_pane_times_out_when_no_response` test substitutes a smaller
    /// value so the test does not have to wait 5 s for the timeout.
    split_pane_timeout: Duration,
    /// Two-mode waiter registry:
    /// - `command_waiters` for `%begin..%end` replies (`capture_pane`)
    /// - `event_waiters` for `%window-pane-changed` / `%window-add`
    ///   notifications (`split_pane` / `new_window`)
    ///
    /// The dispatch task resolves both via `registry.take(id)` /
    /// `take_event_waiter_for_*` and resolves with the typed triple.
    pub(crate) registry: CommandRegistry,
    /// In-flight `%begin..%end` body buffer for the active command,
    /// owned by `subscriber::RouterState`. Returns a [`RouterAction`]
    /// telling the dispatcher which event to emit or which waiter to
    /// resolve.
    pub(crate) router_state: std::sync::Mutex<RouterState>,
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
///
/// `session_name` is read from the controller's own `session_name`
/// slot (set by `spawn_create` / `spawn_attach`). Send `-t <session>`
/// instead of `-a` so we enumerate windows for THIS controller's
/// session only.
fn schedule_initial_state_sync(
    controller: Arc<TmuxController>,
    stdin_tx: mpsc::UnboundedSender<String>,
) {
    thread::spawn(move || {
        thread::sleep(INITIAL_STATE_SYNC_DELAY);
        // Read the session name from the controller (single source of
        // truth). Empty string is a defensive fallback — in production
        // `spawn_create` already rejects configs without a session
        // name; if we somehow got here without one (e.g. test fixture
        // using `spawn_with_args`), we send `-a` as before rather than
        // crashing the spawn path.
        let session_name = controller.session_name().unwrap_or_default();
        let command = tmux_cmd::list_windows(&session_name);
        if stdin_tx.send(command).is_err() {
            tracing::debug!(
                "schedule_initial_state_sync: controller already closed stdin_tx; skipping"
            );
        }
    });
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
    pub fn spawn_create(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, TmuxError> {
        // Required: without a name tmux auto-generates a numeric id that
        // `list-windows -t <name>` cannot address.
        let session_name = config
            .tmux_session_name
            .as_deref()
            .ok_or_else(|| TmuxError::Ipc {
                context: "tmux -CC create requires `tmuxSessionName` in TmuxCcConfig",
                source: None,
            })?;

        if let Some(ssh_cfg) = config.ssh.as_ref() {
            // SSH path: build the remote `tmux -CC ...` argv, run
            // it through an SSH exec channel, and wrap the resulting
            // `SshConnectResult` in a `SshTmuxBackend`.
            //
            // `connect_exec` returns `Result<_, String>` (russh has
            // no `Error: Send + Sync + 'static` blanket, so the
            // SshBackend trait is stuck with `String` for now).
            // We map the error to `TmuxError::Ipc` so the caller
            // can still pattern-match on the variant.
            let argv_strings = build_tmux_argv(config)?;
            let command = format!(
                "tmux {}",
                argv_strings
                    .iter()
                    .map(|s| shell_quote(s))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            let result = ssh_backend
                .connect_exec(ssh_cfg, &command)
                .map_err(|msg| spawn_err("ssh_backend.connect_exec", msg))?;
            let backend: Box<dyn TmuxBackend> =
                Box::new(SshTmuxBackend::from_connect_result(result));
            Self::spawn_with_backend(
                backend,
                app_backend,
                controller_id,
                SpawnMode::Create,
                Arc::clone(&session_id_allocator),
                Some(session_name),
            )
        } else {
            let argv_strings = build_tmux_argv(config)?;
            let argv_refs: Vec<&str> = argv_strings.iter().map(String::as_str).collect();
            let backend: Box<dyn TmuxBackend> =
                Box::new(build_local_tmux_backend(&argv_refs)?);
            Self::spawn_with_backend(
                backend,
                app_backend,
                controller_id,
                SpawnMode::Create,
                Arc::clone(&session_id_allocator),
                Some(session_name),
            )
        }
    }

    /// Lower-level constructor — spawns tmux with `argv[1..]` already
    /// built. `argv[0]` is always `"tmux"` and is added internally.
    ///
    /// takes a `tokio::process::Child` instead of building one
    /// internally; the SSH path goes through [`spawn_create`] instead.
    /// Kept for backward compatibility with the existing test suite.
    #[allow(dead_code)] // exercised only by the unit-test fixture suite
    pub fn spawn_with_args(
        args: &[&str],
        app_backend: Arc<dyn AppBackend>,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, TmuxError> {
        let backend: Box<dyn TmuxBackend> = Box::new(build_local_tmux_backend(args)?);
        Self::spawn_with_backend(
            backend,
            app_backend,
            controller_id,
            SpawnMode::Create,
            Arc::clone(&session_id_allocator),
            None,
        )
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
        mode: SpawnMode,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
        session_name: Option<&str>,
    ) -> Result<Arc<Self>, TmuxError> {
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
        let (initial_state_tx_init, initial_state_rx_init) = oneshot::channel::<()>();

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
            session_id_allocator,
            first_pane_tx: std::sync::Mutex::new(Some(pane_tx_init)),
            first_pane_rx: tokio::sync::Mutex::new(Some(pane_rx_init)),
            initial_windows: std::sync::Mutex::new(None),
            initial_panes: std::sync::Mutex::new(None),
            initial_state_rx: tokio::sync::Mutex::new(Some(initial_state_rx_init)),
            initial_state_tx: std::sync::Mutex::new(Some(initial_state_tx_init)),
            window_bindings: std::sync::Mutex::new(HashSet::new()),
            // initialised to None; `spawn_attach` rewrites this
            // after construction via the returned Arc.
            session_name: std::sync::Mutex::new(None),
            capture_lock: tokio::sync::Mutex::new(()),
            split_pane_timeout: TMUX_REPLY_TIMEOUT,
            spawn_mode: mode,
            registry: CommandRegistry::new(),
            router_state: std::sync::Mutex::new(RouterState::default()),
        });

        spawn_dispatch_task(
            dispatch_rx,
            controller.clone(),
            TmuxBridge::new(Arc::clone(&controller.app_backend), controller.clone()),
        );

        // Bug 015 (legacy) used to enqueue an unconditional `new-window` after
        // `tmux -CC new-session` because the bootstrap window does NOT
        // emit `%window-add` + `%window-pane-changed` synchronously —
        // dispatch needed that extra window to wake `await_first_pane`.
        //
        // **Removed by ADR 0009 / Bug 0009 fix:** the bootstrap pane is
        // now associated with its xsterm window id via
        // `TmuxController::record_pane_window` (which inserts into
        // BOTH `pane_window_bindings` AND `window_bindings`), so
        // `SessionManager::create_tmux` can populate the bootstrap
        // `SessionInfo` with the correct `xsterm_window_id` without
        // relying on the dispatch task waking up. Sending another
        // `new-window` here would create one empty window per Create
        // call — visible on the server as `tmux list-windows` showing
        // `+1` after every Create Tmux Session (Bug 0009 second-order).
        //
        // The `else` (Attach) branch has always been correct: the
        // server already has N windows, we just read them.
        if mode == SpawnMode::Create {
            tracing::info!(
                "tmux controller {}: Create mode — relying on Bug 0009 fix \
                 (record_pane_window inserts window_bindings synchronously) \
                 and NOT enqueuing a stray new-window",
                controller_id
            );
        } else {
            tracing::info!(
                "tmux controller {}: attach mode — skipping new-window (server already has panes)",
                controller_id
            );
        }

        // Bug 017: instead of racing `list-panes` with `new-window`, we
        // schedule a delayed `list-windows` query that the dispatch
        // task's `WindowList` handler responds to by issuing a
        // follow-up `list-panes ""` and registering the first pane
        // for `await_first_pane`. The race-free chain is:
        //   new-window → %window-add → list-windows → %WindowList →
        //   list-panes → %PaneList → register_first_pane.
        //
        // In `SpawnMode::Attach` we *skipped* `new-window` above, so the
        // server's existing windows drive the dispatch loop instead.
        // We still need a list-panes -a to know the active pane for
        // `await_first_pane`; list-windows is unused because there is
        // no fresh `%window-add` to chain against.
        if mode == SpawnMode::Create {
            schedule_initial_state_sync(controller.clone(), controller.stdin_tx.clone());
        } else {
            // Both required: list-windows installs bootstrap Windows, list-panes
            // installs bootstrap pane bindings. Detached thread avoids
            // blocking the spawn path on a sync stdin send.
            let stdin_tx = controller.stdin_tx.clone();
            let controller_for_attach = controller.clone();
            std::thread::spawn(move || {
                let session_name = controller_for_attach.session_name().unwrap_or_default();
                let cmds = [
                    tmux_cmd::list_windows(&session_name),
                    tmux_cmd::list_panes_with_format("", tmux_cmd::DEFAULT_PANE_LIST_FORMAT),
                ];
                for cmd in cmds {
                    if stdin_tx.send(cmd).is_err() {
                        tracing::debug!(
                            "tmux controller attach: controller already closed stdin_tx; skipping"
                        );
                        break;
                    }
                }
            });
        }
        tracing::info!(
            "tmux controller {}: spawn complete (mode={:?}); reader/writer/dispatch/monitor tasks running",
            controller_id, mode
        );

        if let Some(name) = session_name {
            if let Some(mut slot) = lock_or_warn(&controller.session_name, "session_name", controller_id) {
                *slot = Some(name.to_string());
            }
        }

        Ok(controller)
    }

    /// spawn a `tmux -CC attach-session` child process and wire the
    /// internal dispatch task.
    ///
    /// Unlike `spawn_create` (which always opens a *new* detached session),
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
    /// `Err` containing the OS error description (same as `spawn_create`).
    /// Wave 4 §D4 attach constructor. Currently has zero callers — kept
    /// around in case the SSH attach path is reactivated. Wire up from
    /// `SessionManager::attach_tmux` when the time comes.
    #[allow(dead_code)]
    pub fn spawn_attach(
        config: &TmuxCcConfig,
        app_backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, TmuxError> {
        let session_name = config.tmux_session_name.as_deref().ok_or_else(|| {
            "tmux -CC attach requires `tmuxSessionName` in TmuxCcConfig".to_string()
        })?;

        let backend: Box<dyn TmuxBackend> = if let Some(ssh_cfg) = config.ssh.as_ref() {
            let socket = tmux_socket_name(config);
            let command = format!(
                "tmux -CC -L {} attach-session -t {}",
                shell_quote(socket),
                shell_quote(session_name)
            );
            let result = ssh_backend.connect_exec(ssh_cfg, &command)?;
            Box::new(SshTmuxBackend::from_connect_result(result))
        } else {
            let socket = tmux_socket_name(config);
            let argv: Vec<String> = vec![
                "-CC".to_string(),
                "-L".to_string(),
                socket.to_string(),
                "attach-session".to_string(),
                "-t".to_string(),
                session_name.to_string(),
            ];
            let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
            Box::new(build_local_tmux_backend(&argv_refs)?)
        };

        Self::spawn_with_backend(
            backend,
            app_backend,
            controller_id,
            SpawnMode::Attach,
            Arc::clone(&session_id_allocator),
            Some(session_name),
        )
    }

    /// Write raw bytes (typically user keystrokes) to the pane.
    ///
    /// Internally builds the `send-keys -t %<pane> <escaped-data>` command
    /// via [`tmux_cmd::send_keys`] and pushes it onto the writer task's
    /// FIFO queue. Returns `Err` if the writer task has already exited
    /// (e.g. after [`TmuxController::close`]) or if the pane id is not
    /// registered with this controller.
    pub fn send_keys(&self, tmux_pane_id: &str, keys: &[u8]) -> Result<(), TmuxError> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::send_keys(tmux_pane_id, keys);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// Resize a pane to `cols` × `rows` characters.
    ///
    /// Builds `resize-pane -t %<pane> -x <cols> -y <rows>` via
    /// [`tmux_cmd::resize_pane`] and queues it for dispatch. Same error
    /// semantics as [`TmuxController::send_keys`].
    pub fn resize_pane(&self, tmux_pane_id: &str, rows: u16, cols: u16) -> Result<(), TmuxError> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::resize_pane(tmux_pane_id, cols, rows);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
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
    /// - `Err("capture-pane timed out")` after [`TMUX_REPLY_TIMEOUT`].
    /// - `Err("response channel closed")` if the dispatch task exited
    ///   before the reply arrived.
    pub async fn capture_pane(&self, tmux_pane_id: &str, lines: i32) -> CaptureResult {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }

        // Serialise concurrent capture_pane callers — only one capture
        // can be in flight at a time.
        let _guard = self.capture_lock.lock().await;

        // Register a `BeginEnd` waiter; the dispatch task resolves it via
        // `registry.take(id)` on the matching `CommandEnd` / `CommandError`.
        let (tx, rx) = oneshot::channel::<ResponseOutcome>();
        let reg = self.registry.register(
            CommandKind::CapturePane {
                pane_id: tmux_pane_id.to_string(),
                lines,
            },
            tmux_cmd::capture_pane(tmux_pane_id, lines),
            Some(ResponseWaiter::BeginEnd(tx)),
        );

        if self
            .stdin_tx
            .send(reg.tagged.wire)
            .map_err(|_| TmuxError::AlreadyClosed)
            .is_err()
        {
            // Drain the just-registered waiter so a future `CommandEnd`
            // for this id does not strand an orphan sender in the
            // registry (the dispatch task will pick it up and resolve
            // it; the receiver is dropped here).
            self.registry.take(reg.tagged.id);
            return Err(TmuxError::AlreadyClosed);
        }

        match tokio::time::timeout(TMUX_REPLY_TIMEOUT, rx).await {
            Ok(Ok(ResponseOutcome::Ok { body_lines })) => Ok(body_lines.join("\n")),
            Ok(Ok(ResponseOutcome::Err { message })) => Err(TmuxError::Internal(format!(
                "tmux controller {}: capture-pane failed (id={:?}): {message}",
                self.controller_id, reg.tagged.id
            ))),
            Ok(Err(_canceled)) => Err(TmuxError::Internal(format!(
                "tmux controller {}: capture response channel closed",
                self.controller_id
            ))),
            Err(_elapsed) => {
                // Drop our half — the dispatch task's later CommandEnd
                // will see a closed channel and silently discard (we
                // already gave up). The registry still holds the
                // registered waiter; `close()` will drain it.
                Err(TmuxError::Internal(format!(
                    "tmux controller {}: capture timed out after {:?}",
                    self.controller_id, TMUX_REPLY_TIMEOUT
                )))
            }
        }
    }

    /// tmux session name this controller is attached to.
    ///
    /// `Some(name)` for controllers built with [`TmuxController::spawn_attach`]
    /// (and only those), `None` for `spawn_create` / unknown sessions.
    /// Used by `SessionManager::list_attached_tmux_servers` to populate
    /// the persisted `attachedTmuxServers` list.
    pub fn session_name(&self) -> Option<String> {
        self.session_name.lock().ok().and_then(|g| g.clone())
    }

    /// Test-only: inject a `session_name` from outside `spawn_attach`.
    /// `#[cfg(test)]` so it never links into production binaries.
    #[cfg(test)]
    pub(crate) fn set_session_name_for_tests(&self, name: impl Into<String>) {
        if let Some(mut slot) = lock_or_warn(&self.session_name, "session_name", self.controller_id) {
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
    pub fn close(&self) -> Result<(), TmuxError> {
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
        let (cmd_drained, event_drained) = self.registry.drain_all();
        if cmd_drained + event_drained > 0 {
            tracing::debug!(
                "tmux controller {}: registry drained {} command waiter(s) and {} event waiter(s) on close",
                self.controller_id,
                cmd_drained,
                event_drained
            );
        }
        tracing::debug!(
            "tmux controller {}: close complete (tasks unwind async)",
            self.controller_id
        );
        Ok(())
    }

    /// Block until the first pane is registered, returning its
    /// `(xsterm_session_id, tmux_pane_id)` pair.
    ///
    /// Times out after [`TMUX_REPLY_TIMEOUT`] and returns
    /// `Err("timed out waiting for first pane")`. Only the bootstrap caller
    /// should `await` it; subsequent calls return immediately with the
    /// cached first-pane result if available, otherwise the same timeout
    /// error.
    pub async fn await_first_pane(&self) -> Result<(u32, String), TmuxError> {
        tracing::info!(
            "tmux controller {}: await_first_pane called (will block up to {:?}s waiting for record_first_pane from dispatcher)",
            self.controller_id,
            TMUX_REPLY_TIMEOUT.as_secs()
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
            TmuxError::Internal(format!(
                "tmux controller {}: first pane already awaited",
                self.controller_id
            ))
        })?;
        // Await with the standard 5s timeout. The receiver buffers the
        // dispatcher's `.send()`, so this doesn't lose notifications the
        // way `Notify` did (Notify's `notified()` future is only
        // registered as a waiter on first poll, leaving a T2→T3 race).
        match tokio::time::timeout(TMUX_REPLY_TIMEOUT, rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err(TmuxError::AlreadyClosed),
            Err(_) => Err(TmuxError::Timeout {
                budget: TMUX_REPLY_TIMEOUT,
                context: "await_first_pane",
            }),
        }
    }

    /// Block until the dispatch task reports that the initial
    /// `list-windows` AND `list-panes` responses have been processed
    /// (and their payloads stashed in `initial_windows` /
    /// `initial_panes`). Consumed once per controller.
    ///
    /// Used by `SessionManager::create_tmux` / `attach_tmux` to wait for
    /// the full initial state before assembling
    /// [`TmuxSessionInit`](crate::models::session::TmuxSessionInit) and
    /// returning it to the frontend in a single round-trip.
    pub async fn take_initial_state(
        &self,
    ) -> Result<
        (
            Vec<crate::models::session::TmuxWindowInit>,
            Vec<crate::models::session::TmuxPaneInit>,
        ),
        TmuxError,
    > {
        let rx = {
            let mut guard = self.initial_state_rx.lock().await;
            guard.take()
        };
        let rx = rx.ok_or_else(|| {
            TmuxError::Internal(format!(
                "tmux controller {}: initial state already taken",
                self.controller_id
            ))
        })?;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(10), rx).await?;
        let windows = self
            .initial_windows
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .unwrap_or_default();
        let panes = self
            .initial_panes
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .unwrap_or_default();
        Ok((windows, panes))
    }

    /// Stash the parsed `list-windows` body so
    /// [`TmuxController::take_initial_state`] can return it. Called by
    /// the dispatch task's `emit_window_list` path.
    pub(crate) fn stash_initial_windows(
        &self,
        windows: Vec<crate::models::session::TmuxWindowInit>,
    ) {
        if let Some(mut slot) = lock_or_warn(&self.initial_windows, "initial_windows", self.controller_id) {
            *slot = Some(windows);
        }
    }

    /// Stash the parsed `list-panes` body so
    /// [`TmuxController::take_initial_state`] can return it. Called by
    /// the dispatch task's `emit_pane_list` path.
    pub(crate) fn stash_initial_panes(&self, panes: Vec<crate::models::session::TmuxPaneInit>) {
        if let Some(mut slot) = lock_or_warn(&self.initial_panes, "initial_panes", self.controller_id) {
            *slot = Some(panes);
        }
    }

    /// Signal that **both** `list-windows` AND `list-panes` have been
    /// processed and stashed. Called by the dispatch task after the
    /// second of the two has its body parsed. Idempotent (subsequent
    /// calls are no-ops because the receiver was already consumed).
    pub(crate) fn signal_initial_state_ready(&self) {
        if let Some(mut slot) = lock_or_warn(&self.initial_state_tx, "initial_state_tx", self.controller_id) {
            if let Some(tx) = slot.take() {
                let _ = tx.send(());
            }
        }
    }

    /// Snapshot of every pane currently registered with this controller.
    /// Returns `(tmux_pane_id, session_id)` pairs. Used by the dispatch
    /// task to look up the Session.id for `session-output` events.
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
    pub fn unbind_pane(&self, tmux_pane_id: &str) -> Result<(), TmuxError> {
        let mut map = self.pane_bindings.lock().map_err_string()?;
        if map.remove(tmux_pane_id).is_none() {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not bound to controller {}",
                tmux_pane_id, self.controller_id
            )));
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
    /// 1. Register an [`EventWaiter`] (kind: `SplitResult`) on the
    ///    `CommandRegistry` so the dispatch task can route the matching
    ///    `%window-pane-changed` reply back to this future. The waiter
    ///    is registered **before** the `split-window` command is
    ///    written to stdin, eliminating the race where tmux replies
    ///    faster than the caller can register.
    /// 2. Write `split-window <flag> -t %<parent>` (built inline) to
    ///    stdin. The writer task drains the FIFO in a single background
    ///    thread, preserving tmux's expected command ordering.
    /// 3. `await` the oneshot with [`TMUX_REPLY_TIMEOUT`].
    ///
    /// Errors:
    /// - `Err("parent pane not bound")` if `parent_tmux_pane_id` is not
    ///   registered (the parent pane must already exist on this
    ///   controller).
    /// - `Err("timed out")` after [`TMUX_REPLY_TIMEOUT`] — the dispatch
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
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                parent_tmux_pane_id, self.controller_id
            )));
        }

        // P8 W3b: tmux does not echo `%begin..%end` for `split-window`;
        // it answers with `%window-pane-changed`. Register an
        // event-correlated waiter on the registry; the dispatch task's
        // `%window-pane-changed` layer 2 pops it via
        // `take_event_waiter_for_split`.
        let (tx, rx) = oneshot::channel::<SplitResult>();
        self.registry.register_event_waiter(EventWaiter {
            kind: EventWaiterKind::SplitResult,
            sender: EventWaiterSender::Split(tx),
            tmux_window_id: None,
        });

        let cmd = format!(
            "split-window {} -t {}\n",
            direction.flag(),
            parent_tmux_pane_id
        );
        send_with_rollback(&self.stdin_tx, &self.registry, cmd)?;

        await_reply(
            rx,
            self.split_pane_timeout,
            self.controller_id,
            "split",
        )
        .await
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
    pub fn kill_pane(&self, tmux_pane_id: &str) -> Result<(), TmuxError> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::kill_pane(tmux_pane_id);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// open a new tmux window and return its
    /// `(xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id)`
    /// quadruple once tmux confirms via `%window-pane-changed`.
    ///
    /// Flow:
    /// 1. Register an [`EventWaiter`] (kind: `NewWindowResult`) on the
    ///    `CommandRegistry` so the dispatch task can route the matching
    ///    `%window-add` / `%window-pane-changed` reply pair back to this
    ///    future. The waiter is registered **before** the `new-window`
    ///    command is written to stdin, eliminating the race where tmux
    ///    replies faster than the caller can register.
    /// 2. Write `new-window [-n <name>]` (built via
    ///    [`tmux_cmd::new_window_in_current`]) to stdin. No `-t <session>`
    ///    flag because the `tmux -CC` controller is attached to its own
    ///    tmux session and `new-window` defaults to the current session.
    /// 3. `await` the oneshot with [`TMUX_REPLY_TIMEOUT`].
    ///
    /// Errors:
    /// - `Err("new-window timed out")` after [`TMUX_REPLY_TIMEOUT`] — the
    ///   dispatch task did not see a matching `%window-pane-changed` reply.
    /// - `Err("new-window response channel closed")` if the controller's
    ///   dispatch task already exited (the child died before we got the
    ///   reply).
    pub async fn new_window(&self, window_name: Option<&str>) -> NewWindowResult {
        // P8 W3b: tmux answers `new-window` with `%window-add` followed
        // by `%window-pane-changed` for the new window's first pane —
        // NOT a `%begin..%end` block. Register an event-correlated
        // waiter on the registry; the dispatch task's `%window-add`
        // case (a) re-keys it from `tmux_window_id: None` to
        // `Some(<window_id>)`, then `%window-pane-changed` layer 3
        // pops it via `take_event_waiter_for_window`.
        let (tx, rx) = oneshot::channel::<NewWindowResult>();
        self.registry.register_event_waiter(EventWaiter {
            kind: EventWaiterKind::NewWindowResult,
            sender: EventWaiterSender::NewWindow(tx),
            tmux_window_id: None,
        });

        let cmd = tmux_cmd::new_window_in_current(window_name);
        send_with_rollback(&self.stdin_tx, &self.registry, cmd)?;

        await_reply(rx, TMUX_REPLY_TIMEOUT, self.controller_id, "new-window").await
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
    pub fn kill_window(&self, tmux_window_id: &str) -> Result<(), TmuxError> {
        if !self
            .window_bindings
            .lock()
            .map_err_string()?
            .contains(tmux_window_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux window '{}' is not registered with controller {}",
                tmux_window_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::kill_window(tmux_window_id);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
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
    pub fn rename_window(&self, tmux_window_id: &str, name: &str) -> Result<(), TmuxError> {
        if !self
            .window_bindings
            .lock()
            .map_err_string()?
            .contains(tmux_window_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux window '{}' is not registered with controller {}",
                tmux_window_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::rename_window(tmux_window_id, name);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// send `detach-client -s "<session_name>"` to tmux.
    ///
    /// tmux treats this as a graceful disconnect: the control client
    /// child process exits cleanly (`%exit`), the tmux server + its
    /// session + windows stay alive, and the monitor task observes the
    /// backend exit which the dispatch task propagates to the frontend
    /// as `tmux-controller-exit`.
    ///
    /// Returns `Err(SessionManagerNotFound)` if the controller never
    /// recorded a session name (the `session_name` slot is `None`,
    /// typically because spawn_attach was called without a
    /// `tmuxSessionName` in the config). Returns `Err(AlreadyClosed)`
    /// if the writer channel is gone (the controller already exited).
    /// ADR 0009 §2.9.
    pub fn detach_client(&self) -> Result<(), TmuxError> {
        let name = self.session_name().ok_or_else(|| {
            TmuxError::Internal(format!(
                "tmux controller {} has no recorded session_name — cannot detach",
                self.controller_id
            ))
        })?;
        let cmd = tmux_cmd::detach_client(&name);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// send `kill-server` to tmux.
    ///
    /// tmux shuts down the entire server (every session, every window,
    /// every pane). The control client child process exits because the
    /// server it was attached to is gone; the monitor task observes the
    /// backend exit which the dispatch task propagates to the frontend
    /// as `tmux-controller-exit`.
    ///
    /// Returns `Err(AlreadyClosed)` if the writer channel is gone.
    /// ADR 0009 §2.9.
    pub fn kill_server(&self) -> Result<(), TmuxError> {
        let cmd = tmux_cmd::kill_server();
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
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

    /// snapshot of every `tmux_window_id` this controller has observed.
    pub fn window_bindings(&self) -> Vec<String> {
        self.window_bindings
            .lock()
            .map(|m| m.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Override the [`TMUX_REPLY_TIMEOUT`] used by
    /// [`TmuxController::split_pane`]. Test-only — production code paths
    /// use the default. Made `pub(crate)` so unit tests in the same crate
    /// can swap in a shorter timeout.
    #[cfg(test)]
    pub(crate) fn set_split_pane_timeout_for_tests(&mut self, timeout: Duration) {
        self.split_pane_timeout = timeout;
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
    /// [`TmuxController::spawn_create`] / [`TmuxController::spawn_with_args`].
    #[cfg(test)]
    pub(crate) fn new_for_tests(
        controller_id: u32,
        stdin_tx: mpsc::UnboundedSender<String>,
        app_backend: Arc<dyn AppBackend>,
    ) -> Arc<Self> {
        let (first_pane_tx, first_pane_rx) = oneshot::channel::<(u32, String)>();
        // The test fixture doesn't talk to a real SessionManager —
        // give the controller its own private SessionIdSource so the
        // dispatch task can mint Session.ids for newly-registered
        // panes (split, list-panes). Tests that exercise the
        // bootstrap path observe the first allocation from this
        // source.
        let id_source = Arc::new(crate::models::session::SessionIdSource::new(
            controller_id * 1_000_000 + 1,
        ));
        Arc::new(Self {
            controller_id,
            backend: Arc::new(Mutex::new(None)),
            killed: Arc::new(AtomicBool::new(false)),
            stdin_tx,
            app_backend,
            pane_bindings: std::sync::Mutex::new(HashMap::new()),
            pane_window_bindings: std::sync::Mutex::new(HashMap::new()),
            session_id_allocator: crate::models::session::SessionIdSource::shared_allocator(
                &id_source,
            ),
            first_pane_tx: std::sync::Mutex::new(Some(first_pane_tx)),
            first_pane_rx: tokio::sync::Mutex::new(Some(first_pane_rx)),
            initial_windows: std::sync::Mutex::new(None),
            initial_panes: std::sync::Mutex::new(None),
            initial_state_rx: tokio::sync::Mutex::new(None),
            initial_state_tx: std::sync::Mutex::new(None),
            window_bindings: std::sync::Mutex::new(HashSet::new()),
            session_name: std::sync::Mutex::new(None),
            capture_lock: tokio::sync::Mutex::new(()),
            // 5 s mirrors the production TMUX_REPLY_TIMEOUT (kept in
            // sync by hand — the constant is private to this module).
            split_pane_timeout: Duration::from_secs(5),
            spawn_mode: SpawnMode::Create,
            registry: CommandRegistry::new(),
            router_state: std::sync::Mutex::new(RouterState::default()),
        })
    }

    /// Insert `(tmux_pane_id → session_id)` into the binding map. The
    /// caller passes the `session_id` allocated by the injected
    /// [`SessionIdSource`](crate::models::session::SessionIdSource)
    /// for the first pane). Used by the dispatch task to look up the
    /// Session.id for `session-output` events keyed by `%output pane_id`.
    ///
    /// Returns `true` on first registration, `false` if the pane id is
    /// already bound (the existing mapping is left untouched — re-registration
    /// must not overwrite the original session id).
    pub(crate) fn register_pane(&self, tmux_pane_id: String, session_id: u32) -> bool {
        let mut map = match self.pane_bindings.lock() {
            Ok(m) => m,
            Err(_) => return false,
        };
        if map.contains_key(&tmux_pane_id) {
            return false;
        }
        map.insert(tmux_pane_id, session_id);
        true
    }

    /// Drop a pane binding unconditionally (no error if it was never
    /// registered). Used by the dispatch task's bootstrap path to
    /// undo an `allocate_session_id` + `register_pane` that was made
    /// for a placeholder session id; the real id comes from the
    /// [`TmuxController::record_first_pane`].
    pub(crate) fn unregister_pane(&self, tmux_pane_id: &str) {
        if let Some(mut map) = lock_or_warn(&self.pane_bindings, "pane_bindings", self.controller_id) {
            map.remove(tmux_pane_id);
        }
    }

    /// Record `(session_id, pane_id)` as the first pane and wake one
    /// waiter of [`TmuxController::await_first_pane`]. The caller
    /// (the dispatch task's bootstrap path) passes the `session_id`
    /// it allocated via [`TmuxController::allocate_session_id`]
    /// so the same id can land in [`TmuxController::pane_bindings`]
    /// and the `tmux-pane-added` payload. Idempotent: subsequent calls
    /// are no-ops (the `first_pane_tx` slot is one-shot).
    pub(crate) fn record_first_pane(&self, session_id: u32, pane_id: String) {
        tracing::info!(
            "tmux controller {}: record_first_pane(session_id={}, pane_id={:?}) called by dispatcher",
            self.controller_id,
            session_id,
            pane_id
        );
        if let Some(mut slot) = lock_or_warn(&self.first_pane_tx, "first_pane_tx", self.controller_id) {
            if let Some(tx) = slot.take() {
                let _ = tx.send((session_id, pane_id));
            } else {
                tracing::warn!(
                    "tmux controller {}: first_pane_tx already consumed (await_first_pane may have already returned)",
                    self.controller_id
                );
            }
        }
    }

    /// Record that `pane_id` belongs to `tmux_window_id`. Called by
    /// the dispatch task alongside [`TmuxController::register_pane`].
    /// Used by [`TmuxController::tmux_window_id_for_pane`] so
    /// [`SessionManager::create_tmux`](crate::services::session_manager::SessionManager::create_tmux)
    /// can populate the bootstrap pane's `tmux_window_id` on its
    /// `SessionInfo`.
    ///
    /// **Also** populates `window_bindings` (the `HashSet<String>` of
    /// `tmux_window_id`s this controller has observed) so
    /// `kill_window` / `rename_window` can validate the caller's input
    /// and the bootstrap-detection predicate in the dispatch task can
    /// tell whether a `%window-add` is the very first one.
    pub(crate) fn record_pane_window(&self, pane_id: String, tmux_window_id: String) {
        if let Some(mut map) = lock_or_warn(&self.pane_window_bindings, "pane_window_bindings", self.controller_id) {
            map.insert(pane_id, tmux_window_id.clone());
        }
        if let Some(mut map) = lock_or_warn(&self.window_bindings, "window_bindings", self.controller_id) {
            map.insert(tmux_window_id);
        }
    }

    /// Allocate a fresh Session.id via the controller's injected
    /// [`SessionIdSource`](crate::models::session::SessionIdSource)
    /// closure. The dispatch task uses this for every pane registered
    /// after the bootstrap (split, list-panes after bootstrap, …).
    pub(crate) fn allocate_session_id(&self) -> u32 {
        (self.session_id_allocator)()
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
fn build_tmux_argv(config: &TmuxCcConfig) -> Result<Vec<String>, TmuxError> {
    let mut argv: Vec<String> = Vec::with_capacity(10);
    argv.push("-CC".to_string());

    let socket = tmux_socket_name(config);
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
/// Format a `tmux not found` message that points the user at the
/// usual installation paths. Returns a `TmuxError::Spawn` so the
/// `?` chain picks up the variant without an extra `.map_err`.
fn tmux_spawn_err(e: std::io::Error, argv: &[&str]) -> TmuxError {
    if e.kind() == std::io::ErrorKind::NotFound {
        // We deliberately format the long installation hint as a
        // human-readable String and stash it in the `Internal`
        // variant so the caller can't accidentally surface it as a
        // generic "spawn failed" — it only fires when tmux is
        // actually missing, and the user genuinely needs the hint.
        let msg = format!(
            "tmux executable not found in PATH. Please install tmux (>= 3.0) and \
             ensure `tmux -V` works from your shell. On Windows, common sources are \
             WSL (`wsl --install`, then install tmux inside the distro), MSYS2 \
             (`pacman -S tmux`), or git-bash (which bundles tmux on newer \
             releases). \
             (Original error: {e}; argv: tmux {})",
            argv.join(" ")
        );
        TmuxError::Internal(msg)
    } else {
        // Any other spawn failure: keep the chain simple via the
        // shared helper.
        spawn_err("cmd.spawn", e)
    }
}

/// Lock a `std::sync::Mutex` and log a `tracing::warn!` if the lock is
/// poisoned (a previous holder panicked) instead of silently skipping
/// the update. Returns `None` so callers can no-op the cache write.
///
/// Used by stash helpers and binding updates where the worst case of a
/// missed write is a stale cache — not data corruption — but a panic
/// in another thread is still a bug we want to surface in the rolling
/// log instead of disappearing.
fn lock_or_warn<'a, T>(
    m: &'a std::sync::Mutex<T>,
    field: &'static str,
    controller_id: u32,
) -> Option<std::sync::MutexGuard<'a, T>> {
    match m.lock() {
        Ok(g) => Some(g),
        Err(_) => {
            tracing::warn!(
                "tmux controller {}: mutex `{}` is poisoned (a previous holder panicked); skipping update",
                controller_id,
                field
            );
            None
        }
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

/// Spawn a local `tmux` child process with stdin/stdout/stderr piped
/// and wrap it in a [`LocalTmuxBackend`]. Used by every constructor
/// that takes the local path (vs the SSH exec path).
fn build_local_tmux_backend(argv: &[&str]) -> Result<LocalTmuxBackend, TmuxError> {
    let mut cmd = Command::new("tmux");
    cmd.args(argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn().map_err(|e| tmux_spawn_err(e, argv))?;
    Ok(LocalTmuxBackend::new(child))
}

/// Await a reply on a oneshot receiver with a timeout, mapping the
/// three outcomes (reply received / channel closed / elapsed) into a
/// uniform `TmuxError`.
async fn await_reply<T>(
    rx: oneshot::Receiver<Result<T, TmuxError>>,
    timeout: Duration,
    controller_id: u32,
    op: &'static str,
) -> Result<T, TmuxError> {
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_canceled)) => Err(TmuxError::Internal(format!(
            "tmux controller {}: {op} response channel closed",
            controller_id
        ))),
        Err(_elapsed) => Err(TmuxError::Internal(format!(
            "tmux controller {}: {op} timed out after {:?}",
            controller_id, timeout
        ))),
    }
}

/// Send a command to the writer task and roll back the just-registered
/// waiter on failure. There is exactly one in-flight waiter per
/// request, so the crude `drain_event_waiters` is safe.
fn send_with_rollback(
    stdin_tx: &mpsc::UnboundedSender<String>,
    registry: &CommandRegistry,
    cmd: String,
) -> Result<(), TmuxError> {
    if stdin_tx.send(cmd).is_err() {
        registry.drain_event_waiters();
        Err(TmuxError::AlreadyClosed)
    } else {
        Ok(())
    }
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
                    tracing::debug!(
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
                    tracing::debug!(
                        "tmux reader: stripped line (DCS {}): {:?}",
                        if was_dcs { "yes" } else { "no" },
                        stripped
                    );
                    if let Some(event) = parser.feed(stripped) {
                        tracing::debug!("tmux reader: parser emitted event: {:?}", event);
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
        tracing::debug!(
            "tmux controller monitor: backend.wait() returned reason={:?}, killed={}",
            reason,
            killed.load(Ordering::SeqCst)
        );
        if !killed.load(Ordering::SeqCst) {
            let _ = dispatch_tx.send(ProtocolEvent::Exit { reason });
        }
    });
}
