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

/// The semantic kind of an outbound command. The enum is **closed** —
/// adding a new variant forces every match arm in the response router
/// to be revisited. Only `CapturePane` is constructed by production
/// code today; the other variants were dropped when the PR-T4
/// handshake scaffolding was removed.
#[allow(dead_code)] // `CapturePane` is only constructed by production code paths today
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandKind {
    /// `capture-pane -p -e -J -S -<lines> -t %<pane>`.
    CapturePane { pane_id: String, lines: i32 },
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
        tokio::sync::oneshot::Sender<
            crate::services::tmux_session::protocol::events::ProtocolEvent,
        >,
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

/// What an event-correlated waiter is waiting for.
///
/// P8 W3b: this is the registry's second correlation mode. Alongside
/// the command-id-keyed [`ResponseWaiter`] (resolved by `%begin..%end`),
/// the controller also needs waiters resolved by **events** —
/// specifically `%window-pane-changed` and `%window-add`. tmux does not
/// respond to `split-window` / `new-window` with a `%begin..%end` block;
/// it responds with notification events whose payload identifies the
/// newly-created pane / window. These waiters live in a separate FIFO
/// inside [`crate::services::tmux::controller::id_map::CommandRegistry`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventWaiterKind {
    /// Resolved by the next `%window-pane-changed` event (FIFO across
    /// all `SplitResult` waiters with `tmux_window_id == None`).
    /// Created by [`crate::services::tmux::controller::TmuxController::split_pane`].
    SplitResult,
    /// Resolved in two phases: first by `%window-add` (which moves the
    /// entry from "no window_id" to "keyed by window_id"), then by the
    /// matching `%window-pane-changed` for that window_id. Created by
    /// [`crate::services::tmux::controller::TmuxController::new_window`].
    NewWindowResult,
    /// Bootstrap-only: `%window-pane-changed` for the very first window
    /// the controller sees, no sender attached. Created by the
    /// dispatch task's `WindowAdd` case (b) when no `pending_windows`
    /// sender exists, and by the `list-windows` response handler
    /// (`emit_window_list`) for every window the server reports in the
    /// attach path. The dispatch handler resolves this by populating
    /// `window_bindings` so `await_first_pane`'s separate
    /// `first_pane_tx` mechanism (still owned by the controller) takes
    /// over on the next `%window-pane-changed`.
    Bootstrap,
}

/// What the dispatch event handler resolves an [`EventWaiter`] with.
///
/// The `Sender` carries the typed channel back to the awaiting public
/// method (`split_pane` / `new_window`). The `None` variant exists
/// because bootstrap windows have no caller awaiting a result — the
/// frontend already owns the matching xsterm Window.
#[derive(Debug)]
pub enum EventWaiterSender {
    /// Back-channel for [`crate::services::tmux::controller::TmuxController::split_pane`].
    Split(tokio::sync::oneshot::Sender<crate::services::tmux_session::controller::SplitResult>),
    /// Back-channel for [`crate::services::tmux::controller::TmuxController::new_window`].
    NewWindow(
        tokio::sync::oneshot::Sender<crate::services::tmux_session::controller::NewWindowResult>,
    ),
    /// Bootstrap has no sender — the dispatch handler just removes the
    /// entry so `await_first_pane`'s separate `first_pane_tx` mechanism
    /// resolves on the next `%window-pane-changed`.
    None,
}

/// One outstanding event-correlated waiter.
///
/// Lives in the controller's [`CommandRegistry`](crate::services::tmux::controller::id_map::CommandRegistry)
/// `event_waiters` FIFO. The dispatch task resolves waiters by matching
/// against `kind` and `tmux_window_id`:
///
/// - `SplitResult` + `tmux_window_id: None` → next `%window-pane-changed`
/// - `NewWindowResult` + `tmux_window_id: None` → next `%window-add`
///   (then re-registered keyed by the new `window_id` for the
///   `%window-pane-changed` resolution)
/// - `NewWindowResult` or `Bootstrap` + `tmux_window_id: Some(id)` →
///   next `%window-pane-changed` whose `window_id == id`
#[derive(Debug)]
pub struct EventWaiter {
    /// Which event resolves this waiter.
    pub kind: EventWaiterKind,
    /// The typed back-channel to the awaiting caller. Bootstrap entries
    /// use `EventWaiterSender::None` (no caller is awaiting).
    pub sender: EventWaiterSender,
    /// `None` = pop FIFO on next matching event. `Some(window_id)` =
    /// pop only when the matching event's `window_id` matches. `None`
    /// is the initial state for `NewWindowResult`; `WindowAdd` rewrites
    /// it to `Some(<new window_id>)` so the subsequent
    /// `%window-pane-changed` for that window resolves it.
    pub tmux_window_id: Option<String>,
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
#[derive(Debug)]
pub struct TaggedCommand {
    pub id: CommandId,
    pub wire: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_kind_capture_pane_eq() {
        // Eq is required by HashMap/HashSet tests in id_map.rs; verify
        // the only remaining variant derives it correctly.
        assert_eq!(
            CommandKind::CapturePane {
                pane_id: "%5".into(),
                lines: 100,
            },
            CommandKind::CapturePane {
                pane_id: "%5".into(),
                lines: 100,
            }
        );
        assert_ne!(
            CommandKind::CapturePane {
                pane_id: "%5".into(),
                lines: 100,
            },
            CommandKind::CapturePane {
                pane_id: "%6".into(),
                lines: 100,
            }
        );
    }
}
