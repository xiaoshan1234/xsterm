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
use super::errors::TmuxError;
use super::bridge::TmuxBridge;
use super::events::ControlEvent;
use serde_json::json;

/// Spawn the dispatch task that turns parsed [`ControlEvent`]s into
/// [`AppBackend`] emits.
///
/// `pub(crate)` so unit tests in `services::session_manager` (and any
/// future sibling crate) can drive the dispatch task with synthetic
/// events without going through a real `tmux -CC` child.
pub(crate) fn spawn_dispatch_task(
    mut dispatch_rx: mpsc::UnboundedReceiver<ControlEvent>,
    controller: Arc<TmuxController>,
    bridge: TmuxBridge,
) {
    tokio::spawn(async move {
        while let Some(event) = dispatch_rx.recv().await {
            dispatch_event(&controller, &bridge, event);
        }
        tracing::debug!(
            "tmux controller {}: dispatch channel closed, exiting",
            controller.controller_id()
        );
    });
}

/// Interpret one [`ControlEvent`] and emit the corresponding frontend
/// events via [`TmuxBridge`].
fn dispatch_event(
    controller: &Arc<TmuxController>,
    bridge: &TmuxBridge,
    event: ControlEvent,
) {
    tracing::info!(
        "tmux dispatch: controller {} received event: {:?}",
        controller.controller_id(),
        event
    );
    match event {
        ControlEvent::Output { pane_id, data } => {
            if let Some(xsterm_id) = controller.xsterm_id_for_pane(&pane_id) {
                bridge.emit_session_output(xsterm_id, data);
            } else {
                tracing::debug!(
                    "tmux controller {}: dropping %output for unknown pane {} ({} bytes)",
                    controller.controller_id(),
                    pane_id,
                    data.len()
                );
            }
        }
        ControlEvent::WindowPaneChanged { window_id, pane_id } => {
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
            let pending_tx = controller.pending_splits.lock().ok().and_then(|mut q| {
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
                bridge.emit_tmux_pane_added(xsterm_id, &pane_id, Some(&window_id));
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
                bridge.emit_tmux_pane_added(xsterm_id, &pane_id, Some(&window_id));
                if let Some(tx) = pending.sender {
                    bridge.emit_tmux_window_added(
                        pending.xsterm_window_id,
                        &window_id,
                        None,
                        Some(xsterm_id),
                        Some(&pane_id),
                    );
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
                bridge.emit_tmux_pane_added(xsterm_id, &pane_id, Some(&window_id));
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
                controller.controller_id(),
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
            let pending_tx = controller.pending_windows.lock().ok().and_then(|mut q| {
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
            let is_first_window = controller
                .window_bindings
                .lock()
                .map(|m| m.is_empty())
                .unwrap_or(true)
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
                    controller.controller_id(),
                    window_id,
                    xsterm_window_id
                );
                return;
            }
            tracing::debug!(
                "tmux controller {}: external %window-add for window {} — not auto-binding",
                controller.controller_id(),
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
                bridge.emit_tmux_window_closed(&window_id, xsterm_window_id);
            } else {
                tracing::debug!(
                    "tmux controller {}: %window-close for unbound window {} — no tmux-window-closed emitted",
                    controller.controller_id(),
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
                bridge.emit_tmux_window_renamed(&window_id, xsterm_window_id, &name);
            } else {
                tracing::debug!(
                    "tmux controller {}: %window-renamed for unbound window {} — no tmux-window-renamed emitted",
                    controller.controller_id(),
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
                bridge.emit_tmux_pane_removed(&pane_id, xsterm_id);
            } else {
                tracing::debug!(
                    "tmux controller {}: %pane-exited for unbound pane {} — no tmux-pane-removed emitted",
                    controller.controller_id(),
                    pane_id,
                );
            }
        }
        ControlEvent::Pause { pane_id } => {
            bridge.emit_tmux_paused(&pane_id);
        }
        ControlEvent::Continue { pane_id } => {
            bridge.emit_tmux_continued(&pane_id);
        }
        ControlEvent::Exit { reason } => {
            bridge.emit_tmux_controller_exit(reason.as_deref());
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
                    controller.controller_id(),
                    id
                );
            }
        }
        ControlEvent::CommandOutput { id, ref line } => {
            // Route body lines to whichever consumer is currently
            // expecting them:
            //   1. `pending_capture` is set (capture-pane promise).
            //   2. Otherwise, accumulate into `current_command_lines`
            //      for end-of-block classification (WindowList /
            //      PaneList / generic CommandResponse) via
            //      `handle_classified_response`.
            let has_capture = controller
                .pending_capture
                .lock()
                .map(|s| s.is_some())
                .unwrap_or(false);
            if has_capture {
                if let Ok(mut body) = controller.pending_capture_body.lock() {
                    body.push(line.clone());
                }
            } else if let Ok(mut body) = controller.current_command_lines.lock() {
                body.push(line.clone());
            } else {
                tracing::debug!(
                    "tmux controller {}: %output for command {} (no pending capture, body line dropped)",
                    controller.controller_id(),
                    id
                );
            }
        }
        ControlEvent::CommandEnd { id, .. } => {
            // Resolve whichever promise the end-block is for. If both
            // are set (shouldn't happen — controller is sequential),
            // capture wins because it has the longer history.
            let mut capture_slot = match controller.pending_capture.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(tx) = capture_slot.take() {
                let body = controller
                    .pending_capture_body
                    .lock()
                    .map(|mut b| std::mem::take(&mut *b))
                    .unwrap_or_default();
                let text = body.join("\n");
                let _ = tx.send(Ok(text));
                tracing::debug!(
                    "tmux controller {}: capture-pane %end id={} ({} body lines)",
                    controller.controller_id(),
                    id,
                    body.len()
                );
                return;
            }
            drop(capture_slot);
            // No capture in flight — fall through to generic
            // command-response classification: emit a `tmux-window-list`
            // / `tmux-pane-list` event from the accumulated body, or
            // drop the body silently if it doesn't look like a list
            // query.
            handle_classified_response(
                controller,
                bridge,
                controller.controller_id(),
                id,
                take_command_body(controller),
            );
        }
        ControlEvent::CommandError { id, message, .. } => {
            let mut slot = match controller.pending_capture.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(tx) = slot.take() {
                            // Map the error string into `TmuxError::Internal` so the
                            // caller's `?`-chain (which now returns `TmuxError`)
                            // stays type-coherent. The user-visible message is
                            // preserved by `TmuxError`'s `Display` impl.
                            let _ = tx.send(Err(TmuxError::Internal(format!(
                                "tmux controller {}: capture-pane failed (id={}): {message}",
                                controller.controller_id(), id
                            ))));
                if let Ok(mut body) = controller.pending_capture_body.lock() {
                    body.clear();
                }
            } else {
                tracing::debug!(
                    "tmux controller {}: %error for command {} (no pending capture): {message}",
                    controller.controller_id(),
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
                controller.controller_id(),
                event
            );
        }
    }
}

/// Snapshot of one window row produced by `tmux list-windows -F`:
/// `#{window_id}\t#{session_id}\t#{window_name}\t#{window_active}\t#{window_layout}`.
struct WindowListRow {
    window_id: String,
    session_id: String,
    name: String,
    active: bool,
    layout: String,
}

/// Snapshot of one pane row produced by `tmux list-panes -F`:
/// `#{pane_id}\t#{window_id}\t#{session_id}\t#{pane_active}\t
///  #{pane_width}\t#{pane_height}\t#{pane_current_path}\t#{pane_title}`.
struct PaneListRow {
    pane_id: String,
    window_id: String,
    session_id: String,
    active: bool,
    width: u16,
    height: u16,
    cwd: String,
    title: String,
}

fn parse_window_list_row(line: &str) -> Option<WindowListRow> {
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 5 {
        return None;
    }
    Some(WindowListRow {
        window_id: parts[0].to_string(),
        session_id: parts[1].to_string(),
        name: parts[2].to_string(),
        active: parts[3] == "1",
        layout: parts[4].to_string(),
    })
}

fn parse_pane_list_row(line: &str) -> Option<PaneListRow> {
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 8 {
        return None;
    }
    Some(PaneListRow {
        pane_id: parts[0].to_string(),
        window_id: parts[1].to_string(),
        session_id: parts[2].to_string(),
        active: parts[3] == "1",
        width: parts[4].parse().unwrap_or(0),
        height: parts[5].parse().unwrap_or(0),
        cwd: parts[6].to_string(),
        title: parts[7].to_string(),
    })
}

fn emit_window_list(
    bridge: &TmuxBridge,
    session_id: u32,
    controller: &TmuxController,
    cmd_id: u32,
    lines: &[String],
) {
    let entries: Vec<WindowListRow> = lines
        .iter()
        .filter_map(|l| parse_window_list_row(l))
        .collect();
    if entries.is_empty() {
        tracing::debug!("command {} body had no parseable list rows", cmd_id);
        return;
    }
    // Pre-populate `pending_window_pane` for every window we see in
    // this list — the server won't fire `%window-add` for windows
    // that already existed before this controller attached, so
    // `emit_pane_list` needs entries to match against. Allocate a
    // fresh `xsterm_window_id` for each window so panes from the
    // following `list-panes -a` response can be bound to it.
    let window_ids: std::collections::HashMap<String, u32> = if let Ok(mut pending) =
        controller.pending_window_pane.lock()
    {
        entries
            .iter()
            .map(|e| {
                let xsterm_wid = controller.allocate_xsterm_window_id();
                pending.insert(
                    e.window_id.clone(),
                    super::controller::PendingWindow {
                        xsterm_window_id: xsterm_wid,
                        sender: None,
                    },
                );
                (e.window_id.clone(), xsterm_wid)
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };
    let rows = entries
        .iter()
        .map(|entry| {
            let xsterm_wid = window_ids
                .get(&entry.window_id)
                .copied()
                .unwrap_or(0);
            serde_json::json!({
                "controllerId": session_id,
                "tmuxWindowId": entry.window_id,
                "xstermWindowId": xsterm_wid,
                "xstermSessionId": session_id,
                "xstermPaneId": "",
            })
        })
        .collect::<Vec<_>>();
    bridge.emit_tmux_window_added_for_list(session_id, serde_json::json!(rows));
}

fn emit_pane_list(
    bridge: &TmuxBridge,
    session_id: u32,
    controller: &TmuxController,
    cmd_id: u32,
    lines: &[String],
) {
    let entries: Vec<PaneListRow> = lines
        .iter()
        .filter_map(|l| parse_pane_list_row(l))
        .collect();
    if entries.is_empty() {
        tracing::debug!("command {} body had no parseable list rows", cmd_id);
        return;
    }
    // Look up the xsterm window id per tmux window id (populated by
    // `emit_window_list`) and bind each pane to its window.
    let window_to_xsterm: std::collections::HashMap<String, u32> =
        if let Ok(bindings) = controller.window_bindings.lock() {
            bindings.clone()
        } else {
            std::collections::HashMap::new()
        };
    // Best-effort: register every pane we see. The first one wakes
    // `await_first_pane`; the rest are bound to their windows for
    // `%output` routing via the `pane_bindings` map.
    let mut first_registered = false;
    for entry in &entries {
        let xsterm_id = controller.allocate_xsterm_id();
        controller.register_pane(entry.pane_id.clone(), xsterm_id);
        controller.record_pane_window(entry.pane_id.clone(), entry.window_id.clone());
        // Emit one `tmux-pane-added` per row — the frontend's
        // `tmux-pane-added` listener is idempotent and creates an
        // xsterm Session for each one. Using the controller id as the
        // synthetic xsterm_session_id keeps all panes from this
        // controller under a single xsterm session in the React tree.
        let parent_window_id = entry.window_id.clone();
        let xsterm_window_id = window_to_xsterm
            .get(&entry.window_id)
            .copied()
            .unwrap_or(0);
        bridge.emit_tmux_pane_added_with_window(
            xsterm_id,
            &entry.pane_id,
            xsterm_window_id,
        );
        if let Ok(mut pane_bindings) = controller.pane_bindings.lock() {
            pane_bindings.insert(entry.pane_id.clone(), xsterm_id);
        }
        if !first_registered {
            controller.record_first_pane(xsterm_id, entry.pane_id.clone());
            first_registered = true;
            tracing::info!(
                "bootstrap first pane registered from list-panes: window={} pane={} xsterm_id={} xsterm_window_id={}",
                entry.window_id,
                entry.pane_id,
                xsterm_id,
                xsterm_window_id,
            );
        } else {
            tracing::info!(
                "bootstrap additional pane registered from list-panes: window={} pane={} xsterm_id={}",
                entry.window_id,
                entry.pane_id,
                xsterm_id,
            );
        }
    }
    let rows = entries
        .iter()
        .map(|e| {
            serde_json::json!({
                "paneId": e.pane_id,
                "windowId": e.window_id,
                "sessionId": e.session_id,
                "active": e.active,
                "width": e.width,
                "height": e.height,
                "cwd": e.cwd,
                "title": e.title,
            })
        })
        .collect::<Vec<_>>();
    bridge.emit_tmux_pane_added_for_list(session_id, serde_json::json!(rows));
}

/// Inspect the first body line of a completed command response. If it
/// Take the accumulated body lines for `current_command_id` and
/// clear `current_command_id` so the next `%begin..%end` block starts
/// fresh. Called by the `CommandEnd` arm of `dispatch_event` before
/// `handle_classified_response` runs.
fn take_command_body(controller: &TmuxController) -> Vec<String> {
    if let Ok(mut id_slot) = controller.current_command_id.lock() {
        id_slot.take();
    }
    if let Ok(mut body) = controller.current_command_lines.lock() {
        std::mem::take(&mut *body)
    } else {
        Vec::new()
    }
}

/// Inspect the first body line of a completed command response. If it
/// looks like `list-windows` (`@<id> …`) or `list-panes`
/// (`%<id> …`) output, classify the body as `WindowList` / `PaneList`
/// and emit a matching event to the frontend. For `WindowList`,
/// additionally trigger a follow-up `list-panes ""` so the dispatch
/// chain produces a `PaneList` event that registers the first pane
/// for `await_first_pane` — eliminating the Bug 016 / 017 race.
fn handle_classified_response(
    controller: &TmuxController,
    bridge: &TmuxBridge,
    controller_id: u32,
    cmd_id: u32,
    lines: Vec<String>,
) {
    let first = lines.first().map(|l| l.trim_start()).unwrap_or("");
    if first.starts_with('@') {
        emit_window_list(bridge, controller_id, controller, cmd_id, &lines);
        // Bug 017 bootstrap chain: emit window list, then immediately
        // ask the server for the panes so we can register the first
        // pane for `await_first_pane`. Dispatched on an OS thread to
        // keep the dispatch loop free of synchronous send latency.
        trigger_followup_list_panes(controller);
    } else if first.starts_with('%') {
        emit_pane_list(bridge, controller_id, controller, cmd_id, &lines);
    } else {
        tracing::debug!(
            "command {} body does not look like a list query (first line {:?}); ignoring",
            cmd_id,
            first
        );
    }
}

/// Send `list-panes ""` on a detached OS thread so the dispatch loop
/// doesn't block on the synchronous `stdin_tx` send. This is the second
/// leg of the Bug 017 bootstrap chain — the first leg is the
/// `list-windows` query sent by `schedule_initial_state_sync`.
fn trigger_followup_list_panes(controller: &TmuxController) {
    let stdin_tx = controller.stdin_tx.clone();
    std::thread::spawn(move || {
        let cmd =
            super::commands::list_panes_with_format("", super::commands::DEFAULT_PANE_LIST_FORMAT);
        if stdin_tx.send(cmd).is_err() {
            tracing::debug!("trigger_followup_list_panes: controller stdin_tx closed; skipping");
        }
    });
}
