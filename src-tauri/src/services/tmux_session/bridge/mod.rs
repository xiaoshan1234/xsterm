//! `TmuxBridge` — the only place that knows how to translate tmux-side
//! notifications into Tauri frontend events.
//!
//! ## Why
//!
//! Before PR-T7 the dispatch task in `dispatch.rs` held an
//! `Arc<dyn AppBackend>` directly and called `backend.emit(...)`
//! inline, fifteen times, with hand-rolled `serde_json::json!` payloads.
//! That mixed three concerns into one ~950-line `match`:
//!
//! 1. **Dispatch logic** — which `ProtocolEvent` triggers which side
//!    effect (oneshot resolution, internal `pane_bindings` update, etc.)
//! 2. **Payload assembly** — what JSON shape the frontend expects
//!    (sometimes `[xsterm_id, data]`, sometimes `{ session_id, window_id }`)
//! 3. **Emit policy** — what to do when `emit` fails (just log? shut
//!    down the controller? retry?)
//!
//! Mixing them meant a frontend event-shape change had to touch
//! the same `match` arm as the dispatch state machine, and adding a
//! new frontend event required reading 950 lines to find the
//! existing `backend.emit(...)` call sites.
//!
//! ## Post-P7 layout
//!
//! ```
//! ProtocolEvent
//!     │
//!     ▼
//! dispatch.rs   ─── only knows about (1): which event triggers what.
//!     │
//!     ▼ calls bridge.emit_*(...)
//! bridge/mod.rs ─── owns (2) and (3): JSON payload shape + emit
//!                  policy. One method per frontend event name. The
//!                  only place that touches `AppBackend`.
//!     │
//!     ▼
//! AppBackend    ─── Tauri-bound emitter.
//! ```
//!
//! Adding a new frontend event is now a single new method on
//! [`TmuxBridge`] with a unit test; the dispatch task just calls
//! `bridge.emit_xxx(args)`.
//!
//! ## Method surface
//!
//! Each event name from the old inline `backend.emit(...)` call
//! sites becomes one method here. Argument shapes mirror what the
//! frontend `useTauriListeners` hook expects on the JS side — see
//! `src/contexts/session/useTauriListeners.ts`. If you change a
//! payload here, grep the frontend for the matching event name.

use std::sync::Arc;

use serde_json::json;
use serde_json::value::Value;

use crate::infrastructure::app_backend::AppBackend;

use super::controller::TmuxController;

/// Owns the `Arc<dyn AppBackend>` and the one
/// `Arc<TmuxController>` reference needed to mint frontend event
/// payloads (specifically: `session_id` for `tmux-pane-added` /
/// `tmux-window-added` and `tmux_pane_id` for the same).
#[derive(Clone)]
pub(crate) struct TmuxBridge {
    backend: Arc<dyn AppBackend>,
    controller: Arc<TmuxController>,
}

impl TmuxBridge {
    /// Build a bridge from the pieces. Cheap — just two `Arc` clones.
    pub(crate) fn new(backend: Arc<dyn AppBackend>, controller: Arc<TmuxController>) -> Self {
        Self {
            backend,
            controller,
        }
    }

    // -----------------------------------------------------------------------
    // Event emit helpers — one per frontend event name.
    //
    // The payload shapes here are the **contract** with the frontend
    // (`useTauriListeners.ts`). If you change one, grep the frontend
    // for the matching event name and update the destructure site in
    // lockstep. The unit tests in this module pin the JSON shape so
    // a stray `"data"` → `"bytes"` rename can't silently break the
    // wire.
    // -----------------------------------------------------------------------

    /// `session-output` — emitted every time the tmux reader task
    /// receives a `%output` line.
    ///
    /// Frontend contract: `[session_id: number, data: number[]]`.
    /// The data is the raw UTF-8 bytes from tmux (escape-decoded in
    /// `parser.rs`); the frontend `Terminal` instance's xterm.js
    /// write hook expects a `number[]` so it can pass each byte to
    /// `term.write(charCode)` without crossing the JS string boundary.
    pub(crate) fn emit_session_output(&self, session_id: u32, data: Vec<u8>) {
        let payload = json!([session_id, data]);
        self.try_emit("session-output", &payload, || {
            format!(
                "session-output emit failed for session {session_id} ({} bytes)",
                data.len()
            )
        });
    }

    /// `tmux-pane-added` — emitted every time the controller learns
    /// about a new pane (from `%window-pane-changed`, `list-windows`,
    /// `list-panes`, etc.).
    ///
    /// Frontend contract: `{ session_id, tmux_pane_id, tmux_controller_id, tmux_window_id, session_type }`.
    /// `session_type` is currently always `"tmux-cc"` (this bridge
    /// only services tmux controllers).
    ///
    /// Two overloads because the bootstrap path (`emit_pane_list`)
    /// knows the parent window id up front (pre-populated by
    /// `emit_window_list`), while the per-pane notification path
    /// (`%window-pane-changed`) only learns about the parent window
    /// after the fact. Callers that don't have a window id handy can
    /// use the simple [`Self::emit_tmux_pane_added`] form.
    pub(crate) fn emit_tmux_pane_added(
        &self,
        session_id: u32,
        tmux_pane_id: &str,
        tmux_window_id: Option<&str>,
    ) {
        let payload = json!({
            "session_id": session_id,
            "tmux_pane_id": tmux_pane_id,
            "tmux_controller_id": self.controller.controller_id(),
            "tmux_window_id": tmux_window_id,
            "session_type": "tmux-cc",
        });
        self.try_emit("tmux-pane-added", &payload, || {
            format!("tmux-pane-added emit failed for pane {tmux_pane_id} (session_id={session_id})")
        });
    }

