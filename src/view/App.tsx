import { useState } from "react";
import SplitContainer from "./layout/SplitContainer";
import TabBar from "./layout/TabBar";
import TitleBar from "./components/TitleBar";
import StatusBar from "./components/StatusBar";
import Sidebar from "./components/Sidebar";
import { PaneTreeProviderWithHook } from "./hooks/PaneTreeProvider";
import { usePaneTreeContext } from "./hooks/paneTreeContext";
import type { SidebarPanel } from "./components/Sidebar";
import "./App.css";

export function Workspace() {
  const { tabs, getTree, activeTabId } = usePaneTreeContext();
  return (
    <div className="workspace">
      <TabBar />
      {tabs.map((tab) => (
        <div key={tab.id} className="workspacePanel" hidden={tab.id !== activeTabId}>
          <SplitContainer tree={getTree(tab.id)} tabId={tab.id} />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [activePanel, setActivePanel] = useState<SidebarPanel | null>(null);
  const togglePanel = () => setActivePanel((current) => (current === null ? "sessions" : null));

  return (
    <PaneTreeProviderWithHook>
      <TitleBar />
      <div className="contentArea">
        <Sidebar activePanel={activePanel} setActivePanel={setActivePanel} />
        <Workspace />
      </div>
      <StatusBar onToggleSidebar={togglePanel} />
    </PaneTreeProviderWithHook>
  );
}
