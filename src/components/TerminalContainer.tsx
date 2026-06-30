import { Session } from "../types/session";

interface TerminalContainerProps {
  sessions: Session[];
}

export function TerminalContainer({ sessions }: TerminalContainerProps) {
  return (
    <div className="terminal-container">
      {sessions.map((session) => (
        <div key={session.id}>{session.name}</div>
      ))}
    </div>
  );
}
