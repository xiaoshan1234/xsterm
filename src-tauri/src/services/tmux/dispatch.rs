//! tmux dispatch task — turns parsed [`ControlEvent`]s into
//! [`AppBackend`] emits.
//!
//! Split out from `controller.rs` so the 566-line match expression that
//! implements the dispatch routing does not crowd the
//! `TmuxController` struct itself. The dispatch task is the only
//! thing in the controller that mutates `pane_bindings`,
//! `window_bindings`, and the per-controller Promise coordinators
//! (`pending_splits`, `pending_windows`, `pending_window_pane`,
//! `pending_capture`); see `super::controller` for the data fields.
//!
//! ## Routing cheat sheet
//!
//! `dispatch_event` walks a match on `ControlEvent`. The two most
//! complex branches are:
//!
//! - **`%window-pane-changed` (five-level fallthrough)**
//!   1. already-bound → ignore (tmux re-emits on active-pane switch)
//!   2. split-result → resolve a `pending_splits` oneshot
//!   3. new-window / bootstrap → resolve a `pending_window_pane` entry
//!   4. bootstrap fallback (Wave 1/2 legacy)
//!   5. external pane → log only (no auto-bind)
//!
//! - **`%window-add` (three-case trichotomy)**
//!   a. `pending_windows` non-empty → user-driven new-window
//!   b. controller has not seen any window yet → bootstrap window
//!   c. otherwise → external new-window → log only
//!
//! All other branches either route to a Promise coordinator
//! (`capture_pane`'s `%begin..%end` block) or emit a single Tauri
//! event. The unknown branch logs and drops.

use std::sync::Arc;

use tokio::sync::mpsc;

use crate::infrastructure::app_backend::AppBackend;

use super::controller::{PendingWindow, TmuxController};
use super::events::ControlEvent;

/// Spawn the dispatch task that turns parsed [`ControlEvent`]s into
/// [`AppBackend`] emits.
///
/// `pub(crate)` so unit tests in `services::session_manager` (and any
/// future sibling crate) can drive the dispatch task with synthetic
/// events without going through a real `tmux -CC` child.
pub(crate) fn spawn_dispatch_task(
    mut dispatch_rx: mpsc::UnboundedReceiver<ControlEvent>,
    controller: Arc<TmuxController>,
    app_backend: Arc<dyn AppBackend>,
    controller_id: u32,
) {
    tokio::spawn(async move {
        while let Some(event) = dispatch_rx.recv().await {
            dispatch_event(&controller, app_backend.as_ref(), controller_id, event);
        }
        tracing::debug!(
            "tmux controller {}: dispatch channel closed, exiting",
            controller_id
        );
    });
}

