import { useCallback } from "react";
import { type TmuxControllerError, useSession } from "../../sessions";
import * as terminalService from "../../../services/terminalService";
import type { Terminal, TmuxSessionConfig } from "../../../types/terminal";
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
  const { tmuxControllerErrors, setTmuxControllerErrors } = useSession();

  const match: { controllerId: number; config: TmuxSessionConfig; reason?: string } | null =
    (() => {
      for (const terminal of paneSessions) {
        if (terminal.tmuxSessionId === undefined) continue;
        const err = tmuxControllerErrors.get(terminal.tmuxSessionId);
        if (err) {
          return {
            controllerId: terminal.tmuxSessionId,
            config: err.config,
            reason: err.reason,
          };
        }
      }
      return null;
    })();

  const handleRetry = useCallback(async () => {
    if (!match) return;
    const op = match.config.tmuxSessionName
      ? terminalService.attachTmux
      : terminalService.createTmux;
    try {
      await op(match.config);
    } catch (e) {
      console.error("Failed to retry tmux controller:", e);
      window.alert(
        `Failed to retry tmux controller: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    setTmuxControllerErrors((prev: Map<number, TmuxControllerError>) => {
      const next = new Map(prev);
      next.delete(match.controllerId);
      return next;
    });
  }, [match, setTmuxControllerErrors]);

  const handleDismiss = useCallback(() => {
    if (!match) return;
    setTmuxControllerErrors((prev: Map<number, TmuxControllerError>) => {
      const next = new Map(prev);
      next.delete(match.controllerId);
      return next;
    });
  }, [match, setTmuxControllerErrors]);

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
