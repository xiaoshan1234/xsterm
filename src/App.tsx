import { useState } from "react";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useKeyboardShortcut } from "./hooks/useKeyboardShortcut";
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
    renameSession,
    setActiveSession,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Keyboard shortcuts
  useKeyboardShortcut({
    key: "n",
    ctrl: true,
    shift: true,
    handler: () => setShowCreateDialog(true),
  });

  useKeyboardShortcut({
    key: "Tab",
    ctrl: true,
    handler: () => {
      if (sessions.length <= 1) return;
      const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
      const nextIndex = (currentIndex + 1) % sessions.length;
      setActiveSession(sessions[nextIndex].id);
    },
  });

  useKeyboardShortcut({
    key: "Tab",
    ctrl: true,
    shift: true,
    handler: () => {
      if (sessions.length <= 1) return;
      const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
      const prevIndex = (currentIndex - 1 + sessions.length) % sessions.length;
      setActiveSession(sessions[prevIndex].id);
    },
  });

  useKeyboardShortcut({
    key: "w",
    ctrl: true,
    handler: () => {
      if (activeSessionId) {
        closeSession(activeSessionId);
      }
    },
  });

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
            onRename={renameSession}
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
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SessionProvider>
  );
}
