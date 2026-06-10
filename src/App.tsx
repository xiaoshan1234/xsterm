import { useState } from "react";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { KeyboardProvider } from "./contexts/KeyboardContext";
import { LoggerProvider } from "./contexts/LoggerContext";
import { useShortcut } from "./hooks/useShortcut";
import Sidebar from "./components/Sidebar";
import NavBar from "./components/NavBar";
import TabBar from "./components/TabBar";
import Terminal from "./components/Terminal";
import CreateSessionDialog from "./components/CreateSessionDialog";
import { LocalSessionConfig, SSHSessionConfig } from "./types/session";
import "./App.css";

function AppContent() {
  const {
    sessions,
    savedConfigs,
    activeSessionId,
    createLocalSession,
    createSshSession,
    closeSession,
    renameSession,
    setActiveSession,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useShortcut({
    key: "n",
    ctrl: true,
    shift: true,
    handler: () => setShowCreateDialog(true),
  });

  useShortcut({
    key: "Tab",
    ctrl: true,
    handler: () => {
      if (sessions.length <= 1) return;
      const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
      const nextIndex = (currentIndex + 1) % sessions.length;
      setActiveSession(sessions[nextIndex].id);
    },
  });

  useShortcut({
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

  useShortcut({
    key: "w",
    ctrl: true,
    handler: () => {
      if (activeSessionId) {
        closeSession(activeSessionId);
      }
    },
  });

  const handleCreateLocal = (config: LocalSessionConfig, save: boolean) =>
    createLocalSession(config, save);

  const handleCreateSsh = (config: SSHSessionConfig, save: boolean) =>
    createSshSession(config, save);

  return (
    <div className="app-container">
      <NavBar />
      <div className="content-area">
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
          {sessions.length === 0 && savedConfigs.length === 0 ? (
            <div className="no-session">
              <p>No active sessions</p>
              <button onClick={() => setShowCreateDialog(true)}>Create Session</button>
            </div>
          ) : sessions.length === 0 && savedConfigs.length > 0 ? (
            <div className="no-session">
              <p>Click a saved session to reconnect</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                style={{
                  display: session.id === activeSessionId ? "block" : "none",
                  width: "100%",
                  height: "100%",
                }}
              >
                <Terminal sessionId={session.id} />
              </div>
            ))
          )}
        </div>
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
        <KeyboardProvider>
          <LoggerProvider>
            <AppContent />
            </LoggerProvider>
        </KeyboardProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
