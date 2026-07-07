import { useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "../contexts/SessionContext";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import NavBar from "./NavBar";
import Sidebar from "./sidebar/Sidebar";
import { WorkspaceContainer } from "./WorkspaceContainer";
import { WorkspaceBottomBar } from "./WorkspaceBottomBar";
import { SettingsView } from "./settings/SettingsView";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import "../styles/pane.css";

export default function AppLayout() {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    savedWorkspaces,
    savedWindowConfigs,
    createDefaultWorkspace,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    loadWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
    loadWindow,
    deleteSavedWindow,
    renameSavedWindow,
    closeWorkspace,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createSessionGroupId, setCreateSessionGroupId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<"terminal" | "settings">("terminal");
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<"appearance" | "shortcuts" | "about">("appearance");
  const [sidebarPanel, setSidebarPanel] = useState<"chat" | "settings" | "workspace" | "windows" | null>(null);
  const [showCommandPanel, setShowCommandPanel] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (workspaces.length === 0) {
      createDefaultWorkspace();
    }
  }, []);

  useAppShortcuts({
    onCreateSession: () => setShowCreateDialog(true),
    onToggleLogs: () => {},
  });

  const handleLoadWindow = useCallback(
    async (savedWindowId: string) => {
      if (!activeWorkspace) return;
      await loadWindow(savedWindowId, activeWorkspace.id);
    },
    [activeWorkspace, loadWindow]
  );

  return (
    <div className="app-container">
      <NavBar />
      <div className="content-area">
        <Sidebar
          onCreateSession={() => { setCreateSessionGroupId(null); setShowCreateDialog(true); }}
          onCreateSessionWithGroup={(groupId) => { setCreateSessionGroupId(groupId); setShowCreateDialog(true); }}
          onToggleLogs={() => {}}
          sidebarPanel={sidebarPanel}
          onSidebarPanelChange={(panel) => {
            setSidebarPanel(panel);
            if (panel === "settings") {
              setActiveView("settings");
            } else {
              setActiveView("terminal");
            }
          }}
          activeSettingsCategory={activeSettingsCategory}
          onSelectSettingsCategory={(category) => {
            setActiveSettingsCategory(category);
            setActiveView("settings");
            setSidebarPanel("settings");
          }}
          savedWorkspaces={savedWorkspaces}
          loadWorkspace={loadWorkspace}
          deleteSavedWorkspace={deleteSavedWorkspace}
          renameSavedWorkspace={renameSavedWorkspace}
          savedWindowConfigs={savedWindowConfigs}
          loadWindow={handleLoadWindow}
          deleteSavedWindow={deleteSavedWindow}
          renameSavedWindow={renameSavedWindow}
        />
        <div className="main-area">
          {activeView === "settings" ? (
            <SettingsView activeCategory={activeSettingsCategory} />
          ) : activeWorkspace ? (
            <WorkspaceContainer workspace={activeWorkspace} commandPanelOpen={showCommandPanel} />
          ) : null}
          {activeWorkspace && activeView === "terminal" && (
          <WorkspaceBottomBar
            workspaceName={activeWorkspace.name}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={setActiveWorkspace}
            onCloseWorkspace={closeWorkspace}
            commandPanelOpen={showCommandPanel}
            onToggleCommandPanel={() => setShowCommandPanel((prev) => !prev)}
          />
          )}
        </div>
      </div>
      <CreateSessionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreateLocal={createLocalSession}
        onCreateSsh={createSshSession}
        onCreateTmux={createTmuxSession}
        initialGroupId={createSessionGroupId}
      />
    </div>
  );
}
