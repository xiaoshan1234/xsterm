import { useState, useCallback } from "react";
import { useSession } from "../contexts/SessionContext";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import NavBar from "./NavBar";
import Sidebar from "./sidebar/Sidebar";
import TabBar from "./TabBar";
import { WorkspaceContainer } from "./WorkspaceContainer";
import { EmptyState } from "./EmptyState";
import { SettingsView } from "./settings/SettingsView";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import { SaveWorkspaceDialog } from "./dialogs/SaveWorkspaceDialog";
import "../styles/pane.css";

export default function AppLayout() {
  const {
    workspaces,
    activeWorkspaceId,
    sessions,
    savedConfigs,
    savedWorkspaces,
    savedWindowConfigs,
    setActiveWorkspace,
    closeWorkspace,
    saveWorkspace,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    loadWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
    loadWindow,
    deleteSavedWindow,
    renameSavedWindow,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createSessionGroupId, setCreateSessionGroupId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<"terminal" | "settings">("terminal");
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<"appearance" | "shortcuts" | "about">("appearance");
  const [sidebarPanel, setSidebarPanel] = useState<"chat" | "settings" | "workspace" | "windows" | null>(null);
  const [saveWorkspaceId, setSaveWorkspaceId] = useState<string | null>(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  useAppShortcuts({
    onCreateSession: () => setShowCreateDialog(true),
    onToggleLogs: () => {},
  });

  const handleSaveWorkspace = useCallback(
    (name: string) => {
      if (saveWorkspaceId) {
        saveWorkspace(saveWorkspaceId, name);
        setSaveWorkspaceId(null);
      }
    },
    [saveWorkspaceId, saveWorkspace]
  );

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
          ) : workspaces.length === 0 ? (
            <EmptyState
              onCreateSession={() => setShowCreateDialog(true)}
              hasSavedConfigs={savedConfigs.length > 0}
            />
          ) : (
            <>
              <TabBar
                workspaces={workspaces}
                sessions={sessions}
                activeWorkspaceId={activeWorkspaceId}
                onSelect={setActiveWorkspace}
                onClose={closeWorkspace}
                onSave={(id) => setSaveWorkspaceId(id)}
              />
              {activeWorkspace ? (
                <WorkspaceContainer workspace={activeWorkspace} />
              ) : (
                <EmptyState
                  onCreateSession={() => setShowCreateDialog(true)}
                  hasSavedConfigs={savedConfigs.length > 0}
                />
              )}
            </>
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
      <SaveWorkspaceDialog
        isOpen={saveWorkspaceId !== null}
        onClose={() => setSaveWorkspaceId(null)}
        onSave={handleSaveWorkspace}
        defaultName={activeWorkspace?.name ?? "My Workspace"}
      />
    </div>
  );
}
