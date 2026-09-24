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
//! The sub-modules `id_map` and `subscriber` host the command/event
//! waiter registry and event-router state respectively; this file hosts
//! the [`TmuxController`] struct, its constructors, and its public API.
//!
//! [`TmuxBackend`]: crate::infrastructure::tmux::backend::TmuxBackend
//! [`AppBackend`]: crate::infrastructure::app_backend::AppBackend
//! [`ProtocolParser`]: crate::services::tmux::protocol::parser::ProtocolParser
//! [`ProtocolEvent`]: crate::services::tmux::protocol::events::ProtocolEvent

pub(super) mod commands;
pub(crate) mod id_map;
pub(super) mod io_tasks;
pub(super) mod registry;
pub(super) mod spawn;
pub(crate) mod subscriber;
pub(super) mod sync;

#[cfg(test)]
mod tests;

// Re-export so existing `controller::TmuxController` callers (and the
// `controller::tests` module, which uses `use super::*`) keep working.
pub use self::id_map::CommandRegistry;
#[allow(unused_imports)] // test-only
pub(crate) use self::spawn::build_tmux_argv;
pub use self::subscriber::{RouterAction, RouterState};
// Test-only re-exports — pulled in by `controller::tests`' `use super::*`.
// Lib code never references these symbols directly.
#[allow(unused_imports)]
pub(crate) use super::dispatch::spawn_dispatch_task;
#[allow(unused_imports)]
pub(crate) use super::protocol::command::{
    CommandKind, EventWaiter, EventWaiterKind, EventWaiterSender, ResponseOutcome, ResponseWaiter,
};
#[allow(unused_imports)]
pub(crate) use super::protocol::events::ProtocolEvent;
#[allow(unused_imports)]
pub(crate) use crate::models::session::{SessionIdSource, SplitDirection, TmuxCcConfig};

use super::errors::TmuxError;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

#[allow(unused_imports)] // `Mutex` is re-exported for `controller::tests`' `use super::*`
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::tmux::backend::TmuxBackend;

/// Default initial pane size in rows when `TmuxCcConfig::initial_rows` is
/// `None`. Mirrors `portable_pty::default_pty_size()` so behaviour is
/// consistent across local PTY and tmux panes.
pub(super) const DEFAULT_INITIAL_ROWS: u16 = 24;
/// Default initial pane size in columns when `TmuxCcConfig::initial_cols` is
/// `None`.
pub(super) const DEFAULT_INITIAL_COLS: u16 = 80;
/// Reply timeout for `await_first_pane` / `split_pane` / `new_window`
/// / `capture_pane`. tmux replies within milliseconds; 5 s is a
/// defensive upper bound that fails fast on a stuck child.
pub(super) const TMUX_REPLY_TIMEOUT: Duration = Duration::from_secs(5);
/// Default tmux socket name when `TmuxCcConfig::socket_name` is `None`.
pub(super) const DEFAULT_TMUX_SOCKET_NAME: &str = "default";

/// Lock a `std::sync::Mutex` and log a `tracing::warn!` if the lock is
/// poisoned (a previous holder panicked) instead of silently skipping
/// the update. Returns `None` so callers can no-op the cache write.
pub(super) fn lock_or_warn<'a, T>(
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

/// Resolve the tmux socket name, falling back to
/// [`DEFAULT_TMUX_SOCKET_NAME`] when the config leaves it `None`.

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
    pub(crate) controller_id: u32,
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
    pub(crate) backend: Arc<tokio::sync::Mutex<Option<Box<dyn TmuxBackend>>>>,
    /// Set to `true` by [`TmuxController::close`] so the monitor task
    /// knows not to emit an `Exit` event for a teardown we initiated.
    pub(crate) killed: Arc<AtomicBool>,
    /// Clone of the writer task's command sender. Held by `self` so that
    /// dropping `self` (via `close`) signals the writer task to drain and
    /// exit.
    pub(crate) stdin_tx: mpsc::UnboundedSender<String>,
    /// Sink for the dispatch task. Held inside the controller purely so the
    /// `AppBackend` clone lives for the controller's lifetime.
    pub(crate) app_backend: Arc<dyn AppBackend>,
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
    pub(crate) session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
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
    pub(crate) first_pane_rx: tokio::sync::Mutex<Option<oneshot::Receiver<(u32, String)>>>,
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
    pub(crate) initial_windows:
        std::sync::Mutex<Option<Vec<crate::models::session::TmuxWindowInit>>>,
    /// Buffered panes from the initial `list-panes` response. Same IA
    /// rationale as [`TmuxController::initial_windows`].
    pub(crate) initial_panes: std::sync::Mutex<Option<Vec<crate::models::session::TmuxPaneInit>>>,
    /// Signalled by the dispatch task when **both** `list-windows` AND
    /// `list-panes` have been processed. Consumed by
    /// [`TmuxController::take_initial_state`] (one-shot). Buffered
    /// `oneshot` for the same T2→T3 race-avoidance reason as
    /// `first_pane_rx`.
    pub(crate) initial_state_rx: tokio::sync::Mutex<Option<oneshot::Receiver<()>>>,
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
    pub(crate) session_name: std::sync::Mutex<Option<String>>,
    /// tokio mutex serialising concurrent `capture_pane` callers
    /// so two requests never overlap their `%begin..%end` block.
    pub(crate) capture_lock: tokio::sync::Mutex<()>,

    /// Override hook used by tests to shorten [`TMUX_REPLY_TIMEOUT`]. In
    /// production this stays at [`TMUX_REPLY_TIMEOUT`]; the
    /// `split_pane_times_out_when_no_response` test substitutes a smaller
    /// value so the test does not have to wait 5 s for the timeout.
    pub(crate) split_pane_timeout: Duration,
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

impl TmuxController {
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
            split_pane_timeout: TMUX_REPLY_TIMEOUT,
            registry: CommandRegistry::new(),
            router_state: std::sync::Mutex::new(RouterState::default()),
        })
    }
}
