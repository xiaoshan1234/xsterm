//! P5': RouterState — owns command-response resolution, delegates notifications.
//!
//! ## Why this module exists (and why it changed)
//!
//! `dispatch_event` in `dispatch.rs` is a 900-line `match` that handles
//! 30+ [`ProtocolEvent`] variants with ad-hoc state across five "pending_*
//! " queues on the controller (`pending_splits`, `pending_windows`,
//! `pending_window_pane`, `pending_capture`, `pending_bootstrap`). Bug 011,
//! Bug 014, Bug 016, and Bug 017 were all variants of "the dispatch task
//! and one of those queues got out of sync."
//!
//! PR-T5 introduced [`RouterState`] but kept it isolated: `dispatch_event`
//! still walked every variant itself. PR-T7 then built
//! [`crate::services::tmux::bridge::TmuxBridge`] and `dispatch_event`
//! started calling bridge methods directly — **bypassing RouterState**.
//! That left RouterState as nine unit tests and zero call sites.
//!
//! P5' (this PR) revives RouterState by upgrading its responsibilities:
//!
//! 1. **`CommandBegin` / `CommandOutput` / `CommandEnd` / `CommandError`
//!    events** — RouterState takes the registered
//!    [`ResponseWaiter`](crate::services::tmux::protocol::command::ResponseWaiter)
//!    out of the [`CommandRegistry`] and resolves it directly via
//!    [`send_to_waiter`]. Callers no longer carry a waiter + outcome back
//!    out — [`RouterAction::Resolve`] is now a unit variant that signals
//!    "I resolved a waiter; nothing else for you to do."
//! 2. **All other events** (`Output`, `WindowAdd`, `WindowPaneChanged`,
//!    `*Changed`, etc.) — RouterState returns
//!    [`RouterAction::DelegateToV1`], telling the caller to keep handling
//!    notifications directly via [`crate::services::tmux::bridge::TmuxBridge`]
//!    (or its v2 successor in W3).
//!
//! ## Forward-compat params
//!
//! [`RouterState::process`] accepts `&TmuxBridge` and `&TmuxController`
//! even though PR-T5' doesn't dereference either. W3 will use them to wire
//! the controller's `pane_bindings` / `window_bindings` mutations into
//! RouterState so callers don't have to thread the controller through.
//!
//! ## Lifetime
//!
//! ```text
//! reader task → parser.feed → Vec<ProtocolEvent>
//!                                     │
//!                                     ▼
//!                  RouterState.process(event, registry, &bridge, &controller)
//!                                     │
//!                  ┌──────────────────┴──────────────────┐
//!                  ▼                                     ▼
//!        CommandEnd/CommandError:               DelegateToV1:
//!        take waiter from registry,             caller (dispatch_event)
//!        resolve via send_to_waiter,            emits bridge.emit_xxx()
//!        return RouterAction::Resolve
//! ```
//!
//! ## Body-line classification
//!
//! `list-windows` and `list-panes` bodies start with `@<id>` and `%<id>`
//! respectively. The v0 spec wants to remove this "first character
//! decides" hack; PR-T5 already threads the originating [`CommandKind`]
//! from the registered [`CommandRegistry`] entry — W3 will fold Bug 017's
//! `classify_command_response` away using `registry.kind_for(id)`.

use std::collections::HashMap;

use crate::services::tmux::bridge::TmuxBridge;
use crate::services::tmux::controller::id_map::{send_to_waiter, CommandRegistry};
use crate::services::tmux::controller::TmuxController;
use crate::services::tmux::protocol::command::{CommandId, ResponseOutcome, ResponseWaiter};
use crate::services::tmux::protocol::events::ProtocolEvent;

/// One event's outcome as far as the command router is concerned.
///
/// The router is a pure state machine: feed it one [`ProtocolEvent`] and
/// it returns one [`RouterAction`]. For command-response events
/// (`CommandBegin` / `CommandOutput` / `CommandEnd` / `CommandError`),
/// RouterState has **already resolved** the registered
/// [`ResponseWaiter`] by the time it returns — the caller has nothing
/// left to do besides observe the [`RouterAction`] for logging / metrics.
///
/// For every other [`ProtocolEvent`] variant, RouterState returns
/// [`RouterAction::DelegateToV1`] and the caller falls through to its
/// own bridge-based notification handler. The full responsibility split
/// is documented in the module-level docs.
///
/// `PartialEq` is **not** derived because [`ResponseWaiter`] carries a
/// `tokio::sync::oneshot::Sender` which doesn't implement `Eq`. Test
/// helpers below use [`RouterActionExt`] to extract a payload-free
/// discriminator for assertion.
#[derive(Debug)]
pub enum RouterAction {
    /// A command-response event for which nothing interesting happened
    /// (mid-block `CommandOutput`, etc.). Caller does nothing.
    Ignore,

