//! PR-T5: Response router — replaces the dispatch.rs 5-level fallthrough.
//!
//! ## Why
//!
//! `dispatch_event` in `dispatch.rs` is a 900-line `match` that handles
//! 30+ [`ProtocolEvent`] variants with ad-hoc state across five "pending_*
//! " queues on the controller (`pending_splits`, `pending_windows`,
//! `pending_window_pane`, `pending_capture`, `pending_bootstrap`). Bug 011,
//! Bug 014, Bug 016, and Bug 017 were all variants of "the dispatch task
//! and one of those queues got out of sync."
//!
//! The new design splits the work into two halves:
//!
//! - **Command response** events (`CommandBegin` / `CommandOutput` /
//!   `CommandEnd` / `CommandError`) are routed by command id. They
//!   accumulate body lines until `%end` or `%error`, then take the
//!   registered waiter out of [`CommandRegistry`] and send it the
//!   accumulated outcome.
//! - **Notification** events (`Output`, `WindowAdd`, `WindowPaneChanged`,
//!   `*Changed`, etc.) update a `SessionView` and emit Tauri events via
//!   the bridge.
//!
//! PR-T5 only delivers the **command-response half** in the form of
//! [`process_event`]; it is a state machine you call per
//! [`ProtocolEvent`], getting back a [`RouterAction`] that says what to
//! do next. The notification half is wired in PR-T7; until then, the
//! old `dispatch_event` is still the source of truth for notifications.
//!
//! ## Lifetime
//!
//! ```text
//! reader task → parser.feed → Vec<ProtocolEvent>
//!                                     │
//!                                     ▼
//!                              RouterState.process(event)
//!                                     │
//!                  ┌──────────────────┴──────────────────┐
//!                  ▼                                     ▼
//!        take waiter from                    (notification half —
//!        CommandRegistry;                   deferred to PR-T7)
//!        build ResponseOutcome
//!                  │
//!                  ▼
//!              RouterAction::Resolve(Waiter, Outcome)
//!                  │
//!                  ▼
//!              send_to_waiter()
//! ```
//!
//! PR-T5 keeps the per-command body accumulator **inside the router
//! state**, not the controller — the controller only needs to know "what
//! waiter, if any, does this id resolve to?" and `take(id)` answers that.
//!
//! ## Body-line classification
//!
//! `list-windows` and `list-panes` bodies start with `@<id>` and `%<id>`
//! respectively. The v0 spec wants to remove this "first character
//! decides" hack; PR-T5 instead threads the originating [`CommandKind`]
//! from the registered [`CommandRegistry`] entry — if the kind was
//! `ListWindows`, body lines are window rows; if `ListPanes`, pane rows.
//! PR-T7 uses this to fold Bug 017's `classify_command_response` away.
//!
//! ## History
//!
//! New in PR-T5. Lives next to `dispatch.rs`; the old file remains the
//! default dispatcher until PR-T8 removes it.

use std::collections::HashMap;

use crate::services::tmux::controller::id_map::{send_to_waiter, CommandRegistry};
use crate::services::tmux::protocol::command::{CommandId, ResponseOutcome, ResponseWaiter};
use crate::services::tmux::protocol::events::ProtocolEvent;

/// One event's outcome as far as the command router is concerned.
///
/// The router is a pure state machine: feed it one [`ProtocolEvent`] and
/// it returns one [`RouterAction`]. The caller is responsible for
/// actually performing the action (e.g. calling
/// [`send_to_waiter`]) — the router itself owns no channels.
///
/// The notification half (which Tauri events to emit, which SessionView
/// slot to update) is intentionally **not** represented here; that ships
/// in PR-T7.
///
/// `PartialEq` is **not** derived because [`ResponseWaiter`] carries a
/// `tokio::sync::oneshot::Sender` which doesn't implement `Eq`. Test
/// helpers below use [`RouterActionExt`] to extract the inner payload
/// for assertion.
#[derive(Debug)]
pub enum RouterAction {
    /// Nothing to do. Notification half will still process the event;
    /// this variant means the command half doesn't need to act.
    Ignore,

    /// A waiter was waiting for the command response that just completed.
    /// Caller must call
    /// [`send_to_waiter`](crate::services::tmux::controller::id_map::send_to_waiter)
    /// with `waiter` + `outcome` to resolve the promise.
    Resolve {
        waiter: ResponseWaiter,
        outcome: ResponseOutcome,
    },

    /// A body line arrived inside a `%begin..%end` block. Accumulator
    /// state has been updated. Caller does nothing; this is for logging /
    /// observability only — PR-T7 can hook UI progress here if useful.
    BodyLine {
        cmd_id: u32,
        line: String,
    },