/// Interpret one [`ControlEvent`] and emit the corresponding frontend
/// events via [`AppBackend`].
fn dispatch_event(
    controller: &Arc<TmuxController>,
    backend: &dyn AppBackend,
    controller_id: u32,
    event: ControlEvent,
) {
    match event {
        ControlEvent::Output { pane_id, data } => {
            if let Some(xsterm_id) = controller.xsterm_id_for_pane(&pane_id) {
                if let Err(e) = backend.emit(
                    "session-output",
                    &serde_json::json!([xsterm_id, data]),
                ) {
                    tracing::error!(
                        "tmux controller {}: session-output emit failed for pane {}: {}",
                        controller_id,
                        pane_id,
                        e
                    );
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: dropping %output for unknown pane {} ({} bytes)",
                    controller_id,
                    pane_id,
                    data.len()
                );
            }
        }
        ControlEvent::WindowPaneChanged {
            window_id,
            pane_id,
        } => {
            // 1. Re-sighting of an already-bound pane → ignore (tmux
            //    re-emits `%window-pane-changed` whenever the active pane
            //    of a window changes, including panes we already own).
            let already_bound = controller
                .pane_bindings
                .lock()
                .map(|m| m.contains_key(&pane_id))
                .unwrap_or(false);
            if already_bound {
                return;
            }

            // 2. Split-result path. A `pending_splits` sender exists →
            //    this `%window-pane-changed` is the reply to our own
            //    `split-window` request. Pop the front sender, allocate a
            //    fresh xsterm id, register the binding, emit
            //    `tmux-pane-added`, and resolve the oneshot.
            let pending_tx = controller
                .pending_splits
                .lock()
                .ok()
                .and_then(|mut q| {
                    if q.is_empty() {
                        None
                    } else {
                        q.pop_front()
                    }
                });
            if let Some(tx) = pending_tx {
                let xsterm_id = controller.allocate_xsterm_id();
                controller.register_pane(pane_id.clone(), xsterm_id);
                controller.record_pane_window(pane_id.clone(), window_id.clone());
                if let Err(e) = backend.emit(
                    "tmux-pane-added",
                    &serde_json::json!({
                        "controller_id": controller_id,
                        "tmux_pane_id": pane_id,
                        "xsterm_session_id": xsterm_id,
                        "parent_tmux_window_id": window_id,
                    }),
                ) {
                    tracing::error!(
                        "tmux controller {}: tmux-pane-added emit failed: {}",
                        controller_id,
                        e
                    );
                }
                let _ = tx.send(Ok((xsterm_id, pane_id.clone(), window_id.clone())));
                return;
            }

            // 3. Wave 3 new-window / bootstrap path. A `pending_window_pane`
            //    entry exists for this window → this `%window-pane-changed`
            //    is either the bootstrap window's first pane or the first
            //    pane of a user-driven `new-window` request. Allocate a
            //    fresh xsterm session id, register the binding, move the
            //    pending entry into `window_bindings`, emit
            //    `tmux-pane-added` (always), and — for user-driven
            //    `new-window` only — emit `tmux-window-added` and resolve
            //    the pending sender.
            let pending_window = controller
                .pending_window_pane
                .lock()
                .ok()
                .and_then(|mut m| m.remove(&window_id));
            if let Some(pending) = pending_window {
                let xsterm_id = controller.allocate_xsterm_id();
                controller.register_pane(pane_id.clone(), xsterm_id);
                controller.record_pane_window(pane_id.clone(), window_id.clone());
                if let Ok(mut bindings) = controller.window_bindings.lock() {
                    bindings.insert(window_id.clone(), pending.xsterm_window_id);
                }
                if let Err(e) = backend.emit(
                    "tmux-pane-added",
                    &serde_json::json!({
                        "controller_id": controller_id,
                        "tmux_pane_id": pane_id,
                        "xsterm_session_id": xsterm_id,
                        "parent_tmux_window_id": window_id,
                    }),
                ) {
                    tracing::error!(
                        "tmux controller {}: tmux-pane-added emit failed: {}",
                        controller_id,
                        e
                    );
                }
                if let Some(tx) = pending.sender {
                    if let Err(e) = backend.emit(
                        "tmux-window-added",
                        &serde_json::json!({
                            "controller_id": controller_id,
                            "tmux_window_id": window_id,
                            "xsterm_window_id": pending.xsterm_window_id,
                            "xsterm_session_id": xsterm_id,
                            "xsterm_pane_id": pane_id,
                        }),
                    ) {
                        tracing::error!(
                            "tmux controller {}: tmux-window-added emit failed: {}",
                            controller_id,
                            e
                        );
                    }
                    let _ = tx.send(Ok((
                        pending.xsterm_window_id,
                        window_id.clone(),
                        xsterm_id,
                        pane_id.clone(),
                    )));
                } else {
                    // Bootstrap window — the frontend already has the
                    // matching xsterm Window (created during
                    // `create_tmux_session`). We do NOT emit
                    // `tmux-window-added`; we just need the dispatch
                    // task to register the first pane so
                    // `await_first_pane` resolves.
                    controller.record_first_pane(xsterm_id, pane_id.clone());
                }
                return;
            }

            // 4. Bootstrap path (legacy Wave 1/2 fallback). Kept as a
            //    safety net for cases where `%window-add` was missed for
            //    some reason (e.g. an old test that drives the dispatch
            //    task without going through a real tmux binary).
            let first = controller
                .first_pane_tx
                .lock()
                .map(|m| m.is_some())
                .unwrap_or(false);
            if first {
                let xsterm_id = controller.allocate_xsterm_id();
                controller.register_pane(pane_id.clone(), xsterm_id);
                controller.record_pane_window(pane_id.clone(), window_id.clone());
                controller.record_first_pane(xsterm_id, pane_id.clone());
                if let Err(e) = backend.emit(
                    "tmux-pane-added",
                    &serde_json::json!({
                        "controller_id": controller_id,
                        "tmux_pane_id": pane_id,
                        "xsterm_session_id": xsterm_id,
                        "parent_tmux_window_id": window_id,
                    }),
                ) {
                    tracing::error!(
                        "tmux controller {}: tmux-pane-added emit failed: {}",
                        controller_id,
                        e
                    );
                }
                return;
            }

            // 5. External pane creation. tmux reports a brand-new pane
            //    that we did not ask for (e.g. the user ran a `splitw`
            //    binding inside the inner shell, or the inner shell
            //    spawned a child process). Out of scope to auto-bind —
            //    the frontend's pane tree does not know about them and
            //    rendering them out-of-band would desync from React
            //    state. We just log; a future iteration may add a
            //    re-bind UI.
            tracing::debug!(
                "tmux controller {}: external %window-pane-changed for pane {} in window {} — not auto-binding",
                controller_id,
                pane_id,
                window_id
            );
        }
        ControlEvent::WindowAdd { window_id } => {
            // Three-case trichotomy (Wave 3 §4.4):
            //
            // a. `pending_windows` non-empty → this `%window-add` is the
            //    reply to our own `new-window` request. Pop the front
            //    sender, allocate a fresh xsterm window id, stash it in
            //    `pending_window_pane` (the dispatch task resolves on the
            //    matching `%window-pane-changed`), and wait.
            //
            // b. `pending_windows` empty AND the controller has not yet
            //    observed any window → this is the bootstrap window
            //    tmux creates on `tmux -CC new-session`. Allocate a
            //    fresh xsterm window id, stash it in
            //    `pending_window_pane` with `sender: None`. The dispatch
            //    task will record the bootstrap first pane in
            //    `await_first_pane` and populate `window_bindings` on
            //    the matching `%window-pane-changed` without emitting
            //    `tmux-window-added` (the frontend already owns the
            //    corresponding xsterm Window).
            //
            // c. Otherwise → external new-window (user typed `:new-window`
            //    in tmux manually, or some other out-of-band path).
            //    Out of scope to auto-bind (see case 4/5 above); we log
            //    and skip.
            let pending_tx = controller
                .pending_windows
                .lock()
                .ok()
                .and_then(|mut q| {
                    if q.is_empty() {
                        None
                    } else {
                        q.pop_front()
                    }
                });
            if let Some(tx) = pending_tx {
                let xsterm_window_id = controller.allocate_xsterm_window_id();
                if let Ok(mut pending) = controller.pending_window_pane.lock() {
                    pending.insert(
                        window_id.clone(),
                        PendingWindow {
                            xsterm_window_id,
                            sender: Some(tx),
                        },
                    );
                }
                // No event yet — we need the matching `%window-pane-changed`
                // for the first pane of the new window so the
                // `tmux-window-added` payload can carry a valid
                // `xsterm_pane_id` / `xsterm_session_id`.
                return;
            }
            let is_first_window = controller.window_bindings.lock().map(|m| m.is_empty()).unwrap_or(true)
                && controller
                    .pending_window_pane
                    .lock()
                    .map(|m| m.is_empty())
                    .unwrap_or(true);
            if is_first_window {
                let xsterm_window_id = controller.allocate_xsterm_window_id();
                if let Ok(mut pending) = controller.pending_window_pane.lock() {
                    pending.insert(
                        window_id.clone(),
                        PendingWindow {
                            xsterm_window_id,
                            sender: None,
                        },
                    );
                }
                tracing::debug!(
                    "tmux controller {}: bootstrap %window-add for window {} — xsterm_window_id={}",
                    controller_id,
                    window_id,
                    xsterm_window_id
                );
                return;
            }
            tracing::debug!(
                "tmux controller {}: external %window-add for window {} — not auto-binding",
                controller_id,
                window_id,
            );
        }
        ControlEvent::WindowClose { window_id } => {
            // Look up the xsterm window id for the closing window. If we
            // never bound it (e.g. external window), there is nothing to
            // emit.
            let xsterm_window_id = controller
                .window_bindings
                .lock()
                .ok()
                .and_then(|mut m| m.remove(&window_id));
            if let Some(xsterm_window_id) = xsterm_window_id {
                // Defensive cleanup: also drop any pane bindings that
                // belonged to this window so a subsequent `send_keys` /
                // `resize_pane` for one of them fails fast instead of
                // silently succeeding into a dead child. tmux emits
                // `%pane-exited` for each pane AFTER `%window-close` so
                // the dispatch task would normally drop them via the
                // `PaneExited` branch — but if those events arrive late
                // or out-of-order, we already removed the bindings here.
                if let Ok(mut pane_window_map) = controller.pane_window_bindings.lock() {
                    let to_drop: Vec<String> = pane_window_map
                        .iter()
                        .filter_map(|(pane, win)| (win == &window_id).then(|| pane.clone()))
                        .collect();
                    for pane in &to_drop {
                        pane_window_map.remove(pane);
                    }
                    if let Ok(mut pane_map) = controller.pane_bindings.lock() {
                        for pane in &to_drop {
                            pane_map.remove(pane);
                        }
                    }
                }
                if let Err(e) = backend.emit(
                    "tmux-window-closed",
                    &serde_json::json!({
                        "controller_id": controller_id,
                        "tmux_window_id": window_id,
                        "xsterm_window_id": xsterm_window_id,
                    }),
                ) {
                    tracing::error!(
                        "tmux controller {}: tmux-window-closed emit failed: {}",
                        controller_id,
                        e
                    );
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: %window-close for unbound window {} — no tmux-window-closed emitted",
                    controller_id,
                    window_id,
                );
            }
        }
        ControlEvent::WindowRenamed { window_id, name } => {
            let xsterm_window_id = controller
                .window_bindings
                .lock()
                .ok()
                .and_then(|m| m.get(&window_id).copied());
            if let Some(xsterm_window_id) = xsterm_window_id {
                if let Err(e) = backend.emit(
                    "tmux-window-renamed",
                    &serde_json::json!({
                        "controller_id": controller_id,
                        "tmux_window_id": window_id,
                        "xsterm_window_id": xsterm_window_id,
                        "name": name,
                    }),
                ) {
                    tracing::error!(
                        "tmux controller {}: tmux-window-renamed emit failed: {}",
                        controller_id,
                        e
                    );
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: %window-renamed for unbound window {} — no tmux-window-renamed emitted",
                    controller_id,
                    window_id,
                );
            }
        }
        // `pane_id` is borrowed via `ref pane_id` so `event` itself
        // stays whole — we still need `&event` below to read the
        // variant tag for the debug log on unbound panes.
        ControlEvent::PaneExited { ref pane_id } | ControlEvent::PaneDied { ref pane_id } => {
            let event_kind = match &event {
                ControlEvent::PaneExited { .. } => "%pane-exited",
                ControlEvent::PaneDied { .. } => "%pane-died",
                _ => unreachable!("guarded by outer match"),
            };
            // Look up the xsterm id for the dying pane. If we never
            // bound it (e.g. external pane from case 4 above), there is
            // nothing to emit.
            let xsterm_id = controller.xsterm_id_for_pane(pane_id);
            // Drop the binding eagerly so a subsequent `send_keys` /
            // `resize_pane` for this pane fails fast instead of silently
            // succeeding into a dead child.
            if let Ok(mut map) = controller.pane_bindings.lock() {
                map.remove(pane_id);
            }
            if let Ok(mut map) = controller.pane_window_bindings.lock() {
                map.remove(pane_id);
            }
            if let Some(xsterm_id) = xsterm_id {
                if let Err(e) = backend.emit(
                    "tmux-pane-removed",
                    &serde_json::json!({
                        "controller_id": controller_id,
                        "tmux_pane_id": pane_id,
                        "xsterm_session_id": xsterm_id,
                    }),
                ) {
                    tracing::error!(
                        "tmux controller {}: tmux-pane-removed emit failed: {}",
                        controller_id,
                        e
                    );
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: {} for unbound pane {} — no tmux-pane-removed emitted",
                    controller_id,
                    event_kind,
                    pane_id
                );
            }
        }
        ControlEvent::Pause { pane_id } => {
            if let Err(e) = backend.emit(
                "tmux-paused",
                &serde_json::json!({ "tmux_pane_id": pane_id }),
            ) {
                tracing::error!(
                    "tmux controller {}: tmux-paused emit failed: {}",
                    controller_id,
                    e
                );
            }
        }
        ControlEvent::Continue { pane_id } => {
            if let Err(e) = backend.emit(
                "tmux-continued",
                &serde_json::json!({ "tmux_pane_id": pane_id }),
            ) {
                tracing::error!(
                    "tmux controller {}: tmux-continued emit failed: {}",
                    controller_id,
                    e
                );
            }
        }
        ControlEvent::Exit { reason } => {
            if let Err(e) = backend.emit(
                "tmux-controller-exit",
                &serde_json::json!({
                    "controller_id": controller_id,
                    "reason": reason,
                }),
            ) {
                tracing::error!(
                    "tmux controller {}: tmux-controller-exit emit failed: {}",
                    controller_id,
                    e
                );
            }
        }
        // capture-pane Promise coordination. The four
        // `Command*` events below form the synchronous reply envelope for
        // any tmux command that prints to stdout (currently only our
        // `capture-pane`, but architecturally also `list-windows` /
        // `list-sessions` / etc.). The dispatch task routes the block
        // to `pending_capture` only when a `capture_pane` call is in
        // flight; otherwise the events are debug-logged and dropped (we
        // don't fire-and-forget any other stdout-producing commands
        // yet, so this is observably correct).
        ControlEvent::CommandBegin { id, .. } => {
            // Reset the body buffer regardless of whether we're tracking
            // a capture — any leftover lines from a previous (orphaned)
            // block must not bleed into this one.
            if let Ok(mut body) = controller.pending_capture_body.lock() {
                body.clear();
            }
            let has_capture = controller
                .pending_capture
                .lock()
                .map(|s| s.is_some())
                .unwrap_or(false);
            if !has_capture {
                tracing::debug!(
                    "tmux controller {}: %begin {} for unrelated command (no pending capture)",
                    controller_id,
                    id
                );
            }
        }
        ControlEvent::CommandOutput { id, ref line } => {
            let has_capture = controller
                .pending_capture
                .lock()
                .map(|s| s.is_some())
                .unwrap_or(false);
            if has_capture {
                if let Ok(mut body) = controller.pending_capture_body.lock() {
                    body.push(line.clone());
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: %output for command {} (no pending capture, body line dropped)",
                    controller_id,
                    id
                );
            }
        }
        ControlEvent::CommandEnd { id, .. } => {
            let mut slot = match controller.pending_capture.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(tx) = slot.take() {
                let body = controller
                    .pending_capture_body
                    .lock()
                    .map(|mut b| std::mem::take(&mut *b))
                    .unwrap_or_default();
                let text = body.join("\n");
                let _ = tx.send(Ok(text));
                tracing::debug!(
                    "tmux controller {}: capture-pane %end id={} ({} body lines)",
                    controller_id,
                    id,
                    body.len()
                );
            } else {
                tracing::debug!(
                    "tmux controller {}: %end for command {} (no pending capture)",
                    controller_id,
                    id
                );
            }
        }
        ControlEvent::CommandError {
            id,
            message,
            ..
        } => {
            let mut slot = match controller.pending_capture.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(tx) = slot.take() {
                let _ = tx.send(Err(format!(
                    "tmux controller {}: capture-pane failed (id={}): {message}",
                    controller_id, id
                )));
                if let Ok(mut body) = controller.pending_capture_body.lock() {
                    body.clear();
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: %error for command {} (no pending capture): {message}",
                    controller_id,
                    id
                );
            }
        }
        // All other events are observation-only and have no controller-side
        // backend emit. They are logged for debug purposes so a missed
        // case is visible in the rolling log file.
        _ => {
            tracing::debug!(
                "tmux controller {}: ignoring event {:?}",
                controller_id,
                event
            );
        }
    }
}
