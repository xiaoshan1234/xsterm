import { useCallback } from "react";
import * as sessionService from "../service/legacy/services/sessionService";
import type { TmuxWindowListEntry } from "../model";
import "./TmuxControlWindowView.css";

interface TmuxWindowsControlProps {
  controllerId: number;
  tmuxSessionName: string;
  windows: TmuxWindowListEntry[];
}

/**
 * Right card inside the control-window (ADR 0009 §2.6). Lists every
 * tmux window for this controller with three per-row actions:
 *
 * - Rename → `rename_tmux_window` (round-trips through tmux; the
 *   `tmux-window-renamed` event updates the tab name).
 * - Disconnect → just close every leaf pane in the matching xsterm
 *   Window (the xsterm Window is then dropped from the workspace;
 *   tmux server-side window stays alive).
 * - Delete from tmux server → `kill_tmux_window` (destructive;
 *   frontend Window also disappears via `tmux-window-closed`).
 *
 * The "+ New Window" button at the bottom issues `create_tmux_window`
 * with an optional user-supplied name.
 */
export function TmuxWindowsControl({
  controllerId,
  tmuxSessionName,
  windows,
}: TmuxWindowsControlProps) {
  const handleNewWindow = useCallback(() => {
    const name = window.prompt(`New tmux window name in ${tmuxSessionName}:`, "");
    if (name === null) return;
    const trimmed = name.trim();
    sessionService
      .createTmuxWindow(controllerId, trimmed === "" ? undefined : trimmed)
      .catch((e) =>
        window.alert(`Failed to create tmux window: ${e instanceof Error ? e.message : String(e)}`),
      );
  }, [controllerId, tmuxSessionName]);

  const handleRename = useCallback((entry: TmuxWindowListEntry) => {
    const name = window.prompt(`Rename tmux window "${entry.name}":`, entry.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === entry.name) return;
    sessionService
      .renameTmuxWindow(entry.xstermWindowId, trimmed)
      .catch((e) =>
        window.alert(`Failed to rename tmux window: ${e instanceof Error ? e.message : String(e)}`),
      );
  }, []);

  const handleKill = useCallback((entry: TmuxWindowListEntry) => {
    const confirmed = window.confirm(
      `Permanently delete tmux window "${entry.name}" (${entry.tmuxWindowId}) on the server?`,
    );
    if (!confirmed) return;
    sessionService
      .killTmuxWindow(entry.xstermWindowId)
      .catch((e) =>
        window.alert(`Failed to delete tmux window: ${e instanceof Error ? e.message : String(e)}`),
      );
  }, []);

  return (
    <section className="tmux-card" aria-label="Tmux windows control">
      <header className="tmux-card__header">
        <h3 className="tmux-card__title">Windows of {tmuxSessionName}</h3>
        <span className="tmux-card__subtitle">{windows.length} window(s)</span>
      </header>
      <div className="tmux-card__divider" />
      {windows.length === 0 ? (
        <div className="tmux-windows-empty">
          No tmux windows registered yet. They will appear here as soon as the controller reports
          them via `tmux-window-list`.
        </div>
      ) : (
        <ul className="tmux-windows-list">
          {windows.map((entry) => (
            <li key={entry.tmuxWindowId} className="tmux-windows-row">
              <div className="tmux-windows-row__label">
                <span className="tmux-windows-row__name">{entry.name}</span>
                <span className="tmux-windows-row__id">
                  {entry.tmuxWindowId} · xsterm {entry.xstermWindowId}
                </span>
              </div>
              <div className="tmux-windows-row__actions">
                <button
                  className="tmux-windows-row__action"
                  type="button"
                  onClick={() => handleRename(entry)}
                >
                  Rename
                </button>
                <button
                  className="tmux-windows-row__action tmux-windows-row__action--danger"
                  type="button"
                  onClick={() => handleKill(entry)}
                >
                  Delete from server
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="tmux-card__actions tmux-windows-new">
        <button className="btn btn--secondary" type="button" onClick={handleNewWindow}>
          + New Window
        </button>
      </div>
    </section>
  );
}
