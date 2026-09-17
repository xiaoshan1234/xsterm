import { useCallback, useMemo } from "react";
import * as sessionService from "../service/legacy/services/sessionService";
import { useSession } from "../service/legacy/contexts/SessionContext";
import "./TmuxControlWindowView.css";

interface TmuxSessionControlProps {
  controllerId: number;
  tmuxSessionName: string;
}

/**
 * Left card inside the control-window (ADR 0009 §2.6). Shows the
 * controller's connection status, session metadata (name + id), and
 * three destructive buttons:
 *
 * - Disconnect → `detach_tmux_controller` (graceful; server session
 *   + windows stay alive, frontend windows go grey).
 * - Reconnect → re-runs `attachTmux` with the original config stored
 *   in `tmuxControllerConfigsRef` (best-effort; if the controller
 *   has been reaped the user can always recreate it via Create Session).
 * - Remote delete → `kill_server_via_controller` + unmark (destroys
 *   the entire tmux server; the next "Close control-window" finishes
 *   the local cleanup).
 *
 * Status dot turns grey when a `tmux-controller-exit` event for this
 * id is currently present in `tmuxControllerErrors`.
 */
export function TmuxSessionControl({
  controllerId,
  tmuxSessionName,
}: TmuxSessionControlProps) {
  const { tmuxControllerErrors, tmuxControllerConfigsRef } = useSession();

  const isDisconnected = useMemo(
    () => tmuxControllerErrors.has(controllerId),
    [tmuxControllerErrors, controllerId],
  );

  const handleDisconnect = useCallback(async () => {
    try {
      await sessionService.detachTmux(controllerId);
    } catch (e) {
      window.alert(
        `Failed to disconnect tmux session: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [controllerId]);

  const handleReconnect = useCallback(async () => {
    const config = tmuxControllerConfigsRef.current.get(controllerId);
    if (!config) {
      window.alert("No stored config for this controller; use Create Session to attach.");
      return;
    }
    try {
      await sessionService.attachTmux(config);
    } catch (e) {
      window.alert(
        `Failed to re-attach tmux session: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [controllerId, tmuxControllerConfigsRef]);

  const handleRemoteDelete = useCallback(async () => {
    const confirmed = window.confirm(
      `Permanently delete the tmux server "${tmuxSessionName}" and every window / pane inside it? ` +
        `This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await sessionService.killServerViaController(controllerId);
    } catch (e) {
      window.alert(
        `Failed to delete tmux server: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [controllerId, tmuxSessionName]);

  return (
    <section className="tmux-card" aria-label="Tmux session control">
      <header className="tmux-card__header">
        <h3 className="tmux-card__title">Session</h3>
        <span className="tmux-card__subtitle">tmux -CC</span>
      </header>
      <div className="tmux-card__divider" />
      <div className="tmux-session-status">
        <span
          className={`tmux-session-status__dot${isDisconnected ? " tmux-session-status__dot--disconnected" : ""}`}
          aria-hidden="true"
        />
        {isDisconnected ? "disconnected" : "connected"}
      </div>
      <div className="tmux-session-meta">
        <div className="tmux-session-meta__row">
          <span className="tmux-session-meta__key">name</span>
          <span className="tmux-session-meta__value">{tmuxSessionName}</span>
        </div>
        <div className="tmux-session-meta__row">
          <span className="tmux-session-meta__key">controller id</span>
          <span className="tmux-session-meta__value">{controllerId}</span>
        </div>
      </div>
      <div className="tmux-card__actions">
        <button className="btn btn--secondary" type="button" onClick={handleDisconnect}>
          Disconnect
        </button>
        <button className="btn btn--secondary" type="button" onClick={handleReconnect}>
          Reconnect
        </button>
        <button className="btn btn--secondary tmux-windows-row__action--danger" type="button" onClick={handleRemoteDelete}>
          Remote delete
        </button>
      </div>
    </section>
  );
}