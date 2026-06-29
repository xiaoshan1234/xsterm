import { useState, useRef, useCallback, useEffect } from "react";
import { useSession } from "../contexts/SessionContext";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import NavBar from "./NavBar";
import Sidebar from "./sidebar/Sidebar";
import TabBar from "./TabBar";
import { TerminalContainer } from "./TerminalContainer";
import { EmptyState } from "./EmptyState";
import { SettingsView } from "./settings/SettingsView";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import CommandSendPanel from "./CommandSendPanel";

const DEFAULT_PANEL_HEIGHT = 140;
const MIN_PANEL_HEIGHT = 80;
const MIN_TERMINAL_HEIGHT = 100;

export default function AppLayout() {
  const {
    sessions,
    savedConfigs,
    activeSessionId,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    closeSession,
    renameSession,
    setActiveSession,
    writeSession,
    reorderSessions,
  } = useSession();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createSessionGroupId, setCreateSessionGroupId] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [sendPanelCollapsed, setSendPanelCollapsed] = useState(true);
  const [activeView, setActiveView] = useState<"terminal" | "settings">("terminal");
  const [settingsTabVisible, setSettingsTabVisible] = useState(false);
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<"appearance" | "shortcuts" | "about">("appearance");
  const [sidebarPanel, setSidebarPanel] = useState<"chat" | "settings" | null>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

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
      const tabBarHeight = 0; // TabBar is part of main-area flow
      const availableHeight = rect.height - tabBarHeight;
      const relativeYFromBottom = availableHeight - (e.clientY - rect.top - tabBarHeight);
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
      const tabBarHeight = 0;
      const availableHeight = rect.height - tabBarHeight;
      setPanelHeight(Math.max(MIN_PANEL_HEIGHT, availableHeight * 0.25));
    }
  }, []);

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
              setSettingsTabVisible(true);
              setActiveView("settings");
            } else if (panel === "chat") {
              setActiveView("terminal");
            }
          }}
          activeSettingsCategory={activeSettingsCategory}
          onSelectSettingsCategory={(category) => {
            setActiveSettingsCategory(category);
            setActiveView("settings");
            setSettingsTabVisible(true);
            setSidebarPanel("settings");
          }}
        />
        <div className="main-area" ref={mainAreaRef}>
          <TabBar
            sessions={sessions}
            activeId={activeSessionId}
            activeView={activeView}
            showSettingsTab={settingsTabVisible}
            onSelect={(id) => {
              setActiveView("terminal");
              setActiveSession(id);
            }}
            onClose={closeSession}
            onRename={renameSession}
            onReorder={reorderSessions}
            onSelectSettings={() => {
              setActiveView("settings");
              setSidebarPanel("settings");
            }}
            onCloseSettings={() => {
              setSettingsTabVisible(false);
              setActiveView("terminal");
            }}
          />
          {activeView === "settings" ? (
            <SettingsView activeCategory={activeSettingsCategory} />
          ) : sessions.length === 0 ? (
            <EmptyState
              onCreateSession={() => setShowCreateDialog(true)}
              hasSavedConfigs={savedConfigs.length > 0}
            />
          ) : (
            <>
              <TerminalContainer sessions={sessions} activeSessionId={activeSessionId} />
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
    </div>
  );
}