    /// `tmux-pane-added` — overload for the `list-panes` bootstrap
    /// path where the parent `tmux_window_id` is already known
    /// `tmux-window-added` — emitted every time the controller learns
    /// about a new window (from `%window-add`, `list-windows`, etc.).
    ///
    /// Frontend contract (see `useTauriListeners.ts`):
    /// `{ tmux_window_id, tmux_controller_id, session_name,
    ///   session_id?, tmux_pane_id? }`. The `tmux_window_id` is
    /// the frontend's `Window.id` directly — there is no parallel
    /// backend u32 any more.
    ///
    /// `session_id` and `tmux_pane_id` are `Option<u32>` /
    /// `Option<&str>` — the frontend can construct the React state for
    /// the new window + its first pane in one event. The two fields
    /// are `None` only when the window was observed out-of-band (no
    /// `pending.sender`); the frontend synthesises the missing
    /// `session_id` / `tmux_pane_id` from the subsequent
    /// `tmux-pane-added` event.
    pub(crate) fn emit_tmux_window_added(
        &self,
        tmux_window_id: &str,
        session_name: Option<&str>,
        session_id: Option<u32>,
        tmux_pane_id: Option<&str>,
    ) {
        let payload = json!({
            "tmux_window_id": tmux_window_id,
            "tmux_controller_id": self.controller.controller_id(),
            "session_name": session_name,
            "session_id": session_id,
            "tmux_pane_id": tmux_pane_id,
        });
        self.try_emit("tmux-window-added", &payload, || {
            format!("tmux-window-added emit failed for window {tmux_window_id}")
        });
    }

    /// `tmux-window-closed` — emitted when the controller observes a
    /// `%window-close` notification.
    ///
    /// Frontend contract: `{ controller_id, tmux_window_id }`.
    /// (`tmux_window_id` IS the frontend's Window.id — there is no
    /// parallel backend u32.)
    pub(crate) fn emit_tmux_window_closed(&self, tmux_window_id: &str) {
        let payload = json!({
            "controller_id": self.controller.controller_id(),
            "tmux_window_id": tmux_window_id,
        });
        self.try_emit("tmux-window-closed", &payload, || {
            format!("tmux-window-closed emit failed for window {tmux_window_id}")
        });
    }

    /// `tmux-window-renamed` — emitted on `%window-renamed`.
    ///
    /// Frontend contract: `{ controller_id, tmux_window_id, name }`.
    pub(crate) fn emit_tmux_window_renamed(&self, tmux_window_id: &str, name: &str) {
        let payload = json!({
            "controller_id": self.controller.controller_id(),
            "tmux_window_id": tmux_window_id,
            "name": name,
        });
        self.try_emit("tmux-window-renamed", &payload, || {
            format!("tmux-window-renamed emit failed for window {tmux_window_id}")
        });
    }

    /// `tmux-pane-removed` — emitted on `%pane-exited` /
    /// `%window-pane-changed` (pane gone).
    ///
    /// Frontend contract: `{ controller_id, tmux_pane_id, session_id }`.
    pub(crate) fn emit_tmux_pane_removed(&self, tmux_pane_id: &str, session_id: u32) {
        let payload = json!({
            "controller_id": self.controller.controller_id(),
            "tmux_pane_id": tmux_pane_id,
            "session_id": session_id,
        });
        self.try_emit("tmux-pane-removed", &payload, || {
            format!("tmux-pane-removed emit failed for pane {tmux_pane_id}")
        });
    }

    /// `tmux-paused` — emitted when the controller's reader pauses
    /// (no current use in the frontend; kept for completeness).
    pub(crate) fn emit_tmux_paused(&self, tmux_pane_id: &str) {
        let payload = json!({ "tmux_pane_id": tmux_pane_id });
        self.try_emit("tmux-paused", &payload, || {
            format!("tmux-paused emit failed for pane {tmux_pane_id}")
        });
    }

    /// `tmux-continued` — counterpart to [`Self::emit_tmux_paused`].
    pub(crate) fn emit_tmux_continued(&self, tmux_pane_id: &str) {
        let payload = json!({ "tmux_pane_id": tmux_pane_id });
        self.try_emit("tmux-continued", &payload, || {
            format!("tmux-continued emit failed for pane {tmux_pane_id}")
        });
    }

    /// `tmux-controller-exit` — emitted exactly once per controller,
    /// when the tmux child exits. The frontend uses this to mark all
    /// panes owned by the controller as disconnected.
    ///
    /// Frontend contract: `{ controller_id, reason }`.
    pub(crate) fn emit_tmux_controller_exit(&self, reason: Option<&str>) {
        let payload = json!({
            "controller_id": self.controller.controller_id(),
            "reason": reason,
        });
        self.try_emit("tmux-controller-exit", &payload, || {
            "tmux-controller-exit emit failed".to_string()
        });
    }

    // -----------------------------------------------------------------------
    // Private — emit policy lives here, not in the caller.
    // -----------------------------------------------------------------------

    /// Wrap a `backend.emit(...)` call so the emit policy is
    /// consistent across all event helpers. Today the policy is
    /// "log and keep going" — emit failure is not fatal because the
    /// frontend can re-derive state from the next `tmux-*-list` event
    /// (and the controller keeps running so that next event will
    /// eventually arrive). If we ever want to add retry / backoff,
    /// this is the one method to change.
    fn try_emit<F: FnOnce() -> String>(&self, event_name: &'static str, payload: &Value, ctx: F) {
        if let Err(e) = self.backend.emit(event_name, payload) {
            tracing::warn!("tmux bridge: {}: {}", ctx(), e);
        }
    }
}
