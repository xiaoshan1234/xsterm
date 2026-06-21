import { Session, TmuxState, TmuxWindow } from "../types/session";
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

function getActiveWindow(windows: TmuxWindow[], activeTmuxWindowId: string | null): TmuxWindow | undefined {
  return (
    windows.find((w) =>
      activeTmuxWindowId ? w.id === activeTmuxWindowId : w.isActive
    ) ?? windows[0]
  );
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
  const activeWindow = getActiveWindow(windows, activeTmuxWindowId);

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
        {windows.length === 0 ? (
          <div className="terminal-empty">No active window</div>
        ) : (
          windows.map((window) => {
            const isWindowActive = window.id === activeWindow?.id;
            const panes = window.panes
              .map((pid) => tmuxState.panes.get(pid))
              .filter((p): p is NonNullable<typeof p> => Boolean(p));
            return (
              <div
                key={window.id}
                style={{ display: isWindowActive ? "contents" : "none" }}
              >
                <TmuxLayoutGrid
                  sessionId={session.id}
                  layout={window.layout}
                  panes={panes}
                  onClosePane={(paneId) => closeTmuxPane(session.id, paneId)}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
