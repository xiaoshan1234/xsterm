import { useMemo } from "react";
import { Session } from "../types/session";
import { useSession } from "../contexts/SessionContext";
import Terminal from "./Terminal";
import { TmuxSessionView } from "./TmuxSessionView";
import "../styles/layout.css";

interface TerminalContainerProps {
  sessions: Session[];
  activeSessionId: number | null;
}

export function TerminalContainer({ sessions, activeSessionId }: TerminalContainerProps) {
  const {
    tmuxState,
    activeTmuxWindowIds,
    setActiveTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
    closeTmuxPane,
  } = useSession();

  // Keep pane DOM order stable by session ID so React doesn't remount/reorder
  // xterm instances when the session tab order changes.
  const stableSessions = useMemo(
    () => [...sessions].sort((a, b) => a.id - b.id),
    [sessions]
  );

  return (
    <div className="terminal-container">
      {stableSessions.map((session) => {
        const isActive = session.id === activeSessionId;

        if (session.type === "tmux" || session.type === "ssh_tmux") {
          return (
            <TmuxSessionView
              key={session.id}
              session={session}
              isActive={isActive}
              tmuxState={tmuxState}
              activeTmuxWindowIds={activeTmuxWindowIds}
              setActiveTmuxWindow={setActiveTmuxWindow}
              createTmuxWindow={createTmuxWindow}
              closeTmuxWindow={closeTmuxWindow}
              closeTmuxPane={closeTmuxPane}
            />
          );
        }

        return (
          <div
            key={session.id}
            className={`terminal-pane ${isActive ? "terminal-pane--active" : ""}`}
          >
            <Terminal sessionId={session.id} sessionType={session.type} />
          </div>
        );
      })}
    </div>
  );
}
