import { useState } from "react";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import Terminal from "./components/Terminal";
import CreateSessionDialog from "./components/CreateSessionDialog";
import { LocalSessionConfig, SSHSessionConfig } from "./types/session";
import "./App.css";

function AppContent() {
  const {
    sessions,
    activeSessionId,
    createLocalSession,
    createSshSession,
    closeSession,
    setActiveSession,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleCreateLocal = (config: LocalSessionConfig) => {
    createLocalSession(config);
  };

  const handleCreateSsh = (config: SSHSessionConfig) => {
    createSshSession(config);
  };

  return (
    <div className="app-container">
      <Sidebar onCreateSession={() => setShowCreateDialog(true)} />
      <div className="main-area">
        {sessions.length > 0 && (
          <TabBar
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={setActiveSession}
            onClose={closeSession}
          />
        )}
        <div className="terminal-container">
          {sessions.length === 0 ? (
            <div className="no-session">
              <p>No active sessions</p>
              <button onClick={() => setShowCreateDialog(true)}>Create Session</button>
            </div>
          ) : activeSessionId ? (
            sessions.map(
              (session) =>
                session.id === activeSessionId && (
                  <Terminal key={session.id} sessionId={session.id} />
                )
            )
          ) : null}
        </div>
      </div>
      <CreateSessionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreateLocal={handleCreateLocal}
        onCreateSsh={handleCreateSsh}
      />
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
}