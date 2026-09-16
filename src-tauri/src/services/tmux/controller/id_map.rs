//! Command-id → response-waiter registry.
//!
//! Replaces the five ad-hoc wait queues the old controller accumulated
//! (`pending_splits` / `pending_windows` / `pending_window_pane` /
//! `pending_capture` / `pending_bootstrap`). PR-T5 hooks this into the
//! response router so `%begin <id>` / `%end <id>` look up the registered
//! waiter; PR-T8 deletes the old queues.
//!
//! ## Why a single registry
//!
//! Five queues means five rules for "which queue owns this id". The
//! controller's old `WindowPaneChanged` 5-level fallthrough was that rule
//! set in code form (see `dispatch.rs:100`). Collapsing to one map keys
//! by the only thing tmux gives us — the command id — and removes the
//! "is this a split-result or a bootstrap?" guesswork.
//!
//! ## PR-T3 scope
//!
//! PR-T3 introduces the type + tests but does **not** wire it into the
//! controller. That wiring happens in PR-T5 alongside the response
//! router rewrite. Until then the old `pending_*` queues continue to own
//! the split / new-window / capture paths.
//!
//! ## Lifetime
//!
//! ```text
//! CommandRegistry::register(kind, wire, waiter)
//!   → CommandId(next)
//!     ├─ map.insert(next, waiter)        ─┐
//!     └─ return TaggedCommand { id=next, │  both sides share `next`,
//!                                  wire, │  no second allocation,
//!                                  waiter}│  no chance of mismatch
//!                                          ┘
//! writer task sends `wire` to tmux
//!
//! tmux responds `%begin <next> ... %end <next>`
//!   → router: registry.take(next) → resolves waiter
//! ```
//!
//! ## Thread safety
//!
//! The registry's interior mutability is `std::sync::Mutex` because both
//! the controller thread (register / take) and the dispatch task (take
//! on `%begin..%end`) touch it. The lock is held for a few map operations;
//! tmux's command rate is < 100/s even on heavy automation, so contention
//! is not measurable in practice. If it ever becomes hot, switch to
//! `DashMap<u64, ResponseWaiter>` (already in `Cargo.toml` deps).

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

use crate::services::tmux::protocol::command::{
    CommandId, CommandKind, EventWaiter, EventWaiterSender, ResponseOutcome, ResponseWaiter,
    TaggedCommand,
};

/// Outcome of `CommandRegistry::register`.
pub struct RegisteredCommand {
    pub tagged: TaggedCommand,
    /// True iff a waiter was registered for this id. Callers that need
    /// the resulting promise handle `CommandRegistry::take(tagged.id)`
    /// inside their response router (PR-T5+); the bool here exists so a
    /// caller that *didn't* request a waiter can short-circuit.
    pub waiter_registered: bool,
    /// Idempotent access path: same as `tagged.id`. Exposed so callers can
    /// register the waiter first and pass the id to the response router
    /// separately if they prefer.
    #[allow(dead_code)]
    pub id: CommandId,
}

/// One outstanding outbound command, plus its registered waiter.
///
/// Body accumulation lives in [`RouterState::in_flight`] (PR-T5)
/// rather than here — the registry stays the single source of truth
/// for waiter correlation only. PR-T8 deletes the v1
/// `pending_capture_body` / `current_command_lines` /
///
/// `current_command_id` fields from the controller and lets
/// `RouterState` own the "one in-flight command body" state. The
/// dispatch task tells the registry when a command is *registered* /
/// when its waiter is *ready*; the router state holds the body until
/// the waiter is taken.
pub struct CommandRegistry {
    next_id: AtomicU64,
    by_id: Mutex<HashMap<CommandId, ResponseWaiter>>,
    /// Origin [`CommandKind`] for each registered id. Mirrors `by_id`
    /// 1:1 (every id inserted into `by_id` also goes here) and exists
    /// so `RouterState` can classify a fire-and-forget `%end` body
    /// without sniffing the first line (P8 W3b closed Bug 017 / Bug 022:
    /// replaced `first.starts_with('@')` heuristic with a typed lookup).
    #[allow(dead_code)]
    kind_by_id: Mutex<HashMap<CommandId, CommandKind>>,
    /// Counts taken (`%end` resolved) waiters, for diagnostics. PR-T5
    /// will log this on close.
    #[allow(dead_code)]
    completed: std::sync::atomic::AtomicU64,
    /// FIFO of [`EventWaiter`]s resolved by `%window-pane-changed` /
    /// `%window-add` events. P8 W3b replaces the controller's
    /// `pending_splits` / `pending_windows` / `pending_window_pane`
    /// queues with this single vector. See the doc on
    /// [`EventWaiterKind`] for the matching rules.
    event_waiters: Mutex<Vec<EventWaiter>>,
}

