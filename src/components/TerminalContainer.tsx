import { Session } from "../types/session";
import Terminal from "./Terminal";

interface TerminalContainerProps {
  sessions: Session[];
  activeSessionId: number | null;
}

export function TerminalContainer({ sessions, activeSessionId }: TerminalContainerProps) {
  return (
    <div className="terminal-container">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`terminal-pane ${session.id === activeSessionId ? "terminal-pane--active" : ""}`}
        >
          <Terminal sessionId={session.id} />
        </div>
      ))}
    </div>
  );
}
