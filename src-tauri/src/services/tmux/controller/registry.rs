//! Pane / window binding registry for [`TmuxController`].
//!
//! Owns the three runtime maps
//! (`pane_bindings`, `pane_window_bindings`, `window_bindings`), the
//! oneshot rendezvous for `await_first_pane`, and the `session_id_alloc`
//! delegation. Everything else — readers, writers, dispatch — reads
//! through these methods.

use super::lock_or_warn;
use super::TmuxController;

impl TmuxController {
    /// Returns `(tmux_pane_id, session_id)` pairs. Used by the dispatch
    /// task to look up the Session.id for `session-output` events.
    #[allow(dead_code)] // test-only introspection; not consumed by production code
    pub fn pane_bindings(&self) -> Vec<(String, u32)> {
        self.pane_bindings
            .lock()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
            .unwrap_or_default()
    }

    /// Look up the xsterm session id for a given tmux pane id. `None` if
    /// the pane has not been registered with this controller (e.g. it has
    /// been unbound via [`TmuxController::unbind_pane`]).
    pub fn xsterm_id_for_pane(&self, tmux_pane_id: &str) -> Option<u32> {
        self.pane_bindings
            .lock()
            .ok()
            .and_then(|m| m.get(tmux_pane_id).copied())
    }

    /// Look up the tmux window id that contains `tmux_pane_id`. Used by
    /// [`SessionManager::create_tmux`](crate::services::session_manager::SessionManager::create_tmux)
    /// so the bootstrap pane's `SessionInfo` carries the bootstrap
    /// window's tmux id. `None` if the pane is not registered with this
    /// controller.
    pub fn tmux_window_id_for_pane(&self, tmux_pane_id: &str) -> Option<String> {
        self.pane_window_bindings
            .lock()
            .ok()
            .and_then(|m| m.get(tmux_pane_id).cloned())
    }

    /// snapshot of every `tmux_window_id` this controller has observed.
    pub fn window_bindings(&self) -> Vec<String> {
        self.window_bindings
            .lock()
            .map(|m| m.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Insert `(tmux_pane_id → session_id)` into the binding map. The
    /// caller passes the `session_id` allocated by the injected
    /// [`SessionIdSource`](crate::models::session::SessionIdSource)
    /// for the first pane). Used by the dispatch task to look up the
    /// Session.id for `session-output` events keyed by `%output pane_id`.
    ///
    /// Returns `true` on first registration, `false` if the pane id is
    /// already bound (the existing mapping is left untouched — re-registration
    /// must not overwrite the original session id).
    pub(crate) fn register_pane(&self, tmux_pane_id: String, session_id: u32) -> bool {
        let mut map = match self.pane_bindings.lock() {
            Ok(m) => m,
            Err(_) => return false,
        };
        if map.contains_key(&tmux_pane_id) {
            return false;
        }
        map.insert(tmux_pane_id, session_id);
        true
    }

    /// Drop a pane binding unconditionally (no error if it was never
    /// registered). Used by the dispatch task's bootstrap path to
    /// undo an `allocate_session_id` + `register_pane` that was made
    /// for a placeholder session id; the real id comes from the
    /// [`TmuxController::record_first_pane`].
    pub(crate) fn unregister_pane(&self, tmux_pane_id: &str) {
        if let Some(mut map) = lock_or_warn(&self.pane_bindings, "pane_bindings", self.controller_id) {
            map.remove(tmux_pane_id);
        }
    }

    /// Record `(session_id, pane_id)` as the first pane and wake one
    /// waiter of [`TmuxController::await_first_pane`]. The caller
    /// (the dispatch task's bootstrap path) passes the `session_id`
    /// it allocated via [`TmuxController::allocate_session_id`]
    /// so the same id can land in [`TmuxController::pane_bindings`]
    /// and the `tmux-pane-added` payload. Idempotent: subsequent calls
    /// are no-ops (the `first_pane_tx` slot is one-shot).
    pub(crate) fn record_first_pane(&self, session_id: u32, pane_id: String) {
        tracing::info!(
            "tmux controller {}: record_first_pane(session_id={}, pane_id={:?}) called by dispatcher",
            self.controller_id,
            session_id,
            pane_id
        );
        if let Some(mut slot) = lock_or_warn(&self.first_pane_tx, "first_pane_tx", self.controller_id) {
            if let Some(tx) = slot.take() {
                let _ = tx.send((session_id, pane_id));
            } else {
                tracing::warn!(
                    "tmux controller {}: first_pane_tx already consumed (await_first_pane may have already returned)",
                    self.controller_id
                );
            }
        }
    }

    /// Record that `pane_id` belongs to `tmux_window_id`. Called by
    /// the dispatch task alongside [`TmuxController::register_pane`].
    /// Used by [`TmuxController::tmux_window_id_for_pane`] so
    /// [`SessionManager::create_tmux`](crate::services::session_manager::SessionManager::create_tmux)
    /// can populate the bootstrap pane's `tmux_window_id` on its
    /// `SessionInfo`.
    ///
    /// **Also** populates `window_bindings` (the `HashSet<String>` of
    /// `tmux_window_id`s this controller has observed) so
    /// `kill_window` / `rename_window` can validate the caller's input
    /// and the bootstrap-detection predicate in the dispatch task can
    /// tell whether a `%window-add` is the very first one.
    pub(crate) fn record_pane_window(&self, pane_id: String, tmux_window_id: String) {
        if let Some(mut map) = lock_or_warn(&self.pane_window_bindings, "pane_window_bindings", self.controller_id) {
            map.insert(pane_id, tmux_window_id.clone());
        }
        if let Some(mut map) = lock_or_warn(&self.window_bindings, "window_bindings", self.controller_id) {
            map.insert(tmux_window_id);
        }
    }

    /// Allocate a fresh Session.id via the controller's injected
    /// [`SessionIdSource`](crate::models::session::SessionIdSource)
    /// closure. The dispatch task uses this for every pane registered
    /// after the bootstrap (split, list-panes after bootstrap, …).
    pub(crate) fn allocate_session_id(&self) -> u32 {
        (self.session_id_allocator)()
    }

    /// Return the stable controller id allocated by the [`SessionManager`].
    pub fn controller_id(&self) -> u32 {
        self.controller_id
    }
}