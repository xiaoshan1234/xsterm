//! Strongly-typed envelope for every notification line emitted by a tmux
//! `-CC` (control mode) child process.
//!
//! Each variant mirrors one line of the tmux wire protocol — see
//! `doc/requirements/prd-0.1/req-006-tmux.md` §3.2 / §3.3 for the source
//! grammar. Every variant carries **decoded** payload data: octal escapes in
//! `%output` / `%extended-output` are unescaped into raw `Vec<u8>` by
//! [`crate::services::tmux::protocol::parser::ProtocolParser`] before this
//! enum is constructed, so downstream consumers never have to think about
//! escaping.
//!
//! Fields are intentionally `String` (not `&str`) and `Vec<u8>` (not `&[u8]`)
//! because events cross a `mpsc::UnboundedSender` boundary and need to own
//! their data; ownership transfers cheaply because the parser already paid
//! the allocation cost when decoding the line.
//!
//! ## History
//!
//! Originally `crate::services::tmux::events::ControlEvent`. Renamed to
//! `ProtocolEvent` and moved under `protocol/` in PR-T1. The old
//! `ControlEvent` name is preserved as a deprecated type alias in the
//! top-level `tmux/mod.rs` shim until PR-T5 removes it.

/// One event produced by the tmux control-mode line parser.
///
/// Lifetime: events are produced by
/// [`ProtocolParser::feed`](crate::services::tmux::protocol::parser::ProtocolParser::feed)
/// and sent over an unbounded channel to the [`TmuxController`](crate::services::tmux::controller::TmuxController)
/// dispatch task, which translates them into Tauri events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolEvent {
    /// `%output %<pane_id> <escaped-data>` — bytes produced by the pane's
    /// shell. `data` is **decoded** (octal escapes already expanded).
    Output { pane_id: String, data: Vec<u8> },

    /// `%extended-output %<pane_id> <age_ms> ... : <escaped-data>` — output
    /// generated some time in the past (`age_ms` milliseconds). The
    /// `: <data>` payload is decoded just like [`Output`].
    ExtendedOutput {
        pane_id: String,
        age_ms: u64,
        data: Vec<u8>,
    },

    /// `%session-changed $<id> <name>` — client attached to this session.
    SessionChanged { session_id: String, name: String },

    /// `%session-renamed $<id> <name>`.
    SessionRenamed { session_id: String, name: String },

    /// `%session-closed $<id>` — session removed.
    SessionClosed { session_id: String },

    /// `%session-window-changed $<id> @<id>` — the session's active window
    /// changed.
    SessionWindowChanged {
        session_id: String,
        window_id: String,
    },

    /// `%sessions-changed` — global "the sessions list may have changed"
    /// notification; clients usually re-run `list-sessions`.
    SessionsChanged,

    /// `%window-add @<id>`.
    WindowAdd { window_id: String },

    /// `%window-close @<id>`.
    WindowClose { window_id: String },

    /// `%window-renamed @<id> <name>`.
    WindowRenamed { window_id: String, name: String },

    /// `%window-pane-changed @<id> %<id>` — the window's active pane changed.
    WindowPaneChanged { window_id: String, pane_id: String },

    /// `%unlinked-window-add @<id>` — window that is not linked to any session.
    UnlinkedWindowAdd { window_id: String },

    /// `%unlinked-window-close @<id>`.
    UnlinkedWindowClose { window_id: String },

    /// `%layout-change @<id> <layout> <visible-layout> <flags>` — window
    /// layout updated. `layout` / `visible_layout` are tmux's `#{window_layout}`
    /// strings; `flags` is the literal flag field from the protocol.
    LayoutChange {
        window_id: String,
        layout: String,
        visible_layout: String,
        flags: String,
    },

    /// `%pane-mode-changed %<id>` — pane entered / left a mode (copy-mode,
    /// view-mode, etc.).
    PaneModeChanged { pane_id: String },

    /// `%pane-exited %<id>` — the pane's program exited cleanly.
    PaneExited { pane_id: String },

    /// `%pane-died %<id>` — the pane died abnormally (signal, crash, ...).
    PaneDied { pane_id: String },

    /// `%paste-buffer-changed <name>`.
    PasteBufferChanged { buffer_name: String },

    /// `%client-detached <client>` — a client detached from the server.
    ClientDetached { client: String },

    /// `%client-session-changed <client> <session_id> <name>`.
    ClientSessionChanged {
        client: String,
        session_id: String,
        name: String,
    },

    /// `%exit [reason]` — control-mode session is shutting down. `reason`
    /// is `None` when tmux sent the bare `%exit` form.
    Exit { reason: Option<String> },

    /// `%config-error <msg>` — server rejected a config option on reload.
    ConfigError { message: String },

    /// `%pause %<pane_id>` — server paused sending output for this pane
    /// (consumer is too slow). Used to apply backpressure (see perf.md Perf 003).
    Pause { pane_id: String },

    /// `%continue %<pane_id>` — server resumed output for this pane.
    Continue { pane_id: String },

    /// `%begin <ts> <id> <flags>` — start of a synchronous command reply
    /// block. Lines between this and the matching `%end`/`%error` are
    /// delivered as [`ProtocolEvent::CommandOutput`].
    CommandBegin { id: u32, timestamp: u64, flags: u32 },

    /// `%end <ts> <id> <flags>` — matching terminator for a prior
    /// [`ProtocolEvent::CommandBegin`].
    CommandEnd { id: u32, timestamp: u64, flags: u32 },

    /// `%error <ts> <id> <flags> <msg>` — command reply failed; the body
    /// lines emitted before this are dropped (the parser clears its in-block
    /// state on error).
    CommandError {
        id: u32,
        timestamp: u64,
        flags: u32,
        message: String,
    },

    /// One body line inside a `%begin %<id>` … `%end/%error %<id>` block.
    /// `line` preserves tmux's exact bytes (UTF-8); trailing newlines have
    /// been stripped by the line reader already.
    CommandOutput { id: u32, line: String },

    /// `%popup-open ...` (tmux 3.4+). Fields kept as raw `String`s so we
    /// can support future tmux versions without an enum bump.
    PopupOpen { line: String },

    /// `%popup-output ...` (tmux 3.4+).
    PopupOutput { line: String },

    /// `%popup-close ...` (tmux 3.4+).
    PopupClose { line: String },

    /// Anything starting with `%` that is not a recognised event. Carried
    /// verbatim so log consumers can see what tmux sent without dropping
    /// information. The controller never crashes on unknown events.
    Unknown { line: String },
}