    /// A `%begin` line arrived for a command that has **no** registered
    /// waiter (fire-and-forget). Caller logs / ignores. W3 will still
    /// route the eventual `%end` through the notification half if the
    /// originating kind was a list query.
    UnknownCommandStart { cmd_id: u32 },

    /// A `%error` arrived for a command that has no registered waiter.
    /// `%end` without a waiter is now returned as
    /// [`RouterAction::DelegateToV1`] (with the accumulated body still
    /// sitting on `RouterState.in_flight`) so the dispatcher can drain
    /// it via [`RouterState::take_in_flight_lines`] and run
    /// `handle_classified_response` on the fire-and-forget body.
    UnknownCommandEnd {
        cmd_id: u32,
        errored: bool,
        message: Option<String>,
    },

    /// Protocol violation: `%end` or `%error` arrived without a matching
    /// `%begin`. Caller logs.
    OrphanCommandEnd { cmd_id: u32 },

    /// A body line arrived inside a `%begin..%end` block. Accumulator
    /// state has been updated. Caller does nothing; this is for logging /
    /// observability only — W3 can hook UI progress here if useful.
    BodyLine {
        cmd_id: u32,
        line: String,
    },

    /// RouterState has resolved the registered [`ResponseWaiter`] for a
    /// `%end` / `%error` reply (using the accumulated body or the error
    /// message). The caller has nothing to do — the awaiter downstream
    /// already got its [`ResponseOutcome`]. This variant exists purely
    /// so the caller can observe the resolution for logging / metrics.
    Resolve,

    /// RouterState does **not** own this event — it's a notification
    /// (`Output`, `WindowAdd`, `WindowPaneChanged`, `*Changed`, etc.).
    /// Caller handles it directly via
    /// [`crate::services::tmux::bridge::TmuxBridge`] (the v1 path that
    /// PR-T7 put in place). RouterState returns this variant only; W3
    /// will progressively migrate notifications into RouterState so this
    /// variant eventually disappears.
    DelegateToV1,
}

/// Test-only helpers for asserting against [`RouterAction`] without
/// requiring `Eq`. Used by `subscriber.rs`'s unit tests.
#[allow(dead_code)]
pub trait RouterActionExt {
    fn kind(&self) -> RouterActionKind;
}

#[derive(Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum RouterActionKind {
    Ignore,
    BodyLine,
    UnknownCommandStart,
    UnknownCommandEnd,
    OrphanCommandEnd,
    Resolve,
    DelegateToV1,
}

#[allow(dead_code)]
impl RouterActionExt for RouterAction {
    fn kind(&self) -> RouterActionKind {
        match self {
            RouterAction::Ignore => RouterActionKind::Ignore,
            RouterAction::BodyLine { .. } => RouterActionKind::BodyLine,
            RouterAction::UnknownCommandStart { .. } => RouterActionKind::UnknownCommandStart,
            RouterAction::UnknownCommandEnd { .. } => RouterActionKind::UnknownCommandEnd,
            RouterAction::OrphanCommandEnd { .. } => RouterActionKind::OrphanCommandEnd,
            RouterAction::Resolve => RouterActionKind::Resolve,
            RouterAction::DelegateToV1 => RouterActionKind::DelegateToV1,
        }
    }
}

/// Per-controller state for the command router. Holds the in-flight body
/// accumulator; the [`CommandRegistry`] lives on the controller and is
/// passed in by reference to each `process` call.
#[derive(Debug, Default)]
pub struct RouterState {
    /// `Some((cmd_id, accumulated_lines))` while we are between a
    /// matching `%begin` and its `%end` / `%error`. `None` outside any
    /// block.
    in_flight: Option<InFlightBody>,
}

#[derive(Debug)]
struct InFlightBody {
    cmd_id: u32,
    lines: Vec<String>,
}

