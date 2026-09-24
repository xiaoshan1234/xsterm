//! User-facing tmux command entry points for [`TmuxController`].
//!
//! Each public method here corresponds to one Tauri command the
//! frontend can invoke: `send_keys` / `resize_pane` / `capture_pane` /
//! `split_pane` / `kill_pane` / `new_window` / `kill_window` /
//! `rename_window` / `detach_client` / `kill_server` / `unbind_pane`.
//! Construction lives in `super::spawn`; binding lookups in
//! `super::registry`; lifecycle (close / await_first_pane) in
//! `super::sync`.

use super::super::errors::TmuxError;
use super::super::protocol::command::{
    EventWaiter, EventWaiterKind, EventWaiterSender, ResponseOutcome, ResponseWaiter,
};
use super::super::protocol::wire as tmux_cmd;
use super::{
    CaptureResult, CommandRegistry, NewWindowResult, SplitResult, TmuxController,
    TMUX_REPLY_TIMEOUT,
};
use crate::error::StringError;
use crate::models::session::SplitDirection;
use tokio::sync::{mpsc, oneshot};

/// Send a command to the writer task and roll back the just-registered
/// waiter on failure. There is exactly one in-flight waiter per
/// request, so the crude `drain_event_waiters` is safe.
fn send_with_rollback(
    stdin_tx: &mpsc::UnboundedSender<String>,
    registry: &CommandRegistry,
    cmd: String,
) -> Result<(), TmuxError> {
    if stdin_tx.send(cmd).is_err() {
        registry.drain_event_waiters();
        Err(TmuxError::AlreadyClosed)
    } else {
        Ok(())
    }
}

/// Await a reply on a oneshot receiver with a timeout, mapping the
/// three outcomes (reply received / channel closed / elapsed) into a
/// uniform `TmuxError`.
async fn await_reply_commands<T>(
    rx: oneshot::Receiver<Result<T, TmuxError>>,
    timeout: std::time::Duration,
    controller_id: u32,
    op: &'static str,
) -> Result<T, TmuxError> {
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_canceled)) => Err(TmuxError::Internal(format!(
            "tmux controller {}: {op} response channel closed",
            controller_id
        ))),
        Err(_elapsed) => Err(TmuxError::Internal(format!(
            "tmux controller {}: {op} timed out after {:?}",
            controller_id, timeout
        ))),
    }
}

impl TmuxController {
    /// Write raw bytes (typically user keystrokes) to the pane.
    ///
    /// Internally builds the `send-keys -t %<pane> <escaped-data>` command
    /// via [`tmux_cmd::send_keys`] and pushes it onto the writer task's
    /// FIFO queue. Returns `Err` if the writer task has already exited
    /// (e.g. after [`TmuxController::close`]) or if the pane id is not
    /// registered with this controller.
    pub fn send_keys(&self, tmux_pane_id: &str, keys: &[u8]) -> Result<(), TmuxError> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::send_keys(tmux_pane_id, keys);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// Resize a pane to `cols` × `rows` characters.
    ///
    /// Builds `resize-pane -t %<pane> -x <cols> -y <rows>` via
    /// [`tmux_cmd::resize_pane`] and queues it for dispatch. Same error
    /// semantics as [`TmuxController::send_keys`].
    pub fn resize_pane(&self, tmux_pane_id: &str, rows: u16, cols: u16) -> Result<(), TmuxError> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::resize_pane(tmux_pane_id, cols, rows);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// read up to `lines` lines of scrollback from the pane via
    /// `capture-pane -p -e -J -S -<lines>` and return the captured text.
    ///
    /// This is the Promise coordination the dispatch task routes
    /// `%begin..%end` blocks for. tmux writes the captured lines inside a
    /// single reply block (one `%begin`, N `CommandOutput`s, one `%end`),
    /// and the dispatch task stitches them back together before resolving
    /// the oneshot sender this method returns via `await`.
    ///
    /// Exactly **one** capture may be in flight at a time. Concurrency is
    /// bounded via the `capture_lock` tokio mutex; a second concurrent
    /// caller waits until the first capture's `%end` has been processed.
    /// tmux serialises command replies, so single-capture is sufficient
    /// and avoids the four-state correlation dance a multi-pending design
    /// would require.
    ///
    /// Errors:
    /// - `Err("parent pane not registered")` when `tmux_pane_id` is not in
    ///   `pane_bindings` (mirrors the `send_keys` / `resize_pane` guard).
    /// - `Err` from the dispatcher when tmux itself replies with
    ///   `%error` (e.g. the pane vanished mid-capture).
    /// - `Err("capture-pane timed out")` after [`TMUX_REPLY_TIMEOUT`].
    /// - `Err("response channel closed")` if the dispatch task exited
    ///   before the reply arrived.
    pub async fn capture_pane(&self, tmux_pane_id: &str, lines: i32) -> CaptureResult {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }

        // Serialise concurrent capture_pane callers — only one capture
        // can be in flight at a time.
        let _guard = self.capture_lock.lock().await;

        // Register a `BeginEnd` waiter; the dispatch task resolves it via
        // `registry.take(id)` on the matching `CommandEnd` / `CommandError`.
        let (tx, rx) = oneshot::channel::<ResponseOutcome>();
        let reg = self.registry.register(
            tmux_cmd::capture_pane(tmux_pane_id, lines),
            Some(ResponseWaiter::BeginEnd(tx)),
        );

        if self
            .stdin_tx
            .send(reg.tagged.wire)
            .map_err(|_| TmuxError::AlreadyClosed)
            .is_err()
        {
            // Drain the just-registered waiter so a future `CommandEnd`
            // for this id does not strand an orphan sender in the
            // registry (the dispatch task will pick it up and resolve
            // it; the receiver is dropped here).
            self.registry.take(reg.tagged.id);
            return Err(TmuxError::AlreadyClosed);
        }

        match tokio::time::timeout(TMUX_REPLY_TIMEOUT, rx).await {
            Ok(Ok(ResponseOutcome::Ok { body_lines })) => Ok(body_lines.join("\n")),
            Ok(Ok(ResponseOutcome::Err { message })) => Err(TmuxError::Internal(format!(
                "tmux controller {}: capture-pane failed (id={:?}): {message}",
                self.controller_id, reg.tagged.id
            ))),
            Ok(Err(_canceled)) => Err(TmuxError::Internal(format!(
                "tmux controller {}: capture response channel closed",
                self.controller_id
            ))),
            Err(_elapsed) => Err(TmuxError::Internal(format!(
                "tmux controller {}: capture timed out after {:?}",
                self.controller_id, TMUX_REPLY_TIMEOUT
            ))),
        }
    }

    /// Remove the binding for `tmux_pane_id`. Called by
    /// [`TmuxPaneHandle::close`](crate::services::session_manager::TmuxPaneHandle::close)
    /// when a per-pane session is torn down; the controller itself stays
    /// alive (other panes may still be open).
    ///
    /// Does **not** issue `kill-pane` — that is the caller's responsibility
    /// if the underlying tmux pane should also disappear.
    pub fn unbind_pane(&self, tmux_pane_id: &str) -> Result<(), TmuxError> {
        let mut map = self.pane_bindings.lock().map_err_string()?;
        if map.remove(tmux_pane_id).is_none() {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not bound to controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        tracing::debug!(
            "tmux controller {}: unbound pane {}",
            self.controller_id,
            tmux_pane_id
        );
        Ok(())
    }

    /// Split `parent_tmux_pane_id` and return the new pane's
    /// `(xsterm_session_id, tmux_pane_id, tmux_window_id)` triple.
    ///
    /// Flow:
    /// 1. Register an [`EventWaiter`] (kind: `SplitResult`) on the
    ///    `CommandRegistry` so the dispatch task can route the matching
    ///    `%window-pane-changed` reply back to this future. The waiter
    ///    is registered **before** the `split-window` command is
    ///    written to stdin, eliminating the race where tmux replies
    ///    faster than the caller can register.
    /// 2. Write `split-window <flag> -t %<parent>` (built inline) to
    ///    stdin. The writer task drains the FIFO in a single background
    ///    thread, preserving tmux's expected command ordering.
    /// 3. `await` the oneshot with [`TMUX_REPLY_TIMEOUT`].
    ///
    /// Errors:
    /// - `Err("parent pane not bound")` if `parent_tmux_pane_id` is not
    ///   registered (the parent pane must already exist on this
    ///   controller).
    /// - `Err("timed out")` after [`TMUX_REPLY_TIMEOUT`] — the dispatch
    ///   task did not see a matching `%window-pane-changed` reply.
    /// - `Err("response channel closed")` if the controller's dispatch
    ///   task already exited (the child died before we got the reply).
    pub async fn split_pane(
        &self,
        parent_tmux_pane_id: &str,
        direction: SplitDirection,
    ) -> SplitResult {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(parent_tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                parent_tmux_pane_id, self.controller_id
            )));
        }

        // P8 W3b: tmux does not echo `%begin..%end` for `split-window`;
        // it answers with `%window-pane-changed`. Register an
        // event-correlated waiter on the registry; the dispatch task's
        // `%window-pane-changed` layer 2 pops it via
        // `take_event_waiter_for_split`.
        let (tx, rx) = oneshot::channel::<SplitResult>();
        self.registry.register_event_waiter(EventWaiter {
            kind: EventWaiterKind::SplitResult,
            sender: EventWaiterSender::Split(tx),
            tmux_window_id: None,
        });

        let cmd = format!(
            "split-window {} -t {}\n",
            direction.flag(),
            parent_tmux_pane_id
        );
        send_with_rollback(&self.stdin_tx, &self.registry, cmd)?;

        await_reply_commands(rx, self.split_pane_timeout, self.controller_id, "split").await
    }

    /// Send `kill-pane -t %<tmux_pane_id>` to tmux.
    ///
    /// Synchronous: writes the command to the writer-task FIFO and returns.
    /// The dispatch task will later receive `%pane-exited` from tmux and
    /// emit `tmux-pane-removed`, which the frontend listens for to drop
    /// the matching `Session` from React state.
    ///
    /// Returns `Err` if the pane is not bound to this controller or if the
    /// writer channel has already closed.
    pub fn kill_pane(&self, tmux_pane_id: &str) -> Result<(), TmuxError> {
        if !self
            .pane_bindings
            .lock()
            .map_err_string()?
            .contains_key(tmux_pane_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux pane '{}' is not registered with controller {}",
                tmux_pane_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::kill_pane(tmux_pane_id);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// open a new tmux window and return its
    /// `(xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id)`
    /// quadruple once tmux confirms via `%window-pane-changed`.
    ///
    /// Flow:
    /// 1. Register an [`EventWaiter`] (kind: `NewWindowResult`) on the
    ///    `CommandRegistry` so the dispatch task can route the matching
    ///    `%window-add` / `%window-pane-changed` reply pair back to this
    ///    future. The waiter is registered **before** the `new-window`
    ///    command is written to stdin, eliminating the race where tmux
    ///    replies faster than the caller can register.
    /// 2. Write `new-window [-n <name>]` (built via
    ///    [`tmux_cmd::new_window_in_current`]) to stdin. No `-t <session>`
    ///    flag because the `tmux -CC` controller is attached to its own
    ///    tmux session and `new-window` defaults to the current session.
    /// 3. `await` the oneshot with [`TMUX_REPLY_TIMEOUT`].
    ///
    /// Errors:
    /// - `Err("new-window timed out")` after [`TMUX_REPLY_TIMEOUT`] — the
    ///   dispatch task did not see a matching `%window-pane-changed` reply.
    /// - `Err("new-window response channel closed")` if the controller's
    ///   dispatch task already exited (the child died before we got the
    ///   reply).
    pub async fn new_window(&self, window_name: Option<&str>) -> NewWindowResult {
        // P8 W3b: tmux answers `new-window` with `%window-add` followed
        // by `%window-pane-changed` for the new window's first pane —
        // NOT a `%begin..%end` block. Register an event-correlated
        // waiter on the registry; the dispatch task's `%window-add`
        // case (a) re-keys it from `tmux_window_id: None` to
        // `Some(<window_id>)`, then `%window-pane-changed` layer 3
        // pops it via `take_event_waiter_for_window`.
        let (tx, rx) = oneshot::channel::<NewWindowResult>();
        self.registry.register_event_waiter(EventWaiter {
            kind: EventWaiterKind::NewWindowResult,
            sender: EventWaiterSender::NewWindow(tx),
            tmux_window_id: None,
        });

        let cmd = tmux_cmd::new_window_in_current(window_name);
        send_with_rollback(&self.stdin_tx, &self.registry, cmd)?;

        await_reply_commands(rx, TMUX_REPLY_TIMEOUT, self.controller_id, "new-window").await
    }

    /// send `kill-window -t @<tmux_window_id>` to tmux.
    ///
    /// Synchronous: writes the command to the writer-task FIFO and returns.
    /// The dispatch task will later receive `%window-close @<id>` from
    /// tmux and emit `tmux-window-closed`, which the frontend listener
    /// uses to drop every `Session` in the matching xsterm Window and then
    /// drop the Window itself.
    ///
    /// Returns `Err` if the window is not bound to this controller or if
    /// the writer channel has already closed.
    pub fn kill_window(&self, tmux_window_id: &str) -> Result<(), TmuxError> {
        if !self
            .window_bindings
            .lock()
            .map_err_string()?
            .contains(tmux_window_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux window '{}' is not registered with controller {}",
                tmux_window_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::kill_window(tmux_window_id);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// send `rename-window -t @<id> <new_name>` to tmux.
    ///
    /// Synchronous: writes the command to the writer-task FIFO and returns.
    /// The dispatch task will later receive `%window-renamed @<id> <name>`
    /// from tmux and emit `tmux-window-renamed`, which the frontend
    /// listener uses to update the matching xsterm Window's `name`.
    ///
    /// Returns `Err` if the window is not bound to this controller or if
    /// the writer channel has already closed.
    pub fn rename_window(&self, tmux_window_id: &str, name: &str) -> Result<(), TmuxError> {
        if !self
            .window_bindings
            .lock()
            .map_err_string()?
            .contains(tmux_window_id)
        {
            return Err(TmuxError::Internal(format!(
                "tmux window '{}' is not registered with controller {}",
                tmux_window_id, self.controller_id
            )));
        }
        let cmd = tmux_cmd::rename_window(tmux_window_id, name);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// send `detach-client -s "<session_name>"` to tmux.
    ///
    /// tmux treats this as a graceful disconnect: the control client
    /// child process exits cleanly (`%exit`), the tmux server + its
    /// session + windows stay alive, and the monitor task observes the
    /// backend exit which the dispatch task propagates to the frontend
    /// as `tmux-controller-exit`.
    ///
    /// Returns `Err` if the controller never recorded a session name.
    /// Returns `Err(AlreadyClosed)` if the writer channel is gone.
    pub fn detach_client(&self) -> Result<(), TmuxError> {
        let name = self.session_name().ok_or_else(|| {
            TmuxError::Internal(format!(
                "tmux controller {} has no recorded session_name — cannot detach",
                self.controller_id
            ))
        })?;
        let cmd = tmux_cmd::detach_client(&name);
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }

    /// send `kill-server` to tmux.
    ///
    /// tmux shuts down the entire server (every session, every window,
    /// every pane). The control client child process exits because the
    /// server it was attached to is gone; the monitor task observes the
    /// backend exit which the dispatch task propagates to the frontend
    /// as `tmux-controller-exit`.
    ///
    /// Returns `Err(AlreadyClosed)` if the writer channel is gone.
    pub fn kill_server(&self) -> Result<(), TmuxError> {
        let cmd = tmux_cmd::kill_server();
        self.stdin_tx
            .send(cmd)
            .map_err(|_| TmuxError::AlreadyClosed)
    }
}
