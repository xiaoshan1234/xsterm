import { useCallback } from "react";
import type { Terminal } from "../../../features/terminal";
import { useTerminalSurfacePorts } from "../state/TerminalSurfacePortsContext";
import "./TmuxControllerErrorBanner.css";

interface TmuxControllerErrorBannerProps {
  /** Sessions currently rendered in this pane window — the banner only shows when one of them has a tmux error. */
  paneSessions: Terminal[];
}

/**
 * in-pane error banner shown when the tmux controller backing
 * one of the `Terminal`s in this pane window exits unexpectedly.
 * Mirrors the look of `Pane.tsx`'s `pane-disconnect-banner` but adds
 * a Retry button that re-creates the controller with the original
 * `TmuxSessionConfig` captured at create / attach time.
 */
export function TmuxControllerErrorBanner({ paneSessions }: TmuxControllerErrorBannerProps) {
  const { tmux: tmuxPorts } = useTerminalSurfacePorts();

  const match: { controllerId: number; reason?: string } | null = (() => {
    for (const terminal of paneSessions) {
      const controllerId = terminal.tmux?.controllerId;
      if (controllerId === undefined) continue;
      const error = tmuxPorts.getControllerError(controllerId);
      if (error) {
        return { controllerId, reason: error.reason };
      }
    }
    return null;
  })();

  const handleRetry = useCallback(async () => {
    if (!match) return;
    try {
      await tmuxPorts.retryController(match.controllerId);
    } catch (e) {
      console.error("Failed to retry tmux controller:", e);
      window.alert(
        `Failed to retry Tmux controller: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    tmuxPorts.dismissControllerError(match.controllerId);
  }, [match, tmuxPorts]);

  const handleDismiss = useCallback(() => {
    if (!match) return;
    tmuxPorts.dismissControllerError(match.controllerId);
  }, [match, tmuxPorts]);

  if (!match) return null;
  return (
    <div className="tmux-controller-error-banner" role="alert">
      <div className="tmux-controller-error-banner__msg">
        Tmux controller exited
        {match.reason ? `: ${match.reason}` : "."}
      </div>
      <div className="tmux-controller-error-banner__actions">
        <button
          className="tmux-controller-error-banner__btn tmux-controller-error-banner__btn--primary"
          onClick={handleRetry}
        >
          Retry
        </button>
        <button className="tmux-controller-error-banner__btn" onClick={handleDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
