import { useState, useRef, useCallback, useEffect } from "react";
import { useSession } from "../contexts/SessionContext";
import { PaneNode } from "../types/session";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import NavBar from "./NavBar";
import Sidebar from "./sidebar/Sidebar";
import TabBar from "./TabBar";
import { WorkspaceContainer } from "./WorkspaceContainer";
import { EmptyState } from "./EmptyState";
import { SettingsView } from "./settings/SettingsView";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import CommandSendPanel from "./CommandSendPanel";
import { SaveWorkspaceDialog } from "./dialogs/SaveWorkspaceDialog";
import "../styles/pane.css";

const DEFAULT_PANEL_HEIGHT = 140;
const MIN_PANEL_HEIGHT = 80;
const MIN_TERMINAL_HEIGHT = 100;

export default function AppLayout() {
  const {
    workspaces,
    activeWorkspaceId,
    sessions,
    savedConfigs,
    savedWorkspaces,
    setActiveWorkspace,
    closeWorkspace,
    saveWorkspace,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    writeSession,
    loadWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createSessionGroupId, setCreateSessionGroupId] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [sendPanelCollapsed, setSendPanelCollapsed] = useState(true);
  const [activeView, setActiveView] = useState<"terminal" | "settings">("terminal");
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<"appearance" | "shortcuts" | "about">("appearance");
  const [sidebarPanel, setSidebarPanel] = useState<"chat" | "settings" | "workspace" | null>(null);
  const [saveWorkspaceId, setSaveWorkspaceId] = useState<string | null>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  useAppShortcuts({
    onCreateSession: () => setShowCreateDialog(true),
    onToggleLogs: () => {},
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !mainAreaRef.current) return;

      const rect = mainAreaRef.current.getBoundingClientRect();
      const availableHeight = rect.height;
      const relativeYFromBottom = availableHeight - (e.clientY - rect.top);
      const newHeight = Math.max(
        MIN_PANEL_HEIGHT,
        Math.min(availableHeight - MIN_TERMINAL_HEIGHT, relativeYFromBottom)
      );
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleSendPanelToggle = useCallback((collapsed: boolean) => {
    setSendPanelCollapsed(collapsed);
    if (!collapsed && mainAreaRef.current) {
      const rect = mainAreaRef.current.getBoundingClientRect();
      const availableHeight = rect.height;
      setPanelHeight(Math.max(MIN_PANEL_HEIGHT, availableHeight * 0.25));
    }
  }, []);

  const handleSaveWorkspace = useCallback(
    (name: string) => {
      if (saveWorkspaceId) {
        saveWorkspace(saveWorkspaceId, name);
        setSaveWorkspaceId(null);
      }
    },
    [saveWorkspaceId, saveWorkspace]
  );

  const activeSessionId = activeWorkspace
    ? (() => {
        const findActiveSession = (node: typeof activeWorkspace.rootPane): number | null => {
          if (node.type === "leaf") return node.sessionId ?? null;
          for (const child of node.children ?? []) {
            const found = findActiveSession(child);
            if (found !== null) return found;
          }
          return null;
        };
        return activeWorkspace.activePaneId
          ? (() => {
              const node = findPane(activeWorkspace.rootPane, activeWorkspace.activePaneId);
              return node?.sessionId ?? findActiveSession(activeWorkspace.rootPane);
            })()
          : findActiveSession(activeWorkspace.rootPane);
      })()
    : null;

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
        />
        <div className="main-area" ref={mainAreaRef}>
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
              {!sendPanelCollapsed && (
                <div
                  className="panel-resize-handle"
                  onMouseDown={handleMouseDown}
                  title="拖拽调整高度"
                />
              )}
              <CommandSendPanel
                sessions={sessions}
                activeSessionId={activeSessionId}
                writeSession={writeSession}
                style={{ height: sendPanelCollapsed ? "auto" : panelHeight }}
                onToggle={handleSendPanelToggle}
              />
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

function findPane(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPane(child, id);
      if (found) return found;
    }
  }
  return null;
}
