//! tmux dispatch task — turns parsed [`ProtocolEvent`]s into
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
//! `dispatch_event` walks a match on `ProtocolEvent`. The two most
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

use super::controller::{RouterAction, TmuxController};
use super::bridge::TmuxBridge;
use super::protocol::events::ProtocolEvent;
use crate::services::tmux::protocol::command::{EventWaiter, EventWaiterKind, EventWaiterSender};
use serde_json::json;

/// Spawn the dispatch task that turns parsed [`ProtocolEvent`]s into
/// [`AppBackend`] emits.
///
/// `pub(crate)` so unit tests in `services::session_manager` (and any
/// future sibling crate) can drive the dispatch task with synthetic
/// events without going through a real `tmux -CC` child.
pub(crate) fn spawn_dispatch_task(
    mut dispatch_rx: mpsc::UnboundedReceiver<ProtocolEvent>,
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

/// Interpret one [`ProtocolEvent`] and emit the corresponding frontend
/// events via [`TmuxBridge`].
fn dispatch_event(
    controller: &Arc<TmuxController>,
    bridge: &TmuxBridge,
    event: ProtocolEvent,
) {
    tracing::trace!(
        "tmux dispatch: controller {} received event: {:?}",
        controller.controller_id(),
        event
    );
    match event {
        ProtocolEvent::Output { pane_id, data } => {
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
        ProtocolEvent::WindowPaneChanged { window_id, pane_id } => {
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

            // 2. Split-result path. A `SplitResult` event waiter exists →
            //    this `%window-pane-changed` is the reply to our own
            //    `split-window` request. Pop it from the registry,
            //    allocate a fresh xsterm id, register the binding, emit
            //    `tmux-pane-added`, and resolve the oneshot.
            if let Some(tx) = controller.registry.take_event_waiter_for_split() {
                let xsterm_id = controller.allocate_xsterm_id();
                controller.register_pane(pane_id.clone(), xsterm_id);
                controller.record_pane_window(pane_id.clone(), window_id.clone(), xsterm_id);
                bridge.emit_tmux_pane_added(xsterm_id, &pane_id, Some(&window_id));
                let _ = tx.send(Ok((xsterm_id, pane_id.clone(), window_id.clone())));
                return;
            }

            // 3. Wave 3 new-window / bootstrap path. An event waiter
            //    keyed by `window_id` exists → this
            //    `%window-pane-changed` is either the bootstrap
            //    window's first pane or the first pane of a
            //    user-driven `new-window` request. Allocate a fresh
            //    xsterm session id, register the binding, move the
            //    pre-allocated xsterm window id from the waiter into
            //    `window_bindings`, emit `tmux-pane-added` (always),
            //    and — for user-driven `new-window` only — emit
            //    `tmux-window-added` and resolve the pending sender.
            if let Some(pending) = controller
                .registry
                .take_event_waiter_for_window(&window_id)
            {
                let xsterm_id = controller.allocate_xsterm_id();
                controller.register_pane(pane_id.clone(), xsterm_id);
                controller.record_pane_window(pane_id.clone(), window_id.clone(), xsterm_id);
                // Both NewWindowResult (re-registered by WindowAdd case a)
                // and Bootstrap (registered by WindowAdd case b / list-windows)
                // carry an xsterm_window_id allocated earlier; insert it.
                if let Some(xsterm_wid) = pending.xsterm_window_id {
                    if let Ok(mut bindings) = controller.window_bindings.lock() {
                        bindings.insert(window_id.clone(), xsterm_wid);
                    }
                }
                bridge.emit_tmux_pane_added(xsterm_id, &pane_id, Some(&window_id));
                match pending.kind {
                    EventWaiterKind::NewWindowResult => {
                        if let EventWaiterSender::NewWindow(tx) = pending.sender {
                            let xsterm_wid = pending
                                .xsterm_window_id
                                .expect("NewWindowResult must carry xsterm_window_id");
                            bridge.emit_tmux_window_added(
                                xsterm_wid,
                                &window_id,
                                None,
                                Some(xsterm_id),
                                Some(&pane_id),
                            );
                            let _ = tx.send(Ok((
                                xsterm_wid,
                                window_id.clone(),
                                xsterm_id,
                                pane_id.clone(),
                            )));
                        }
                    }
                    EventWaiterKind::Bootstrap => {
                        // Bootstrap window — the frontend already has
                        // the matching xsterm Window (created during
                        // `create_tmux_session`). We do NOT emit
                        // `tmux-window-added`; we just need the
                        // dispatch task to register the first pane so
                        // `await_first_pane` resolves.
                        controller.record_first_pane(xsterm_id, pane_id.clone());
                    }
                    // SplitResult + tmux_window_id: Some(...) is
                    // unreachable: take_event_waiter_for_window does
                    // not match SplitResult (it uses
                    // take_event_waiter_for_split).
                    EventWaiterKind::SplitResult => unreachable!(
                        "SplitResult with tmux_window_id is never registered; \
                         take_event_waiter_for_window must not match it"
                    ),
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
            //
            //    NB: if this fires *and* there's no `EventWaiter` for
            //    the window, the bootstrap path either was missed
            //    (`%window-add` not seen) or genuinely doesn't apply
            //    (out-of-band pane). Either way, do not silently
            //    consume — the loud log lets ops diagnose a missed
            //    `%window-add`.
            tracing::debug!(
                "tmux controller {}: external %window-pane-changed for pane {} in window {} — not auto-binding",
                controller.controller_id(),
                pane_id,
                window_id
            );
        }
        ProtocolEvent::WindowAdd { window_id } => {
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
                .registry
                .take_event_waiter_for_new_window_unbound();
            if let Some(mut pending) = pending_tx {
                let xsterm_window_id = controller.allocate_xsterm_window_id();
                // P8 W3b: re-key the waiter from `tmux_window_id: None`
                // to `Some(window_id)` so the matching
                // `%window-pane-changed` resolves it via
                // `take_event_waiter_for_window`.
                pending.tmux_window_id = Some(window_id.clone());
                pending.xsterm_window_id = Some(xsterm_window_id);
                controller.registry.register_event_waiter(pending);
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
                && controller.registry.event_waiter_count() == 0;
            if is_first_window {
                let xsterm_window_id = controller.allocate_xsterm_window_id();
                controller.registry.register_event_waiter(EventWaiter {
                    kind: EventWaiterKind::Bootstrap,
                    sender: EventWaiterSender::None,
                    tmux_window_id: Some(window_id.clone()),
                    xsterm_window_id: Some(xsterm_window_id),
                });
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
        ProtocolEvent::WindowClose { window_id } => {
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
        ProtocolEvent::WindowRenamed { window_id, name } => {
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
        ProtocolEvent::PaneExited { ref pane_id } | ProtocolEvent::PaneDied { ref pane_id } => {
            let event_kind = match &event {
                ProtocolEvent::PaneExited { .. } => "%pane-exited",
                ProtocolEvent::PaneDied { .. } => "%pane-died",
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
        ProtocolEvent::Pause { pane_id } => {
            bridge.emit_tmux_paused(&pane_id);
        }
        ProtocolEvent::Continue { pane_id } => {
            bridge.emit_tmux_continued(&pane_id);
        }
        ProtocolEvent::Exit { reason } => {
            bridge.emit_tmux_controller_exit(reason.as_deref());
        }
        // Command response envelope (`%begin` / `%output` / `%end` /
        // `%error`). P8 W3a: delegation to `RouterState::process()` —
        // the controller's `router_state` owns the in-flight body
        // buffer, resolves registered waiters via `send_to_waiter`,
        // and returns a `RouterAction` describing what (if anything)
        // the dispatcher must do. Only `DelegateToV1` for `%end`
        // (fire-and-forget list queries) needs extra work — drain the
        // in-flight body and feed it to `handle_classified_response`.
        ProtocolEvent::CommandBegin { .. } => {
            let mut rs = match controller.router_state.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let _ = rs.process(&event, &controller.registry, bridge, controller);
        }
        ProtocolEvent::CommandOutput { .. } => {
            let mut rs = match controller.router_state.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let _ = rs.process(&event, &controller.registry, bridge, controller);
        }
        ProtocolEvent::CommandEnd { id, .. } => {
            let action = {
                let mut rs = match controller.router_state.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                rs.process(&event, &controller.registry, bridge, controller)
            };
            // Route a fire-and-forget `%end` body by the originating
            // [`CommandKind`] captured in `RouterState`. Without this
            // typed dispatch we would have to sniff the first body
            // line — Bug 022 (`first.starts_with('@')` missed any
            // whitespace-prefixed or empty-first-line reply).
            if let RouterAction::DelegateToV1 {
                cmd_id: _,
                kind,
                body_lines,
            } = action
            {
                use crate::services::tmux::protocol::command::CommandKind;
                let controller_id = controller.controller_id();
                match kind {
                    CommandKind::ListWindows => {
                        let entries: Vec<(String, String, String, bool, String)> =
                            body_lines
                                .iter()
                                .filter_map(|line| {
                                    let p: Vec<&str> = line.split('\t').collect();
                                    if p.len() < 5 {
                                        return None;
                                    }
                                    Some((
                                        p[0].to_string(),
                                        p[1].to_string(),
                                        p[2].to_string(),
                                        p[3] == "1",
                                        p[4].to_string(),
                                    ))
                                })
                                .collect();
                        if !entries.is_empty() {
                            let window_ids: std::collections::HashMap<String, u32> = entries
                                .iter()
                                .map(|e| {
                                    let xsterm_wid = controller.allocate_xsterm_window_id();
                                    controller.registry.register_event_waiter(EventWaiter {
                                        kind: EventWaiterKind::Bootstrap,
                                        sender: EventWaiterSender::None,
                                        tmux_window_id: Some(e.0.clone()),
                                        xsterm_window_id: Some(xsterm_wid),
                                    });
                                    if let Ok(mut bindings) =
                                        controller.window_bindings.lock()
                                    {
                                        bindings.insert(e.0.clone(), xsterm_wid);
                                    }
                                    (e.0.clone(), xsterm_wid)
                                })
                                .collect();
                            let rows = entries
                                .iter()
                                .map(|entry| {
                                    let xsterm_wid = window_ids
                                        .get(&entry.0)
                                        .copied()
                                        .unwrap_or(0);
                                    serde_json::json!({
                                        "controllerId": controller_id,
                                        "tmuxWindowId": entry.0,
                                        "xstermWindowId": xsterm_wid,
                                        "xstermSessionId": controller_id,
                                        "xstermPaneId": "",
                                    })
                                })
                                .collect::<Vec<_>>();
                            bridge.emit_tmux_window_added_for_list(
                                controller_id,
                                serde_json::json!(rows),
                            );
                        }
                        // Bug 017 bootstrap chain: ask the server for
                        // the panes so we can register the first pane
                        // for `await_first_pane`. Dispatched on an OS
                        // thread to keep the dispatch loop free of
                        // synchronous send latency.
                        let stdin_tx = controller.stdin_tx.clone();
                        std::thread::spawn(move || {
                            let cmd = super::protocol::wire::list_panes_with_format(
                                "",
                                super::protocol::wire::DEFAULT_PANE_LIST_FORMAT,
                            );
                            if stdin_tx.send(cmd).is_err() {
                                tracing::debug!(
                                    "followup list-panes: controller stdin_tx closed; skipping"
                                );
                            }
                        });
                    }
                    CommandKind::ListPanes { .. } => {
                        let entries: Vec<(
                            String,
                            String,
                            String,
                            bool,
                            u16,
                            u16,
                            String,
                            String,
                        )> = body_lines
                            .iter()
                            .filter_map(|line| {
                                let p: Vec<&str> = line.split('\t').collect();
                                if p.len() < 8 {
                                    return None;
                                }
                                Some((
                                    p[0].to_string(),
                                    p[1].to_string(),
                                    p[2].to_string(),
                                    p[3] == "1",
                                    p[4].parse().unwrap_or(0),
                                    p[5].parse().unwrap_or(0),
                                    p[6].to_string(),
                                    p[7].to_string(),
                                ))
                            })
                            .collect();
                        if !entries.is_empty() {
                            let window_to_xsterm: std::collections::HashMap<String, u32> =
                                if let Ok(bindings) = controller.window_bindings.lock() {
                                    bindings.clone()
                                } else {
                                    std::collections::HashMap::new()
                                };
                            let mut first_registered = false;
                            for entry in &entries {
                                let xsterm_id = controller.allocate_xsterm_id();
                                controller.register_pane(entry.0.clone(), xsterm_id);
                                let xsterm_window_id = window_to_xsterm
                                    .get(&entry.1)
                                    .copied()
                                    .unwrap_or(0);
                                controller.record_pane_window(
                                    entry.0.clone(),
                                    entry.1.clone(),
                                    xsterm_window_id,
                                );
                                bridge.emit_tmux_pane_added_with_window(
                                    xsterm_id,
                                    &entry.0,
                                    xsterm_window_id,
                                );
                                if let Ok(mut pane_bindings) =
                                    controller.pane_bindings.lock()
                                {
                                    pane_bindings.insert(entry.0.clone(), xsterm_id);
                                }
                                if !first_registered {
                                    controller.record_first_pane(
                                        xsterm_id,
                                        entry.0.clone(),
                                    );
                                    first_registered = true;
                                }
                            }
                            let rows = entries
                                .iter()
                                .map(|e| {
                                    serde_json::json!({
                                        "paneId": e.0,
                                        "windowId": e.1,
                                        "sessionId": e.2,
                                        "active": e.3,
                                        "width": e.4,
                                        "height": e.5,
                                        "cwd": e.6,
                                        "title": e.7,
                                    })
                                })
                                .collect::<Vec<_>>();
                            bridge.emit_tmux_pane_added_for_list(
                                controller_id,
                                serde_json::json!(rows),
                            );
                        }
                    }
                    _ => {
                        tracing::debug!(
                            "command {} body kind {:?} is not body-routed; ignoring {} lines",
                            id,
                            kind,
                            body_lines.len()
                        );
                    }
                }
            }
        }
        ProtocolEvent::CommandError { .. } => {
            let mut rs = match controller.router_state.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let _ = rs.process(&event, &controller.registry, bridge, controller);
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

