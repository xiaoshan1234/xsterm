//! Lifecycle / synchronisation entry points for [`TmuxController`].
//!
//! Owns:
//! - [`TmuxController::close`] — drop the backend, drain the registry.
//! - [`TmuxController::session_name`] / [`set_session_name_for_tests`]
//!   — tmux session name cache.
//! - [`TmuxController::await_first_pane`] / [`take_initial_state`] /
//!   [`stash_initial_*`] / [`signal_initial_state_ready`] — the
//!   oneshot rendezvous for the bootstrap chain.
//!
//! Every other public method on the controller is in `super::commands`.

use super::lock_or_warn;
use super::super::errors::TmuxError;
use super::TmuxController;
use std::sync::atomic::Ordering;

impl TmuxController {
    /// tmux session name this controller is attached to.
    ///
    /// `Some(name)` for controllers built with [`TmuxController::spawn_attach`]
    /// (and only those), `None` for `spawn_create` / unknown sessions.
    /// Used by `SessionManager::list_attached_tmux_servers` to populate
    /// the persisted `attachedTmuxServers` list.
    pub fn session_name(&self) -> Option<String> {
        self.session_name.lock().ok().and_then(|g| g.clone())
    }

    /// Test-only: inject a `session_name` from outside `spawn_attach`.
    /// `#[cfg(test)]` so it never links into production binaries.
    #[cfg(test)]
    pub(crate) fn set_session_name_for_tests(&self, name: impl Into<String>) {
        if let Some(mut slot) = lock_or_warn(&self.session_name, "session_name", self.controller_id) {
            *slot = Some(name.into());
        }
    }

    /// Tear the controller down.
    ///
    /// - Sets the `killed` flag so the monitor task does not emit a
    ///   spurious `Exit` event.
    /// - Kills the backend (idempotent — best-effort via the
    ///   [`TmuxBackend::kill`] trait method).
    /// - Drops both waiter pools so any in-flight public methods observe a
    ///   closed channel and surface `Err` to the caller.
    ///
    /// Background tasks unwind asynchronously; this call does **not**
    /// wait for them to finish.
    pub fn close(&self) -> Result<(), TmuxError> {
        self.killed.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.backend.try_lock() {
            if let Some(mut backend) = guard.take() {
                if let Err(e) = backend.kill() {
                    tracing::error!(
                        "tmux controller {}: backend kill failed: {e}",
                        self.controller_id
                    );
                }
            }
        }
        let (cmd_drained, event_drained) = self.registry.drain_all();
        if cmd_drained + event_drained > 0 {
            tracing::debug!(
                "tmux controller {}: registry drained {} command waiter(s) and {} event waiter(s) on close",
                self.controller_id,
                cmd_drained,
                event_drained
            );
        }
        tracing::debug!(
            "tmux controller {}: close complete (tasks unwind async)",
            self.controller_id
        );
        Ok(())
    }

    /// Block until the first pane is registered, returning its
    /// `(xsterm_session_id, tmux_pane_id)` pair.
    ///
    /// Times out after [`TMUX_REPLY_TIMEOUT`] and returns
    /// `Err("timed out waiting for first pane")`. Only the bootstrap caller
    /// should `await` it; subsequent calls return immediately with the
    /// cached first-pane result if available, otherwise the same timeout
    /// error.
    pub async fn await_first_pane(&self) -> Result<(u32, String), TmuxError> {
        tracing::info!(
            "tmux controller {}: await_first_pane called (will block up to {:?}s waiting for record_first_pane from dispatcher)",
            self.controller_id,
            super::TMUX_REPLY_TIMEOUT.as_secs()
        );

        // Take the receiver (one-shot). If already taken, return an error.
        let rx = {
            let mut guard = self.first_pane_rx.lock().await;
            guard.take()
        };
        let rx = rx.ok_or_else(|| {
            TmuxError::Internal(format!(
                "tmux controller {}: first pane already awaited",
                self.controller_id
            ))
        })?;
        // Await with the standard 5s timeout. The receiver buffers the
        // dispatcher's `.send()`, so this doesn't lose notifications the
        // way `Notify` did.
        match tokio::time::timeout(super::TMUX_REPLY_TIMEOUT, rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err(TmuxError::AlreadyClosed),
            Err(_) => Err(TmuxError::Timeout {
                budget: super::TMUX_REPLY_TIMEOUT,
                context: "await_first_pane",
            }),
        }
    }

    /// Block until the dispatch task reports that the initial
    /// `list-windows` AND `list-panes` responses have been processed
    /// (and their payloads stashed in `initial_windows` /
    /// `initial_panes`). Consumed once per controller.
    ///
    /// Used by `SessionManager::create_tmux` / `attach_tmux` to wait for
    /// the full initial state before assembling
    /// [`TmuxSessionInit`](crate::models::session::TmuxSessionInit) and
    /// returning it to the frontend in a single round-trip.
    pub async fn take_initial_state(
        &self,
    ) -> Result<
        (
            Vec<crate::models::session::TmuxWindowInit>,
            Vec<crate::models::session::TmuxPaneInit>,
        ),
        TmuxError,
    > {
        let rx = {
            let mut guard = self.initial_state_rx.lock().await;
            guard.take()
        };
        let rx = rx.ok_or_else(|| {
            TmuxError::Internal(format!(
                "tmux controller {}: initial state already taken",
                self.controller_id
            ))
        })?;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(10), rx).await?;
        let windows = self
            .initial_windows
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .unwrap_or_default();
        let panes = self
            .initial_panes
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .unwrap_or_default();
        Ok((windows, panes))
    }

    /// Stash the parsed `list-windows` body so
    /// [`TmuxController::take_initial_state`] can return it. Called by
    /// the dispatch task's `emit_window_list` path.
    pub(crate) fn stash_initial_windows(
        &self,
        windows: Vec<crate::models::session::TmuxWindowInit>,
    ) {
        if let Some(mut slot) = lock_or_warn(&self.initial_windows, "initial_windows", self.controller_id) {
            *slot = Some(windows);
        }
    }

    /// Stash the parsed `list-panes` body so
    /// [`TmuxController::take_initial_state`] can return it. Called by
    /// the dispatch task's `emit_pane_list` path.
    pub(crate) fn stash_initial_panes(&self, panes: Vec<crate::models::session::TmuxPaneInit>) {
        if let Some(mut slot) = lock_or_warn(&self.initial_panes, "initial_panes", self.controller_id) {
            *slot = Some(panes);
        }
    }

    /// Signal that **both** `list-windows` AND `list-panes` have been
    /// processed and stashed. Called by the dispatch task after the
    /// second of the two has its body parsed. Idempotent (subsequent
    /// calls are no-ops because the receiver was already consumed).
    pub(crate) fn signal_initial_state_ready(&self) {
        if let Some(mut slot) = lock_or_warn(&self.initial_state_tx, "initial_state_tx", self.controller_id) {
            if let Some(tx) = slot.take() {
                let _ = tx.send(());
            }
        }
    }
}