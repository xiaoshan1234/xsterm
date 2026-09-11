//! Strongly-typed envelope for every outbound tmux `-CC` command.
//!
//! This module is the **type system** half of PR-T3. It defines what every
//! command carries (an id, a kind, a wire payload, and an optional waiter),
//! but it does **not** replace the writer task or wire up the registry to
//! the controller yet — that happens in PR-T5, where the response router
//! (P5's `controller/subscriber.rs`) consumes these enums.
//!
//! ## Why split out
//!
//! The old controller had five ad-hoc wait queues:
//!
//! - `pending_splits: Mutex<VecDeque<oneshot::Sender<SplitResult>>>`
//! - `pending_windows: Mutex<HashMap<String, PendingWindow>>`
//! - `pending_window_pane: Mutex<HashMap<String, PendingWindow>>`
//! - `pending_capture: Mutex<HashMap<u32, oneshot::Sender>>`
//! - `pending_bootstrap: Mutex<Option<oneshot::Sender>>`
//!
//! PR-T5 collapses these into a single `CommandRegistry` keyed by
//! [`CommandId`] — the response router looks up the waiter by the same id
//! that tmux echoes back in `%begin` / `%end`. The five old queues then
//! disappear in PR-T8.
//!
//! ## Lifetime
//!
//! Each outbound command goes through this envelope:
//!
//! ```text
//! caller            controller.id_map      writer task       tmux server
//!   │                    │                    │                   │
//!   │ make_command()    │                    │                   │
//!   ├──────────────────▶│                    │                   │
//!   │                    │ register waiter   │                   │
//!   │                    ├──── encode wire ──▶│                   │
//!   │                    │                    │ write to stdin ──▶│
//!   │                    │                    │                   │
//!   │                    │                    │      %begin <id>  │
//!   │                    │                    │◀──────────────────│
//!   │                    │      on Begin(id)  │                   │
//!   │                    │   start body       │                   │
//!   │                    │      accumulation  │                   │
//!   │                    │                    │      %end   <id>  │
//!   │                    │                    │◀──────────────────│
//!   │                    │      on End(id)    │                   │
//!   │                    │   take waiter      │                   │
//!   │                    │   resolve ────────▶│                   │
//!   │◀──────────────────│                    │                   │
//! ```
//!
//! `TaggedCommand` carries the wire payload (already encoded by
//! [`crate::services::tmux::protocol::wire`]); the writer task in PR-T5
//! unwraps it and writes the bytes to the tmux child's stdin.
//!
//! ## History
//!
//! New in PR-T3. Pre-PR-T3, every controller method constructed its own
//! `oneshot` and stuffed it into one of the five ad-hoc queues; the
//! writer task sent raw `String`s. That coupling made the
//! `%-begin..%-end` routing fragile (Bug 011, Bug 014, Bug 016, Bug 017
//! were all variants of "the queue and the response got out of sync").

use std::sync::atomic::{AtomicU64, Ordering};

/// Monotonically-increasing identifier for an outbound command.
///
/// tmux echoes the same id in `%begin <id>` / `%end <id>` / `%error <id>`,
/// which the response router uses to look up the registered waiter. The id
/// is `u64` to leave room for high-throughput callers; in practice a tmux
/// child rarely gets past a few thousand commands per session.
///
/// PR-T3: defined here as `u64` because the [`CommandRegistry`]
/// constructor hands them out atomically. The wire-level id tmux uses is
/// still `u32` (the parser emits `CommandBegin { id: u32, .. }`); PR-T5's
/// router does the narrowing cast with bounds checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CommandId(pub u64);

impl CommandId {
    /// Allocate the next id from a shared counter. Used by
    /// `CommandRegistry::register` and any standalone caller that wants to
    /// keep ids monotonic across multiple `CommandRegistry`s (e.g. tests).
    pub fn next_from(counter: &AtomicU64) -> Self {
        Self(counter.fetch_add(1, Ordering::Relaxed))
    }
}