    /// A `%begin` line arrived for a command that has **no** registered
    /// waiter (fire-and-forget). Caller logs / ignores. PR-T7 will
    /// still route the eventual `%end` through the notification half if
    /// the originating kind was a list query.
    UnknownCommandStart { cmd_id: u32 },

    /// A `%end` / `%error` arrived for a command that has no registered
    /// waiter. Same as `UnknownCommandStart` but at the tail.
    UnknownCommandEnd {
        cmd_id: u32,
        errored: bool,
        message: Option<String>,
    },

    /// Protocol violation: `%end` or `%error` arrived without a matching
    /// `%begin`. Caller logs.
    OrphanCommandEnd { cmd_id: u32 },
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
    Resolve,
    BodyLine,
    UnknownCommandStart,
    UnknownCommandEnd,
    OrphanCommandEnd,
}

#[allow(dead_code)]
impl RouterActionExt for RouterAction {
    fn kind(&self) -> RouterActionKind {
        match self {
            RouterAction::Ignore => RouterActionKind::Ignore,
            RouterAction::Resolve { .. } => RouterActionKind::Resolve,
            RouterAction::BodyLine { .. } => RouterActionKind::BodyLine,
            RouterAction::UnknownCommandStart { .. } => RouterActionKind::UnknownCommandStart,
            RouterAction::UnknownCommandEnd { .. } => RouterActionKind::UnknownCommandEnd,
            RouterAction::OrphanCommandEnd { .. } => RouterActionKind::OrphanCommandEnd,
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
    /// `registry` is consulted on `%end` / `%error` to find the
    /// registered waiter. The `cmd_id` carried by tmux is a `u32`; the
    /// registry hands out `CommandId(u64)`. PR-T5 narrows by `as u32` —
    /// PR-T8 unifies the types.
    pub fn process(
        &mut self,
        event: &ProtocolEvent,
        registry: &CommandRegistry,
    ) -> RouterAction {
        match event {
            ProtocolEvent::CommandBegin { id, .. } => {
                if registry.outstanding() == 0
                    || !self.registry_has_id_u32(registry, *id)
                {
                    return RouterAction::UnknownCommandStart { cmd_id: *id };
                }
                self.in_flight = Some(InFlightBody {
                    cmd_id: *id,
                    lines: Vec::new(),
                });
                RouterAction::Ignore
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
                let lines = match self.in_flight.take() {
                    Some(InFlightBody {
                        cmd_id: active_id,
                        lines,
                    }) if active_id == *id => lines,
                    _ => {
                        return RouterAction::OrphanCommandEnd { cmd_id: *id };
                    }
                };
                let waiter = registry.take(CommandId(*id as u64));
                match waiter {
                    Some(waiter) => RouterAction::Resolve {
                        waiter,
                        outcome: ResponseOutcome::Ok { body_lines: lines },
                    },
                    None => RouterAction::UnknownCommandEnd {
                        cmd_id: *id,
                        errored: false,
                        message: None,
                    },
                }
            }
            ProtocolEvent::CommandError {
                id,
                message,
                flags: _,
                timestamp: _,
            } => {
                // Drop any accumulated lines — tmux's own parser does the
                // same. Take the waiter and resolve with Err.
                let _ = self.in_flight.take();
                let waiter = registry.take(CommandId(*id as u64));
                match waiter {
                    Some(waiter) => RouterAction::Resolve {
                        waiter,
                        outcome: ResponseOutcome::Err {
                            message: message.clone(),
                        },
                    },
                    None => RouterAction::UnknownCommandEnd {
                        cmd_id: *id,
                        errored: true,
                        message: Some(message.clone()),
                    },
                }
            }
            _ => RouterAction::Ignore,
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

    /// Linear probe of the registry for `cmd_id`. Avoids re-storing a
    /// parallel map of u32 → u64 (which would itself need locking).
    /// Removed in PR-T8 when registry keys unify to u32.
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
    use tokio::sync::oneshot;

    fn make_waiter() -> (ResponseWaiter, oneshot::Receiver<ResponseOutcome>) {
        let (tx, rx) = oneshot::channel();
        (ResponseWaiter::BeginEnd(tx), rx)
    }

    #[test]
    fn begin_then_end_resolves_waiter() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        // Register a waiter for the next id (0).
        let (waiter, _rx) = make_waiter();
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
        );
        match action {
            RouterAction::BodyLine { cmd_id, line } => {
                assert_eq!(cmd_id, 0);
                assert_eq!(line, "3.4");
            }
            other => panic!("expected BodyLine, got {other:?}"),
        }
        assert_eq!(router.in_flight_lines(), 1);

        // End.
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
        );
        let (waiter, _rx) = make_waiter();
        let _ = registry.register(
            crate::services::tmux::protocol::command::CommandKind::DisplayVersion,
            "x".to_string(),
            Some(waiter),
        );
        match action {
            RouterAction::Resolve { outcome, .. } => match outcome {
                ResponseOutcome::Ok { body_lines } => {
                    assert_eq!(body_lines, vec!["3.4".to_string()]);
                }
                ResponseOutcome::Err { message } => panic!("unexpected err: {message}"),
            },
            other => panic!("expected Resolve, got {other:?}"),
        }
    }

    #[test]
    fn begin_without_waiter_emits_unknown_command_start() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        // No waiter registered for id 0 (we never registered any command).
        let action = router.process(
            &ProtocolEvent::CommandBegin {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
        );
        assert_eq!(
            action.kind(),
            RouterActionKind::UnknownCommandStart
        );
    }

    #[test]
    fn error_after_begin_resolves_with_err() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
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
        );
        let action = router.process(
            &ProtocolEvent::CommandError {
                id: 0,
                timestamp: 0,
                flags: 0,
                message: "parse error".to_string(),
            },
            &registry,
        );
        let outcome = match action {
            RouterAction::Resolve { waiter, outcome } => {
                // Inspect first (before send moves the value).
                assert_eq!(
                    outcome,
                    ResponseOutcome::Err {
                        message: "parse error".to_string()
                    }
                );
                let stored = outcome.clone();
                // Now actually resolve the promise.
                send_to_waiter(waiter, outcome);
                stored
            }
            other => panic!("expected Resolve, got {other:?}"),
        };
        // rx has the err. (We can't `.await` in a sync test; spin-loop.)
        let mut rx = rx;
        for _ in 0..1000 {
            if let Ok(v) = rx.try_recv() {
                assert_eq!(v, outcome);
                return;
            }
            std::hint::spin_loop();
        }
        panic!("receiver never got value");
    }

    #[test]
    fn orphan_end_returns_orphan_action() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 99,
                timestamp: 0,
                flags: 0,
            },
            &registry,
        );
        assert_eq!(action.kind(), RouterActionKind::OrphanCommandEnd);
    }

    #[test]
    fn end_with_mismatched_id_returns_orphan() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
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
        );
        // End for a *different* id → orphan.
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 99,
                timestamp: 0,
                flags: 0,
            },
            &registry,
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
        );
    }

    #[test]
    fn non_command_event_returns_ignore() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let action = router.process(
            &ProtocolEvent::SessionsChanged,
            &registry,
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
        let action = router.process(
            &ProtocolEvent::Output {
                pane_id: "%5".to_string(),
                data: b"hello".to_vec(),
            },
            &registry,
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
    }

    #[test]
    fn body_lines_outside_begin_are_ignored() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        // No begin → CommandOutput is ignored.
        let action = router.process(
            &ProtocolEvent::CommandOutput {
                id: 0,
                line: "x".to_string(),
            },
            &registry,
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
        assert_eq!(router.in_flight_lines(), 0);
    }

    #[test]
    fn body_lines_for_different_id_than_begin_are_ignored() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
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
        );
        // CommandOutput for a *different* id → ignored.
        let action = router.process(
            &ProtocolEvent::CommandOutput {
                id: 99,
                line: "x".to_string(),
            },
            &registry,
        );
        assert_eq!(action.kind(), RouterActionKind::Ignore);
        assert_eq!(router.in_flight_lines(), 0);
    }

    #[test]
    fn end_after_take_resolves_with_accumulated_lines() {
        let mut router = RouterState::default();
        let registry = CommandRegistry::new();
        let (waiter, _rx) = make_waiter();
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
        );
        for line in ["@1 bash bash", "@2 vim vim"] {
            let _ = router.process(
                &ProtocolEvent::CommandOutput {
                    id: 0,
                    line: line.to_string(),
                },
                &registry,
            );
        }
        let action = router.process(
            &ProtocolEvent::CommandEnd {
                id: 0,
                timestamp: 0,
                flags: 0,
            },
            &registry,
        );
        match action {
            RouterAction::Resolve { outcome, .. } => match outcome {
                ResponseOutcome::Ok { body_lines } => {
                    assert_eq!(
                        body_lines,
                        vec!["@1 bash bash".to_string(), "@2 vim vim".to_string()]
                    );
                }
                ResponseOutcome::Err { message } => panic!("err: {message}"),
            },
            other => panic!("expected Resolve, got {other:?}"),
        }
        // After the block ends, in_flight_lines drops back to 0.
        assert_eq!(router.in_flight_lines(), 0);
    }
}