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

use super::bridge::TmuxBridge;
use super::controller::{RouterAction, TmuxController};
use super::protocol::events::ProtocolEvent;
use crate::services::tmux_session::protocol::command::{EventWaiter, EventWaiterKind, EventWaiterSender};

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
fn dispatch_event(controller: &Arc<TmuxController>, bridge: &TmuxBridge, event: ProtocolEvent) {
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
            //    allocate a fresh Session.id, register the binding, emit
            //    `tmux-pane-added`, and resolve the oneshot.
            if let Some(tx) = controller.registry.take_event_waiter_for_split() {
                let session_id = controller.allocate_session_id();
                controller.register_pane(pane_id.clone(), session_id);
                controller.record_pane_window(pane_id.clone(), window_id.clone());
                bridge.emit_tmux_pane_added(session_id, &pane_id, Some(&window_id));
                let _ = tx.send(Ok((session_id, pane_id.clone(), window_id.clone())));
                return;
            }

            // 3. Wave 3 new-window / bootstrap path. An event waiter
            //    keyed by `window_id` exists → this
            //    `%window-pane-changed` is either the bootstrap
            //    window's first pane or the first pane of a
            //    user-driven `new-window` request. Allocate a fresh
            //    Session.id via the injected allocator, register the
            //    binding, record the window as observed, emit
            //    `tmux-pane-added` (always), and — for user-driven
            //    `new-window` only — emit `tmux-window-added` and
            //    resolve the pending sender.
            if let Some(pending) = controller.registry.take_event_waiter_for_window(&window_id) {
                match pending.kind {
                    EventWaiterKind::NewWindowResult => {
                        let session_id = controller.allocate_session_id();
                        controller.register_pane(pane_id.clone(), session_id);
                        controller.record_pane_window(pane_id.clone(), window_id.clone());
                        bridge.emit_tmux_pane_added(session_id, &pane_id, Some(&window_id));
                        if let EventWaiterSender::NewWindow(tx) = pending.sender {
                            bridge.emit_tmux_window_added(
                                &window_id,
                                None,
                                Some(session_id),
                                Some(&pane_id),
                            );
                            let _ = tx.send(Ok((window_id.clone(), session_id, pane_id.clone())));
                        }
                    }
                    EventWaiterKind::Bootstrap => {
                        // Bootstrap window — the frontend already has
                        // the matching xsterm Window (created during
                        // `create_tmux_session`). We do NOT emit
                        // `tmux-window-added`; we just need the
                        // dispatch task to register the first pane so
                        // `await_first_pane` resolves.
                        let session_id = controller.allocate_session_id();
                        controller.register_pane(pane_id.clone(), session_id);
                        controller.record_pane_window(pane_id.clone(), window_id.clone());
                        controller.record_first_pane(session_id, pane_id.clone());
                        bridge.emit_tmux_pane_added(session_id, &pane_id, Some(&window_id));
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
                // P8 W3b: re-key the waiter from `tmux_window_id: None`
                // to `Some(window_id)` so the matching
                // `%window-pane-changed` resolves it via
                // `take_event_waiter_for_window`.
                pending.tmux_window_id = Some(window_id.clone());
                controller.registry.register_event_waiter(pending);
                // No event yet — we need the matching `%window-pane-changed`
                // for the first pane of the new window so the
                // `tmux-window-added` payload can carry a valid
                // Session.id for the first pane.
                return;
            }
            let is_first_window = controller
                .window_bindings
                .lock()
                .map(|m| m.is_empty())
                .unwrap_or(true)
                && controller.registry.event_waiter_count() == 0;
            if is_first_window {
                controller.registry.register_event_waiter(EventWaiter {
                    kind: EventWaiterKind::Bootstrap,
                    sender: EventWaiterSender::None,
                    tmux_window_id: Some(window_id.clone()),
                });
                tracing::debug!(
                    "tmux controller {}: bootstrap %window-add for window {}",
                    controller.controller_id(),
                    window_id,
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
            // Drop the window binding (if any). After dropping the
            // parallel `xsterm_window_id` allocator we no longer need
            // to look anything up — the frontend uses `tmux_window_id`
            // directly as the Window.id, so the bridge event only
            // carries the tmux-side id.
            let was_bound = controller
                .window_bindings
                .lock()
                .map(|mut m| m.remove(&window_id))
                .unwrap_or(false);
            if was_bound {
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
                bridge.emit_tmux_window_closed(&window_id);
            } else {
                tracing::debug!(
                    "tmux controller {}: %window-close for unbound window {} — no tmux-window-closed emitted",
                    controller.controller_id(),
                    window_id,
                );
            }
        }
        ProtocolEvent::WindowRenamed { window_id, name } => {
            let was_bound = controller
                .window_bindings
                .lock()
                .map(|m| m.contains(&window_id))
                .unwrap_or(false);
            if was_bound {
                bridge.emit_tmux_window_renamed(&window_id, &name);
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
            // Delegate command-response routing to `RouterState`. On a
            // fire-and-forget `%end` (no registered `ResponseWaiter`)
            // RouterState returns `RouterAction::DelegateToV1` and
            // leaves the accumulated body in `RouterState.in_flight` —
            // we drain it here and feed `handle_classified_response`
            // which routes by the first body line (Bug 023 protocol).
            let action = {
                let mut rs = match controller.router_state.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                rs.process(&event, &controller.registry, bridge, controller)
            };
            if matches!(action, RouterAction::DelegateToV1) {
                let body_lines = {
                    let mut rs = match controller.router_state.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    rs.take_in_flight_lines()
                };
                handle_classified_response(
                    controller,
                    bridge,
                    controller.controller_id(),
                    id,
                    body_lines,
                );
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

/// Inspect the first body line of a completed fire-and-forget command
/// response. If it looks like `list-windows` (`@<id> …`) or
/// `list-panes` (`%<id> …`) output, classify the body as
/// `WindowList` / `PaneList` and emit a matching event to the frontend.
/// For `WindowList`, additionally trigger a follow-up `list-panes ""`
/// so the dispatch chain produces a `PaneList` event that registers
/// the first pane for `await_first_pane` — eliminating the Bug 016 /
/// 017 race.
///
/// `trim_start()` handles whitespace-prefixed reply lines; if the
/// first line doesn't begin with `@` or `%` the body is logged at
/// DEBUG and dropped (the only commands that produce list-shaped
/// output are `list-windows` / `list-panes`).
fn handle_classified_response(
    controller: &Arc<TmuxController>,
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
        // Both list-windows and list-panes have been processed.
        // Signal the controller so `take_initial_state` can return.
        controller.signal_initial_state_ready();
    } else {
        tracing::debug!(
            "command {} body does not look like a list query (first line {:?}); ignoring",
            cmd_id,
            first
        );
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
    controller: &Arc<TmuxController>,
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
    // The server won't fire `%window-add` for windows that already
    // existed before this controller attached, so we register a
    // Bootstrap event waiter for every window we see in this list.
    // After dropping the parallel `xsterm_window_id` allocator we
    // just record the `tmux_window_id` set so the dispatch task's
    // bootstrap-detection predicate in `WindowAdd` case (b) can tell
    // whether a subsequent `%window-add` is the very first one.
    //
    // **New IA (TmuxSessionInit):** stash the parsed rows into
    // `controller.initial_windows` so [`TmuxController::take_initial_state`]
    // can return them synchronously. We no longer emit a
    // `tmux-window-list` event — the frontend gets the same data as
    // part of the `create_tmux_session` / `attach_tmux_session`
    // return value.
    let _ = entries
        .iter()
        .map(|e| {
            controller.registry.register_event_waiter(EventWaiter {
                kind: EventWaiterKind::Bootstrap,
                sender: EventWaiterSender::None,
                tmux_window_id: Some(e.window_id.clone()),
            });
            tracing::info!(
                "[PR-0009-fix] emit_window_list: inserting tmux_window_id={:?} name={:?} into window_bindings (controller {})",
                e.window_id,
                e.name,
                controller.controller_id()
            );
            if let Ok(mut bindings) = controller.window_bindings.lock() {
                bindings.insert(e.window_id.clone());
            }
        })
        .collect::<Vec<_>>();
    tracing::info!(
        "[PR-0009-fix] emit_window_list: session={:?} controller={} rows={} windows=[{}]",
        controller.session_name().as_deref().unwrap_or("<unbound>"),
        controller.controller_id(),
        entries.len(),
        entries
            .iter()
            .map(|e| format!("({:?}@{:?})", e.name, e.window_id))
            .collect::<Vec<_>>()
            .join(", "),
    );
    let inits: Vec<crate::models::session::TmuxWindowInit> = entries
        .iter()
        .map(|entry| crate::models::session::TmuxWindowInit {
            tmux_window_id: entry.window_id.clone(),
            name: entry.name.clone(),
            active: entry.active,
            layout: entry.layout.clone(),
        })
        .collect();
    controller.stash_initial_windows(inits);
    // Bridge / session_id are unused for the new IA but kept in
    // the signature for the legacy tests that still pass them.
    let _ = bridge;
    let _ = session_id;
    let _ = cmd_id;
}

fn emit_pane_list(
    bridge: &TmuxBridge,
    session_id: u32,
    controller: &Arc<TmuxController>,
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
    // Best-effort: register every pane we see. The first one wakes
    // `await_first_pane`; the rest are bound to their windows for
    // `%output` routing via the `pane_bindings` map.
    //
    // **New IA (TmuxSessionInit):** stash the parsed rows into
    // `controller.initial_panes` (with each pane's Session.id
    // pre-allocated by `allocate_session_id`) and signal
    // `initial_state_ready` once both lists are processed.
    let mut first_registered = false;
    let mut inits: Vec<crate::models::session::TmuxPaneInit> = Vec::with_capacity(entries.len());
    for entry in &entries {
        let pane_session_id = controller.allocate_session_id();
        controller.register_pane(entry.pane_id.clone(), pane_session_id);
        controller.record_pane_window(entry.pane_id.clone(), entry.window_id.clone());
        if let Ok(mut pane_bindings) = controller.pane_bindings.lock() {
            pane_bindings.insert(entry.pane_id.clone(), pane_session_id);
        }
        inits.push(crate::models::session::TmuxPaneInit {
            session_id: pane_session_id,
            tmux_pane_id: entry.pane_id.clone(),
            tmux_window_id: entry.window_id.clone(),
            active: entry.active,
            width: entry.width,
            height: entry.height,
            title: entry.title.clone(),
            cwd: entry.cwd.clone(),
        });
        if !first_registered {
            controller.record_first_pane(pane_session_id, entry.pane_id.clone());
            first_registered = true;
            tracing::info!(
                "bootstrap first pane registered from list-panes: window={} pane={} session_id={}",
                entry.window_id,
                entry.pane_id,
                pane_session_id,
            );
        } else {
            tracing::info!(
                "bootstrap additional pane registered from list-panes: window={} pane={} session_id={}",
                entry.window_id,
                entry.pane_id,
                pane_session_id,
            );
        }
    }
    controller.stash_initial_panes(inits);
    // Bridge / session_id are unused for the new IA but kept in
    // the signature for the legacy tests that still pass them.
    let _ = bridge;
    let _ = session_id;
    let _ = cmd_id;
}

/// Send `list-panes ""` on a detached OS thread so the dispatch loop
/// doesn't block on the synchronous `stdin_tx` send. This is the second
/// leg of the Bug 017 bootstrap chain — the first leg is the
/// `list-windows` query sent by `schedule_initial_state_sync`.
fn trigger_followup_list_panes(controller: &Arc<TmuxController>) {
    let stdin_tx = controller.stdin_tx.clone();
    std::thread::spawn(move || {
        let cmd = super::protocol::wire::list_panes_with_format(
            "",
            super::protocol::wire::DEFAULT_PANE_LIST_FORMAT,
        );
        if stdin_tx.send(cmd).is_err() {
            tracing::debug!("trigger_followup_list_panes: controller stdin_tx closed; skipping");
        }
    });
}
