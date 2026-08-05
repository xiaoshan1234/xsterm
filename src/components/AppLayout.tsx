import { useState, useCallback, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { useSession } from "../contexts/SessionContext";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import NavBar from "./NavBar";
import Sidebar from "./sidebar/Sidebar";
import { WorkspaceContainer } from "./WorkspaceContainer";
import { WorkspaceBottomBar } from "./WorkspaceBottomBar";
import { SettingsView } from "./settings/SettingsView";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";

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
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <NavBar />
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
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
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {activeView === "settings" ? (
            <SettingsView activeCategory={activeSettingsCategory} />
          ) : (
            workspaces.map((workspace) => (
              <Box
                key={workspace.id}
                sx={{
                  flex: 1,
                  display: workspace.id === activeWorkspaceId ? "flex" : "none",
                  flexDirection: "column",
                  minHeight: 0,
                  minWidth: 0,
                }}
              >
                <WorkspaceContainer workspace={workspace} commandPanelOpen={showCommandPanel} />
              </Box>
            ))
          )}
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
        </Box>
      </Box>
      <CreateSessionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreateLocal={createLocalSession}
        onCreateSsh={createSshSession}
        initialGroupId={createSessionGroupId}
      />
    </Box>
  );
}
