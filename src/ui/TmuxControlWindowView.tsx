import { useMemo, useState, useCallback } from "react";
import type { Window } from "../model";
import { useSession } from "../service/legacy/contexts/SessionContext";
import { TmuxSessionControl } from "./TmuxSessionControl";
import { TmuxWindowsControl } from "./TmuxWindowsControl";
import "./TmuxControlWindowView.css";

interface TmuxControlWindowViewProps {
  /** The control-window itself; carries `tmuxControlWindowId` + `tmuxControlName`. */
  window: Window;
}

/**
 * Per-controller "session/window control" surface (ADR 0009 §2.6).
 * Replaces the normal `PaneTree` for `windowType === "tmux-control"`
 * windows. Lays out two cards side-by-side:
 *
 * - Left  — session-control: connect/disconnect + remote-delete buttons.
 * - Right — windows-control: per-tmux-window rename / disconnect /
 *           delete-from-server actions + a "+ New Window" entry point.
 *
 * All chrome follows `doc/design-system.md`: `--surface-card` panels,
 * `--hairline` dividers, `--radius-lg` cards, 400/500 typography.
 */
export function TmuxControlWindowView({ window: controlWindow }: TmuxControlWindowViewProps) {
  const { tmuxWindowListsRef, tmuxControllerErrors, tmuxControllerConfigsRef, createTmuxSession } =
    useSession();
  const controllerId = controlWindow.tmuxControlWindowId ?? 0;
  const tmuxSessionName = controlWindow.tmuxControlName ?? `tmux-${controllerId}`;

  const windows = useMemo(
    () => tmuxWindowListsRef.current.get(controllerId) ?? [],
    [tmuxWindowListsRef, controllerId],
  );

  // The error banner surfaces the retry affordance when the controller
  // has exited. The banner is mounted at the top of the control view
  // so the user sees it from the only place they can re-attach from
  // now that the panes are gone.
  const storedConfig = tmuxControllerConfigsRef.current.get(controllerId);
  const controllerError = tmuxControllerErrors.get(controllerId);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const showErrorBanner = controllerError && !errorDismissed && storedConfig;

  const handleRetry = useCallback(async () => {
    if (!storedConfig) return;
    // ADR 0009 fix: route through createTmuxSession hook so the
    // tmux-cc branch in `createAndActivateSession` installs the
    // control-window + bootstrap pane xsterm Window synchronously.
    // Calling `sessionService.createTmux` / `attachTmux` directly
    // bypassed that hook and left the workspace with no
    // control-window tab.
    try {
      await createTmuxSession(storedConfig, false);
    } catch (e) {
      window.alert(
        `Failed to retry tmux controller: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    setErrorDismissed(true);
  }, [storedConfig, createTmuxSession]);

  const handleDismiss = useCallback(() => {
    setErrorDismissed(true);
  }, []);

  return (
    <div className="tmux-control-window-view">
      {showErrorBanner && (
        <div className="tmux-control-window-view__error" role="alert">
          <div className="tmux-control-window-view__error-msg">
            Tmux controller exited
            {controllerError?.reason ? `: ${controllerError.reason}` : "."} Re-attach below to
            restore the session, or close this control tab to drop it.
          </div>
          <div className="tmux-control-window-view__error-actions">
            <button className="btn btn--secondary" type="button" onClick={handleDismiss}>
              Dismiss
            </button>
            <button className="btn btn--primary" type="button" onClick={handleRetry}>
              Retry
            </button>
          </div>
        </div>
      )}
      <div className="tmux-control-window-view__grid">
        <TmuxSessionControl controllerId={controllerId} tmuxSessionName={tmuxSessionName} />
        <TmuxWindowsControl
          controllerId={controllerId}
          tmuxSessionName={tmuxSessionName}
          windows={windows}
        />
      </div>
    </div>
  );
}