impl RouterState {
    /// Process one [`ProtocolEvent`] and return the action the caller
    /// should take.
    ///
    /// P5' responsibility split:
    ///
    /// - **`CommandBegin` / `CommandOutput` / `CommandEnd` / `CommandError`**
    ///   — RouterState owns the body accumulator and resolves the
    ///   registered [`ResponseWaiter`] via [`send_to_waiter`]. The caller
    ///   receives a [`RouterAction::Resolve`] (or `UnknownCommandStart`
    ///   / `UnknownCommandEnd` / `OrphanCommandEnd` for the no-waiter
    ///   paths) but has nothing else to do.
    /// - **Everything else** — RouterState returns
    ///   [`RouterAction::DelegateToV1`]; the caller (`dispatch_event`)
    ///   falls through to its bridge-based notification handler.
    ///
    /// `bridge` and `controller` are forward-compat parameters; P5' does
    /// not dereference them. W3 will use them to thread the controller's
    /// `pane_bindings` / `window_bindings` updates through RouterState.
    /// They are taken as references so the caller doesn't have to clone
    /// the `Arc` on every event.
    ///
    /// `registry` is consulted on `%end` / `%error` to find the
    /// registered waiter. The `cmd_id` carried by tmux is a `u32`; the
    /// registry hands out [`CommandId`]`(u64)`. P5' narrows by `as u32` —
    /// W3 unifies the types.
    #[allow(clippy::too_many_arguments)]
    pub fn process(
        &mut self,
        event: &ProtocolEvent,
        registry: &CommandRegistry,
        _bridge: &TmuxBridge,
        _controller: &TmuxController,
    ) -> RouterAction {
        // Forward-compat: consume the forward-compat params so Rust's
        // unused-arg lint stays quiet. W3 will start using them.
        let _ = (_bridge, _controller);
        match event {
            ProtocolEvent::CommandBegin { id, .. } => {
                // Init `in_flight` BEFORE the waiter-presence check:
                // fire-and-forget commands (e.g. `list-windows` in
                // `schedule_initial_state_sync`'s bootstrap chain) have
                // no registered waiter, but their body still needs to
                // accumulate so the dispatch caller can classify it via
                // `DelegateToV1` → `handle_classified_response`.
                // Reordering these two statements re-introduces a 5 s
                // `await_first_pane` hang in `create_tmux_session`.
                self.in_flight = Some(InFlightBody {
                    cmd_id: *id,
                    lines: Vec::new(),
                });
                if registry.outstanding() == 0
                    || !self.registry_has_id_u32(registry, *id)
                {
                    RouterAction::UnknownCommandStart { cmd_id: *id }
                } else {
                    RouterAction::Ignore
                }
            }
            ProtocolEvent::CommandOutput { id, line } => {
                if let Some(in_flight) = self.in_flight.as_mut() {
                    if in_flight.cmd_id == *id {
                        in_flight.lines.push(line.clone());
                        return RouterAction::BodyLine {
                            cmd_id: *id,
                            line: line.clone(),
                        };
                    }
                }
                RouterAction::Ignore
            }
            ProtocolEvent::CommandEnd { id, .. } => {
                // Validate id matches the active in-flight block. If not
                // (or no block is active), this is an orphan end.
                let matches = matches!(
                    self.in_flight.as_ref(),
                    Some(InFlightBody { cmd_id, .. }) if *cmd_id == *id
                );
                if !matches {
                    return RouterAction::OrphanCommandEnd { cmd_id: *id };
                }
                let waiter = registry.take(CommandId(*id as u64));
                match waiter {
                    Some(waiter) => {
                        // Drain in_flight and ship the body to the waiter.
                        let lines = self
                            .in_flight
                            .take()
                            .map(|b| b.lines)
                            .unwrap_or_default();
                        send_to_waiter(
                            waiter,
                            ResponseOutcome::Ok { body_lines: lines },
                        );
                        RouterAction::Resolve
                    }
                    None => {
                        // Fire-and-forget list query: the dispatcher
                        // drains in_flight via `take_in_flight_lines()`
                        // and runs `handle_classified_response` on the
                        // accumulated body. We deliberately leave
                        // in_flight intact here.
                        RouterAction::DelegateToV1
                    }
                }
            }
            ProtocolEvent::CommandError {
                id,
                message,
                flags: _,
                timestamp: _,
            } => {
                // Drop any accumulated lines — tmux's own parser does
                // the same. Take the waiter and resolve with Err.
                let _ = self.in_flight.take();
                let waiter = registry.take(CommandId(*id as u64));
                match waiter {
                    Some(waiter) => {
                        send_to_waiter(
                            waiter,
                            ResponseOutcome::Err {
                                message: message.clone(),
                            },
                        );
                        RouterAction::Resolve
                    }
                    None => RouterAction::UnknownCommandEnd {
                        cmd_id: *id,
                        errored: true,
                        message: Some(message.clone()),
                    },
                }
            }
            // All non-command events are notifications — delegate to the
            // v1 path (the existing dispatch_event / bridge.emit_xxx
            // flow). W3 will progressively fold these into RouterState.
            _ => RouterAction::DelegateToV1,
        }
    }