/// The semantic kind of an outbound command.
///
/// The enum is **closed** — adding a new variant forces every match arm in
/// PR-T5's response router to be revisited. That is intentional: every
/// command kind we send today has a known wire shape and a known response
/// shape; adding a new shape without touching the router would be a bug.
///
/// Variants without payload (e.g. `KillPane { pane_id }`) carry exactly the
/// args the wire builder needs. Variants that can be either fire-and-forget
/// or awaited (e.g. `DisplayVersion`) just have no payload fields — the
/// waiter (if any) lives in [`ResponseWaiter`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandKind {
    // ----- startup / probe -----------------------------------------------
    /// `display-message -p '#{version}'` — first probe; PR-T4 always
    /// sends this.
    DisplayVersion,
    /// `list-commands` — second probe; PR-T4 uses this to refine the
    /// capability matrix.
    ListCommands,
    /// `attach-session [-c target-client] [-d] [-r] [-t target-session]`.
    /// The wire builder picks `-c ""` when the
    /// `supports_attach_session_dash_c_empty` capability is set.
    AttachSession,
    /// `new-session -A` (3.2+) or `-d` fallback.
    NewSession { attach: bool },
    /// `new-window [-n name]`. Optional name.
    NewWindow { name: Option<String> },
    /// `list-windows -a -F <format>`.
    ListWindows,
    /// `list-panes [-a] [-t window] -F <format>`.
    ListPanes { window_id: Option<String> },

    // ----- runtime operations -------------------------------------------
    /// `send-keys -t %<pane> <escaped-keys>`.
    SendKeys { pane_id: String },
    /// `split-window -h|-v -t %<pane>`.
    SplitWindow { pane_id: String, horizontal: bool },
    /// `kill-pane -t %<pane>`.
    KillPane { pane_id: String },
    /// `kill-window -t @<window>`.
    KillWindow { window_id: String },
    /// `rename-window -t @<window> <new-name>`.
    RenameWindow { window_id: String, name: String },
    /// `resize-pane -t %<pane> -x <cols> -y <rows>`.
    ResizePane {
        pane_id: String,
        cols: u16,
        rows: u16,
    },
    /// `capture-pane -p -e -J -S -<lines> -t %<pane>`.
    CapturePane { pane_id: String, lines: i32 },
    /// `refresh-client [-A | -C]`. PR-T4 always uses `-C`.
    RefreshClient { control_mode: bool },
    /// `list-sessions`.
    ListSessions,
    /// Bare detach: write `\n` to tmux stdin so it closes the control
    /// session. The wire builder emits an empty newline.
    Detach,
}

/// What the caller wants to know after tmux finishes the command.
///
/// Three shapes:
///
/// - `BeginEnd(tx)` — wait for `%begin <id>` … `%end <id>` (or `%error`).
///   Used by all startup probes and any operation whose body carries
///   structured reply data (capture-pane, list-windows, ...).
/// - `Event(tx, predicate)` — wait for the *next* [`ProtocolEvent`]
///   variant that matches `predicate`. Used by `attach_session` /
///   `new_session` to wait for `%session-changed`.
/// - `None` — fire-and-forget. The command is sent; the response
///   router ignores tmux's `%begin..%end` for this id.
///
/// `Stream` was in the v0 sketch but is intentionally **not** here — the
/// response router accumulates `CommandOutput` body lines into the
/// `BeginEnd` sender's payload, so streaming is just a thin wrapper over
/// `BeginEnd` with no extra runtime support.
#[derive(Debug)]
pub enum ResponseWaiter {
    /// Await the full `%begin … %end` body for this command.
    BeginEnd(tokio::sync::oneshot::Sender<ResponseOutcome>),
    /// Await the next event matching the predicate (PR-T5+).
    /// Reserved for future use; PR-T3 wires nothing that emits it.
    #[allow(dead_code)]
    Event(
        tokio::sync::oneshot::Sender<crate::services::tmux::protocol::events::ProtocolEvent>,
    ),
}

/// Result delivered to a `BeginEnd` waiter.
///
/// `Ok` carries every body line as a single `String` (joined with `\n`),
/// already unescaped by the protocol layer. `Err` carries the `%error`
/// message tmux sent on failure (the body lines emitted before `%error`
/// are discarded by the parser, matching tmux's own semantics).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponseOutcome {
    Ok { body_lines: Vec<String> },
    Err { message: String },
}

