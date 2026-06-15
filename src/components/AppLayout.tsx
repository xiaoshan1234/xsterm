import { useState } from "react";
import { useSession } from "../contexts/SessionContext";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import NavBar from "./NavBar";
import Sidebar from "./sidebar/Sidebar";
import TabBar from "./TabBar";
import { TerminalContainer } from "./TerminalContainer";
import { EmptyState } from "./EmptyState";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import CommandSendPanel from "./CommandSendPanel";

export default function AppLayout() {
  const {
    sessions,
    savedConfigs,
    activeSessionId,
    createLocalSession,
    createSshSession,
    closeSession,
    renameSession,
    setActiveSession,
    writeSession,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useAppShortcuts({
    onCreateSession: () => setShowCreateDialog(true),
    onToggleLogs: () => {},
  });

  return (
    <div className="app-container">
      <NavBar />
      <div className="content-area">
        <Sidebar
          onCreateSession={() => setShowCreateDialog(true)}
          onToggleLogs={() => {}}
        />
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
          {sessions.length === 0 ? (
            <EmptyState
              onCreateSession={() => setShowCreateDialog(true)}
              hasSavedConfigs={savedConfigs.length > 0}
            />
          ) : (
            <TerminalContainer sessions={sessions} activeSessionId={activeSessionId} />
          )}
          {sessions.length > 0 && (
            <CommandSendPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              writeSession={writeSession}
            />
          )}
        </div>
      </div>
      <CreateSessionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreateLocal={createLocalSession}
        onCreateSsh={createSshSession}
      />
    </div>
  );
}