impl Default for CommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl CommandRegistry {
    /// Create an empty registry. Starts ids at 0.
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            by_id: Mutex::new(HashMap::new()),
            kind_by_id: Mutex::new(HashMap::new()),
            completed: std::sync::atomic::AtomicU64::new(0),
            event_waiters: Mutex::new(Vec::new()),
        }
    }

    /// Register a command + its wire payload + its waiter (if any), and
    /// return the resulting [`TaggedCommand`] ready for the writer task.
    ///
    /// The id allocation and the map insert happen **inside the same
    /// `Mutex` critical section**, so a `%begin <id>` reply arriving
    /// between them cannot reference an id that has no waiter. This is
    /// the single guarantee that lets us drop the old "fast-path
    /// Mutex<Option<...>>" races (Bug 011 / Bug 014).
    pub fn register(
        &self,
        kind: CommandKind,
        wire: String,
        waiter: Option<ResponseWaiter>,
    ) -> RegisteredCommand {
        let id = CommandId(
            self.next_id
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        );
        let waiter_registered = waiter.is_some();
        if let Some(w) = waiter {
            self.by_id
                .lock()
                .expect("CommandRegistry mutex poisoned")
                .insert(id, w);
        }
        // Mirror the kind into `kind_by_id` whenever there is a waiter;
        // for fire-and-forget commands the dispatcher never classifies
        // by kind, so we skip the insert. This keeps the two maps 1:1
        // for any id actually routable via `kind_for`.
        if waiter_registered {
            self.kind_by_id
                .lock()
                .expect("CommandRegistry mutex poisoned")
                .insert(id, kind.clone());
        }
        let tagged = TaggedCommand { id, kind, wire };
        RegisteredCommand {
            id,
            tagged,
            waiter_registered,
        }
    }

    /// Take the [`ResponseWaiter`] registered for `id`. Returns `None`
    /// when no waiter is registered (either fire-and-forget or already
    /// taken by an earlier `%end`).
    ///
    /// Call this on `%end <id>` (or `%error <id>`). The response router
    /// passes the accumulated body / error message into the waiter.
    pub fn take(&self, id: CommandId) -> Option<ResponseWaiter> {
        self.by_id
            .lock()
            .expect("CommandRegistry mutex poisoned")
            .remove(&id)
    }

    /// Look up the [`CommandKind`] that produced the registered waiter
    /// for `id`. Returns `None` for fire-and-forget commands (which the
    /// caller never registered against `by_id`) and for ids that have
    /// already been taken by `take(id)`.
    ///
    /// P8 W3b: `RouterState::process` uses this on `%end` so the
    /// dispatcher can classify the body without sniffing the first line
    /// (the old `first.starts_with('@')` heuristic — Bug 022).
    pub fn kind_for(&self, id: CommandId) -> Option<CommandKind> {
        self.kind_by_id
            .lock()
            .expect("CommandRegistry mutex poisoned")
            .get(&id)
            .cloned()
    }

    /// Register an event-correlated waiter. Returns the entry's index
    /// in the internal `Vec` so they can refer to it if needed (most
    /// callers don't need the id back).
    pub fn register_event_waiter(&self, waiter: EventWaiter) -> usize {
        let mut v = self
            .event_waiters
            .lock()
            .expect("CommandRegistry mutex poisoned");
        v.push(waiter);
        v.len() - 1
    }

    /// Pop the frontmost [`EventWaiterKind::SplitResult`] waiter with
    /// `tmux_window_id == None`. Used by the dispatch task's
    /// `%window-pane-changed` layer 2 (the split-result path).
    pub fn take_event_waiter_for_split(
        &self,
    ) -> Option<tokio::sync::oneshot::Sender<crate::services::tmux::controller::SplitResult>> {
        let mut v = self
            .event_waiters
            .lock()
            .expect("CommandRegistry mutex poisoned");
        let pos = v.iter().position(|w| {
            matches!(
                w.kind,
                crate::services::tmux::protocol::command::EventWaiterKind::SplitResult
            ) && w.tmux_window_id.is_none()
        })?;
        match v.remove(pos).sender {
            EventWaiterSender::Split(tx) => Some(tx),
            // Type system guarantees `kind == SplitResult` ⇔ `sender == Split`.
            _ => unreachable!("kind == SplitResult implies sender == Split"),
        }
    }

    /// Take the [`EventWaiterKind::NewWindowResult`] waiter with
    /// `tmux_window_id == None` (the "no window_id yet" phase of the
    /// two-phase new-window dance). Used by the dispatch task's
    /// `%window-add` case (a).
    pub fn take_event_waiter_for_new_window_unbound(&self) -> Option<EventWaiter> {
        let mut v = self
            .event_waiters
            .lock()
            .expect("CommandRegistry mutex poisoned");
        let pos = v.iter().position(|w| {
            matches!(
                w.kind,
                crate::services::tmux::protocol::command::EventWaiterKind::NewWindowResult
            ) && w.tmux_window_id.is_none()
        })?;
        Some(v.remove(pos))
    }

    /// Take the waiter (any kind) registered for `window_id`. Used by
    /// the dispatch task's `%window-pane-changed` layer 3 (the
    /// Wave 3 new-window / bootstrap path).
    pub fn take_event_waiter_for_window(&self, window_id: &str) -> Option<EventWaiter> {
        let mut v = self
            .event_waiters
            .lock()
            .expect("CommandRegistry mutex poisoned");
        let pos = v
            .iter()
            .position(|w| w.tmux_window_id.as_deref() == Some(window_id))?;
        Some(v.remove(pos))
    }

    /// How many event waiters are currently registered. Used by the
    /// dispatch task's `WindowAdd` case (b) bootstrap-detection
    /// predicate (no `NewWindowResult` waiter + no Bootstrap waiter
    /// ⇒ this is the first window).
    pub(crate) fn event_waiter_count(&self) -> usize {
        self.event_waiters
            .lock()
            .expect("CommandRegistry mutex poisoned")
            .len()
    }

    /// Test/diagnostic helper: how many waiters are still registered.
    #[allow(dead_code)]
    pub fn outstanding(&self) -> usize {
        self.by_id
            .lock()
            .expect("CommandRegistry mutex poisoned")
            .len()
    }

    /// Test/diagnostic helper: how many waiters have been taken since the
    /// registry was created.
    #[allow(dead_code)]
    pub fn completed(&self) -> u64 {
        self.completed.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Drop every registered waiter (and body buffer). Used on
    /// controller close so any pending `await_first_pane` / `wait_for`
    /// etc. wake up and observe the shutdown instead of hanging
    /// forever.
    ///
    /// Returns the number of waiters that were dropped.
    pub fn drain(&self) -> usize {
        let mut map = self.by_id.lock().expect("CommandRegistry mutex poisoned");
        let n = map.len();
        map.clear();
        // Mirror the kind map so a stale entry can't outlive its waiter
        // and mislead `kind_for` post-shutdown.
        self.kind_by_id
            .lock()
            .expect("CommandRegistry mutex poisoned")
            .clear();
        n
    }

    /// Drop every event-correlated waiter. Used on controller close.
    /// The senders inside the dropped waiters observe a closed channel
    /// and surface `Err` to the awaiting public methods.
    ///
    /// Returns the number of event waiters that were dropped.
    pub fn drain_event_waiters(&self) -> usize {
        let mut v = self
            .event_waiters
            .lock()
            .expect("CommandRegistry mutex poisoned");
        let n = v.len();
        v.clear();
        n
    }

    /// Drain command waiters AND event waiters in one call. P8 W3b:
    /// `TmuxController::close` uses this so it doesn't have to remember
    /// which fields existed in v1 vs v2 — there's only the registry.
    ///
    /// Returns `(command_drained, event_drained)`.
    pub fn drain_all(&self) -> (usize, usize) {
        (self.drain(), self.drain_event_waiters())
    }

    /// Test-only: snapshot every currently-registered waiter id. Used
    /// by tests that need to drive the dispatch task with synthetic
    /// `%begin` / `%output` / `%end` events whose `id` matches the
    /// one `capture_pane` (or any future migrated public method) got
    /// from `register()`. Without this helper the tests would have to
    /// hardcode ids and quietly drift out of sync with the registry's
    /// allocator; with it, the test reads the id the registry just
    /// assigned and uses that.
    #[cfg(test)]
    pub(crate) fn ids(&self) -> Vec<CommandId> {
        self.by_id
            .lock()
            .expect("CommandRegistry mutex poisoned")
            .keys()
            .copied()
            .collect()
    }

    /// Convenience: produce the [`ResponseOutcome`] to send into a waiter
    /// after a `%end` / `%error` reply. Counts `completed` for diagnostics.
    ///
    /// Callers (PR-T5's response router) call this with the accumulated
    /// body lines (for `%end`) or the error message (for `%error`), then
    /// pass the resulting `ResponseOutcome` into the `BeginEnd` sender
    /// they retrieved via `take(id)`.
    #[allow(dead_code)]
    pub fn record_completed(&self) {
        self.completed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Convert a registry `take` result into a `BeginEnd` sender so the
/// caller can ship the body / error into it without re-pattern-matching.
#[allow(dead_code)]
pub fn send_to_waiter(waiter: ResponseWaiter, outcome: ResponseOutcome) {
    if let ResponseWaiter::BeginEnd(tx) = waiter {
        // If the caller dropped their `await` future (e.g. closed the
        // session), `send` returns Err — we drop it silently because the
        // request is already abandoned.
        let _ = tx.send(outcome);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_waiter() -> ResponseWaiter {
        ResponseWaiter::BeginEnd(tokio::sync::oneshot::channel().0)
    }

    #[test]
    fn register_increments_id() {
        let reg = CommandRegistry::new();
        let a = reg.register(CommandKind::DisplayVersion, "x\n".into(), None);
        let b = reg.register(CommandKind::ListCommands, "y\n".into(), None);
        let c = reg.register(CommandKind::Detach, "\n".into(), None);
        assert_eq!(a.tagged.id.0, 0);
        assert_eq!(b.tagged.id.0, 1);
        assert_eq!(c.tagged.id.0, 2);
    }

    #[test]
    fn register_with_waiter_inserts_into_map() {
        let reg = CommandRegistry::new();
        let _ = reg.register(
            CommandKind::DisplayVersion,
            "x\n".into(),
            Some(dummy_waiter()),
        );
        assert_eq!(reg.outstanding(), 1);
    }

    #[test]
    fn register_without_waiter_does_not_insert() {
        let reg = CommandRegistry::new();
        let _ = reg.register(CommandKind::Detach, "\n".into(), None);
        assert_eq!(reg.outstanding(), 0);
    }

    #[test]
    fn take_returns_and_removes_waiter() {
        let reg = CommandRegistry::new();
        let r = reg.register(
            CommandKind::DisplayVersion,
            "x\n".into(),
            Some(dummy_waiter()),
        );
        assert_eq!(reg.outstanding(), 1);
        assert!(reg.take(r.tagged.id).is_some());
        assert_eq!(reg.outstanding(), 0);
        // Second take returns None.
        assert!(reg.take(r.tagged.id).is_none());
    }

    #[test]
    fn take_unknown_id_returns_none() {
        let reg = CommandRegistry::new();
        assert!(reg.take(CommandId(999)).is_none());
    }

    #[test]
    fn drain_clears_all_waiters() {
        let reg = CommandRegistry::new();
        for _ in 0..5 {
            let _ = reg.register(
                CommandKind::DisplayVersion,
                "x\n".into(),
                Some(dummy_waiter()),
            );
        }
        assert_eq!(reg.outstanding(), 5);
        assert_eq!(reg.drain(), 5);
        assert_eq!(reg.outstanding(), 0);
        // Drain on empty returns 0.
        assert_eq!(reg.drain(), 0);
    }

    #[test]
    fn ids_are_unique_across_registrations() {
        let reg = CommandRegistry::new();
        let mut seen = std::collections::HashSet::new();
        for _ in 0..100 {
            let r = reg.register(CommandKind::Detach, "\n".into(), None);
            assert!(seen.insert(r.tagged.id), "duplicate id {:?}", r.tagged.id);
        }
        assert_eq!(seen.len(), 100);
    }

    #[test]
    fn send_to_waiter_resolves_promise() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let waiter = ResponseWaiter::BeginEnd(tx);
        let outcome = ResponseOutcome::Ok {
            body_lines: vec!["3.4".into()],
        };
        send_to_waiter(waiter, outcome);
        // Channel resolves immediately because we already sent.
        let got = tokio_test_block_on(rx);
        assert_eq!(
            got.unwrap(),
            ResponseOutcome::Ok {
                body_lines: vec!["3.4".into()]
            }
        );
    }

    /// Tiny inline "block on" so the test file doesn't pull in a runtime
    /// dependency. Tokio's `tokio::sync::oneshot::Receiver::blocking_recv`
    /// exists but requires the `sync` feature in some configs; using
    /// `try_recv` in a tight loop is portable.
    fn tokio_test_block_on<T>(
        mut rx: tokio::sync::oneshot::Receiver<T>,
    ) -> Result<T, tokio::sync::oneshot::error::TryRecvError> {
        loop {
            match rx.try_recv() {
                Ok(v) => return Ok(v),
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                    std::hint::spin_loop();
                }
                Err(e) => return Err(e),
            }
        }
    }

    #[test]
    fn record_completed_increments() {
        let reg = CommandRegistry::new();
        assert_eq!(reg.completed(), 0);
        reg.record_completed();
        reg.record_completed();
        reg.record_completed();
        assert_eq!(reg.completed(), 3);
    }
}