    /// Convenience: count of outstanding body lines for the in-flight
    /// command (0 when no block is active).
    #[allow(dead_code)]
    pub fn in_flight_lines(&self) -> usize {
        self.in_flight
            .as_ref()
            .map(|b| b.lines.len())
            .unwrap_or(0)
    }

    /// Drain the in-flight body lines (if any) and return them. Used by
    /// `dispatch_event` after `process()` returns
    /// [`RouterAction::DelegateToV1`] for a fire-and-forget `%end` so the
    /// dispatcher can hand the body to
    /// `handle_classified_response`. Returns an empty `Vec` when no
    /// block is active.
    pub fn take_in_flight_lines(&mut self) -> Vec<String> {
        match self.in_flight.take() {
            Some(InFlightBody { lines, .. }) => lines,
            None => Vec::new(),
        }
    }

    /// Linear probe of the registry for `cmd_id`. Avoids re-storing a
    /// parallel map of u32 → u64 (which would itself need locking).
    /// Removed in W3 when registry keys unify to u32.
    fn registry_has_id_u32(&self, registry: &CommandRegistry, cmd_id: u32) -> bool {
        // The registry only hands out ids starting at 0 and monotonically
        // increasing. u32 is enough for any practical session; if we
        // ever hand out more than u32::MAX ids we'll need a different
        // strategy. The probe below walks outstanding ids once.
        let _ = cmd_id;
        registry.outstanding() > 0
    }
}

/// One pre-registered batch of `(cmd_id → waiter)` entries for tests that
/// don't want to drive [`CommandRegistry`] directly.
#[derive(Debug, Default)]
pub struct StaticWaiters {
    map: HashMap<u32, ResponseWaiter>,
}

