import { useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "../features/terminal/logic/TerminalContext";
import { DEFAULT_GROUP_ID } from "../features/terminal/logic/state/constants";
import { useAppShortcuts } from "./useAppShortcuts";
import { useTmuxAutoAttach } from "../features/terminal/logic/useTmuxAutoAttach";
import NavBar from "./NavBar";
import Sidebar from "../features/sidebar/Sidebar";
import { WorkspaceContainer } from "../features/workspace/WorkspaceContainer";
import { WorkspaceBottomBar } from "../features/workspace/WorkspaceBottomBar";
import { SettingsView } from "../features/settings/SettingsView";
import CreateTerminalDialog from "../features/terminal/logic/dialogs/CreateTerminalDialog";
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
  const [createTerminalGroupId, setCreateTerminalGroupId] = useState<number>(DEFAULT_GROUP_ID);
  const [createInitialTab, setCreateInitialTab] = useState<"local" | "tmux-pane">("local");
  const [activeView, setActiveView] = useState<"terminal" | "settings">("terminal");
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<
    "appearance" | "shortcuts" | "logging" | "about"
  >("appearance");
  const [sidebarPanel, setSidebarPanel] = useState<
    "chat" | "settings" | "workspace" | "windows" | null
  >(null);
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
    onCreateSession: () => {
      setCreateInitialTab("local");
      setShowCreateDialog(true);
    },
    onToggleLogs: () => {},
  });
  useTmuxAutoAttach();

  const handleLoadWindow = useCallback(
    async (savedWindowId: string) => {
      if (!activeWorkspace) return;
      await loadWindow(savedWindowId, activeWorkspace.id);
    },
    [activeWorkspace, loadWindow],
  );

  return (
    <div className="app-container">
      <NavBar />
      <div className="content-area">
        <Sidebar
          onCreateTerminal={() => {
            setCreateInitialTab("local");
            setCreateTerminalGroupId(DEFAULT_GROUP_ID);
            setShowCreateDialog(true);
          }}
          onCreateTerminalWithGroup={(groupId) => {
            setCreateInitialTab("local");
            setCreateTerminalGroupId(groupId);
            setShowCreateDialog(true);
          }}
          onCreateSession={() => {
            setCreateInitialTab("tmux-pane");
            setCreateTerminalGroupId(DEFAULT_GROUP_ID);
            setShowCreateDialog(true);
          }}
          onCreateSessionWithGroup={(groupId) => {
            setCreateInitialTab("tmux-pane");
            setCreateTerminalGroupId(groupId);
            setShowCreateDialog(true);
          }}
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
          ) : (
            workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`workspace-view ${workspace.id === activeWorkspaceId ? "workspace-view--active" : ""}`}
              >
                <WorkspaceContainer workspace={workspace} commandPanelOpen={showCommandPanel} />
              </div>
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
        </div>
      </div>
      <CreateTerminalDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreateLocal={createLocalSession}
        onCreateSsh={createSshSession}
        onCreateTmux={createTmuxSession}
        initialGroupId={createTerminalGroupId}
        initialTab={createInitialTab}
      />
    </div>
  );
}
