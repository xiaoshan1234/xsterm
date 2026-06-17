import { Session } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import Terminal from "./Terminal";
import { TmuxWindowTabs } from "./TmuxWindowTabs";
import { TmuxLayoutGrid } from "./TmuxLayoutGrid";
import "../styles/layout.css";

interface TerminalContainerProps {
  sessions: Session[];
  activeSessionId: number | null;
}

export function TerminalContainer({ sessions, activeSessionId }: TerminalContainerProps) {
  const {
    tmuxState,
    activeTmuxWindowId,
    setActiveTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
    closeTmuxPane,
  } = useSession();

  return (
    <div className="terminal-container">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;

        if (session.type === "tmux" || session.type === "ssh_tmux") {
          const tmuxSessionId = String(session.id);
          const tmuxSession = tmuxState.sessions.get(tmuxSessionId);
          const windows = tmuxSession?.windows
            .map((wid) => tmuxState.windows.get(wid))
            .filter((w): w is NonNullable<typeof w> => Boolean(w)) ?? [];
          const activeWindow = windows.find((w) =>
            activeTmuxWindowId
              ? w.id === activeTmuxWindowId
              : w.isActive
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

        return (
          <div
            key={session.id}
            className={`terminal-pane ${isActive ? "terminal-pane--active" : ""}`}
          >
            <Terminal sessionId={session.id} />
          </div>
        );
      })}
    </div>
  );
}