impl ResponseOutcome {
    /// Convenience: flatten the body lines into a single string. Returns
    /// `Err(message)` for the failure path so callers don't have to
    /// branch on the outcome shape twice.
    pub fn into_body_or_err(self) -> Result<Vec<String>, String> {
        match self {
            ResponseOutcome::Ok { body_lines } => Ok(body_lines),
            ResponseOutcome::Err { message } => Err(message),
        }
    }

    /// True iff tmux reported success (`%end`).
    pub fn is_ok(&self) -> bool {
        matches!(self, ResponseOutcome::Ok { .. })
    }
}

/// One outbound command, ready to be handed to the writer task.
///
/// `id` is allocated by `CommandRegistry::register` at the same moment
/// the waiter is registered, so the writer task's `stdin_tx.send(...)`
/// produces the id and the response router's `%begin <id>` lookup
/// produces the same id — no race.
///
/// `wire` is the encoded `String` produced by the protocol wire builder
/// (see [`crate::services::tmux::protocol::wire`]). The writer task writes
/// it byte-for-byte to the tmux child's stdin.
///
/// `kind` is metadata only — it does not affect what gets written. It
/// exists for logging, tracing spans, and (in PR-T5) the response router's
/// `CommandOutput` → `PaneList` / `WindowList` classifier.
///
/// ## Why no `waiter` field?
///
/// The waiter is owned exclusively by the [`CommandRegistry`](super::id_map::CommandRegistry)
/// (one-shot, keyed by id, taken on `%end`). Embedding a clone here would
/// let two paths try to resolve the same promise; keeping it on the
/// registry avoids that ambiguity. Callers that need to wait on the result
/// receive `RegisteredCommand::waiter_already_registered: bool` and
/// arrange their own routing via `CommandRegistry::take(id)`.
#[derive(Debug)]
pub struct TaggedCommand {
    pub id: CommandId,
    pub kind: CommandKind,
    pub wire: String,
}

impl TaggedCommand {
    /// Construct a fire-and-forget command. Allocates the id from `counter`.
    pub fn fire_and_forget(
        counter: &AtomicU64,
        kind: CommandKind,
        wire: String,
    ) -> Self {
        Self {
            id: CommandId::next_from(counter),
            kind,
            wire,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_id_is_monotonic() {
        let counter = AtomicU64::new(100);
        let a = CommandId::next_from(&counter);
        let b = CommandId::next_from(&counter);
        let c = CommandId::next_from(&counter);
        assert_eq!(a.0, 100);
        assert_eq!(b.0, 101);
        assert_eq!(c.0, 102);
    }

    #[test]
    fn command_id_ordering_is_consistent() {
        let counter = AtomicU64::new(0);
        let a = CommandId::next_from(&counter);
        let b = CommandId::next_from(&counter);
        assert!(a < b);
        assert!(b > a);
    }

    #[test]
    fn fire_and_forget_command_has_no_waiter() {
        let counter = AtomicU64::new(0);
        let cmd = TaggedCommand::fire_and_forget(
            &counter,
            CommandKind::Detach,
            "\n".to_string(),
        );
        assert_eq!(cmd.id.0, 0);
        assert_eq!(cmd.wire, "\n");
    }

    #[test]
    fn response_outcome_into_body_or_err() {
        let ok = ResponseOutcome::Ok {
            body_lines: vec!["3.4".to_string()],
        };
        assert_eq!(ok.into_body_or_err().unwrap(), vec!["3.4"]);

        let err = ResponseOutcome::Err {
            message: "parse error".to_string(),
        };
        assert_eq!(err.into_body_or_err().unwrap_err(), "parse error");
    }

    #[test]
    fn response_outcome_is_ok() {
        let ok = ResponseOutcome::Ok {
            body_lines: vec![],
        };
        assert!(ok.is_ok());

        let err = ResponseOutcome::Err {
            message: "x".to_string(),
        };
        assert!(!err.is_ok());
    }

    #[test]
    fn command_kind_eq() {
        // Eq is required by HashMap/HashSet tests down the line; verify it.
        assert_eq!(CommandKind::Detach, CommandKind::Detach);
        assert_ne!(
            CommandKind::SendKeys {
                pane_id: "%5".into()
            },
            CommandKind::SendKeys {
                pane_id: "%6".into()
            }
        );
        assert_ne!(
            CommandKind::NewWindow {
                name: Some("a".into())
            },
            CommandKind::NewWindow { name: None }
        );
    }
}