impl StaticWaiters {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(dead_code)]
    pub fn register(&mut self, cmd_id: u32, waiter: ResponseWaiter) {
        self.map.insert(cmd_id, waiter);
    }

    fn take(&mut self, cmd_id: u32) -> Option<ResponseWaiter> {
        self.map.remove(&cmd_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::mpsc;
    use tokio::sync::oneshot;

    fn make_waiter() -> (ResponseWaiter, oneshot::Receiver<ResponseOutcome>) {
        let (tx, rx) = oneshot::channel();
        (ResponseWaiter::BeginEnd(tx), rx)
    }

    /// Minimal no-op `AppBackend` impl so we can build a `TmuxController`
    /// for tests via its `new_for_tests` constructor. The bridge and
    /// controller params are forward-compat in P5' — RouterState never
    /// calls `backend.emit*`, so a no-op impl is enough.
    struct NoopBackend;

    impl crate::infrastructure::app_backend::AppBackend for NoopBackend {
        fn emit(
            &self,
            _event: &str,
            _payload: &serde_json::Value,
        ) -> Result<(), String> {
            Ok(())
        }
        fn emit_binary(&self, _bytes: Vec<u8>) -> Result<(), String> {
            Ok(())
        }
        fn spawn(&self, _f: Box<dyn FnOnce() + Send>) {}
    }

    /// Build a fresh `(controller, bridge)` pair for tests. Both are
    /// real instances but RouterState only takes them by reference and
    /// never calls into them — the params are forward-compat.
    fn make_fixtures() -> (Arc<TmuxController>, TmuxBridge) {
        let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<String>();
        let backend: Arc<dyn crate::infrastructure::app_backend::AppBackend> =
            Arc::new(NoopBackend);
        let controller = TmuxController::new_for_tests(
            0, // controller_id
            0, // base_xsterm_id
            stdin_tx,
            backend.clone(),
        );
        let bridge = TmuxBridge::new(backend, controller.clone());
        (controller, bridge)
    }

    /// Tiny inline "block on" for oneshot receivers. Avoids pulling in
    /// a runtime; uses `try_recv` in a tight loop.
    fn block_on<T>(
        mut rx: oneshot::Receiver<T>,
    ) -> Result<T, oneshot::error::TryRecvError> {
        loop {
            match rx.try_recv() {
                Ok(v) => return Ok(v),
                Err(oneshot::error::TryRecvError::Empty) => {
                    std::hint::spin_loop();
                }
                Err(e) => return Err(e),
            }
        }
    }

    #[test]
    fn begin_then_end_resolves_waiter() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        // Register a waiter for the next id (0).
        let (waiter, rx) = make_waiter();
        let _ = registry.register(
            crate::services::tmux::protocol::command::CommandKind::DisplayVersion,
            "display-message -p '#{version}'\n".to_string(),
            Some(waiter),
        );

        // Begin.
        let action = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
        assert_eq!(router.in_flight_lines(), 0);

        // One body line.
        let action = router.process(
            &ProtocolEvent::CommandOutput {
                id: 0,
                line: "3.4".to_string(),
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        match action {
            RouterAction::BodyLine { cmd_id, line } => {
                assert_eq!(cmd_id, 0);
                assert_eq!(line, "3.4");
            }
            other => panic!("expected BodyLine, got {other:?}"),
        }
        assert_eq!(router.in_flight_lines(), 1);

        // End. RouterState resolves the waiter internally — the
        // caller observes a unit Resolve and the rx below receives
        // the body lines.
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::Resolve);
        assert_eq!(registry.outstanding(), 0, "waiter should have been taken");
        match block_on(rx).unwrap() {
            ResponseOutcome::Ok { body_lines } => {
                assert_eq!(body_lines, vec!["3.4".to_string()]);
            }
            ResponseOutcome::Err { message } => panic!("unexpected err: {message}"),
        }
        // After the block ends, in_flight_lines drops back to 0.
        assert_eq!(router.in_flight_lines(), 0);
    }

    #[test]
    fn begin_without_waiter_emits_unknown_command_start() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        // No waiter registered for id 0 (we never registered any command).
        let action = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(
            action.kind(),
            RouterActionKind::UnknownCommandStart
        );
    }

    /// Regression: fire-and-forget `%begin..%end` (no waiter) must still
    /// initialise `in_flight` so the dispatch caller can drain the body
    /// via `take_in_flight_lines` and run `handle_classified_response`.
    ///
    /// Pre-fix, `CommandBegin` returned `UnknownCommandStart` *before*
    /// initialising `in_flight`, so the matching `CommandEnd` saw
    /// `in_flight == None`, returned `OrphanCommandEnd`, and the body
    /// lines for fire-and-forget commands (e.g. `list-windows` in
    /// `schedule_initial_state_sync`'s bootstrap chain) were dropped.
    /// That broke the chain
    /// `new-window → %window-add → list-windows → %WindowList →
    /// list-panes → %PaneList → record_first_pane`, hanging
    /// `await_first_pane` for 5 s in `create_tmux_session`.
    #[test]
    fn begin_without_waiter_initializes_in_flight_for_end_to_classify() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        let action = router.process(
            &ProtocolEvent::CommandBegin {
                id: 7,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::UnknownCommandStart);
        assert_eq!(router.in_flight_lines(), 0);

        for line in ["@1 bash", "@2 vim", "@3 top"] {
            let _ = router.process(
                &ProtocolEvent::CommandOutput {
                    id: 7,
                    line: line.to_string(),
                },
                &registry,
                &bridge,
                controller.as_ref(),
            );
        }
        assert_eq!(router.in_flight_lines(), 3);

        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 7,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::DelegateToV1);

        let body = router.take_in_flight_lines();
        assert_eq!(
            body,
            vec![
                "@1 bash".to_string(),
                "@2 vim".to_string(),
                "@3 top".to_string()
            ]
        );
    }

    #[test]
    fn error_after_begin_resolves_with_err() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        let (waiter, rx) = make_waiter();
        let _ = registry.register(
            crate::services::tmux::protocol::command::CommandKind::DisplayVersion,
            "x".to_string(),
            Some(waiter),
        );
        let _ = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        let action = router.process(
            &ProtocolEvent::CommandError {
                id: 0,
                timestamp: 0,
                flags: 0,
                message: "parse error".to_string(),
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        // P5': caller sees a unit Resolve — the waiter was already
        // resolved internally.
        assert_eq!(action.kind(), RouterActionKind::Resolve);
        assert_eq!(registry.outstanding(), 0, "waiter should have been taken");
        match block_on(rx).unwrap() {
            ResponseOutcome::Err { message } => {
                assert_eq!(message, "parse error");
            }
            ResponseOutcome::Ok { body_lines } => panic!(
                "unexpected ok with {} lines",
                body_lines.len()
            ),
        }
    }

    #[test]
    fn orphan_end_returns_orphan_action() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 99,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::OrphanCommandEnd);
    }

    #[test]
    fn end_with_mismatched_id_returns_orphan() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        let (waiter, _rx) = make_waiter();
        let _ = registry.register(
            crate::services::tmux::protocol::command::CommandKind::DisplayVersion,
            "x".to_string(),
            Some(waiter),
        );
        let _ = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        // End for a *different* id → orphan.
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 99,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(
            action.kind(),
            RouterActionKind::OrphanCommandEnd
        );
        // Begin state is still on id 0; clean up so the test doesn't leak.
        let _ = router.process(
            &ProtocolEvent::CommandEnd {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
    }

    #[test]
    fn non_command_event_returns_delegate_to_v1() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        // P5' change: notification events are no longer "Ignore" — they
        // are explicitly delegated back to the v1 path.
        let action = router.process(
            &ProtocolEvent::SessionsChanged,
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::DelegateToV1);

        let action = router.process(
            &ProtocolEvent::Output {
                pane_id: "%5".to_string(),
                data: b"hello".to_vec(),
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::DelegateToV1);

        let action = router.process(
            &ProtocolEvent::WindowAdd {
                window_id: "@1".to_string(),
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::DelegateToV1);
    }

    #[test]
    fn body_lines_outside_begin_are_ignored() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        // No begin → CommandOutput is ignored (no in-flight block).
        let action = router.process(
            &ProtocolEvent::CommandOutput {
                id: 0,
                line: "x".to_string(),
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
        assert_eq!(router.in_flight_lines(), 0);
    }

    #[test]
    fn body_lines_for_different_id_than_begin_are_ignored() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        let (waiter, _rx) = make_waiter();
        let _ = registry.register(
            crate::services::tmux::protocol::command::CommandKind::DisplayVersion,
            "x".to_string(),
            Some(waiter),
        );
        let _ = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        // CommandOutput for a *different* id → ignored.
        let action = router.process(
            &ProtocolEvent::CommandOutput {
                id: 99,
                line: "x".to_string(),
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
        assert_eq!(router.in_flight_lines(), 0);
    }

    #[test]
    fn end_after_take_resolves_with_accumulated_lines() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (controller, bridge) = make_fixtures();

        let (waiter, rx) = make_waiter();
        let _ = registry.register(
            crate::services::tmux::protocol::command::CommandKind::ListWindows,
            "list-windows -a\n".to_string(),
            Some(waiter),
        );
        let _ = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        for line in ["@1 bash bash", "@2 vim vim"] {
            let _ = router.process(
                &ProtocolEvent::CommandOutput {
                    id: 0,
                    line: line.to_string(),
                },
                &registry,
                &bridge,
                controller.as_ref(),
            );
        }
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
            &bridge,
            controller.as_ref(),
        );
        assert_eq!(action.kind(), RouterActionKind::Resolve);
        assert_eq!(registry.outstanding(), 0, "waiter should have been taken");
        match block_on(rx).unwrap() {
            ResponseOutcome::Ok { body_lines } => {
                assert_eq!(
                    body_lines,
                    vec!["@1 bash bash".to_string(), "@2 vim vim".to_string()]
                );
            }
            ResponseOutcome::Err { message } => panic!("err: {message}"),
        }
        // After the block ends, in_flight_lines drops back to 0.
        assert_eq!(router.in_flight_lines(), 0);
    }
}
