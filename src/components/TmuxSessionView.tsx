import { Session, TmuxState } from "../types/session";
import { TmuxWindowTabs } from "./TmuxWindowTabs";
import { TmuxLayoutGrid } from "./TmuxLayoutGrid";

interface TmuxSessionViewProps {
  session: Session;
  isActive: boolean;
  tmuxState: TmuxState;
  activeTmuxWindowId: string | null;
  setActiveTmuxWindow: (sessionId: number, windowId: string) => void;
  createTmuxWindow: (sessionId: number) => Promise<void>;
  closeTmuxWindow: (sessionId: number, windowId: string) => Promise<void>;
  closeTmuxPane: (sessionId: number, paneId: string) => Promise<void>;
}

export function TmuxSessionView({
  session,
  isActive,
  tmuxState,
  activeTmuxWindowId,
  setActiveTmuxWindow,
  createTmuxWindow,
  closeTmuxWindow,
  closeTmuxPane,
}: TmuxSessionViewProps) {
  const tmuxSessionId = String(session.id);
  const tmuxSession = tmuxState.sessions.get(tmuxSessionId);
  const windows =
    tmuxSession?.windows
      .map((wid) => tmuxState.windows.get(wid))
      .filter((w): w is NonNullable<typeof w> => Boolean(w)) ?? [];
  const activeWindow =
    windows.find((w) =>
      activeTmuxWindowId ? w.id === activeTmuxWindowId : w.isActive
    ) ?? windows[0];

  return (
    <div
      key={session.id}
      className={`terminal-pane tmux-pane ${isActive ? "terminal-pane--active" : ""}`}
    >
      <TmuxWindowTabs
        windows={windows}
        activeWindowId={activeWindow?.id ?? null}
        onSelect={(windowId) => setActiveTmuxWindow(session.id, windowId)}
        onCreate={() => createTmuxWindow(session.id)}
        onClose={(windowId) => closeTmuxWindow(session.id, windowId)}
      />
      <div className="tmux-pane-grid">
        {activeWindow ? (
          <TmuxLayoutGrid
            sessionId={session.id}
            layout={activeWindow.layout}
            panes={activeWindow.panes
              .map((pid) => tmuxState.panes.get(pid))
              .filter((p): p is NonNullable<typeof p> => Boolean(p))}
            onClosePane={(paneId) => closeTmuxPane(session.id, paneId)}
          />
        ) : (
          <div className="terminal-empty">No active window</div>
        )}
      </div>
    </div>
  );
}
