import { useMemo, useState } from "react";
import SplitContainer from "./layout/SplitContainer";
import TabBar from "./layout/TabBar";
import TitleBar from "./components/TitleBar";
import StatusBar from "./components/StatusBar";
import Sidebar from "./components/Sidebar";
import { PaneTreeProviderWithHook } from "./hooks/PaneTreeProvider";
import { usePaneTreeContext } from "./hooks/paneTreeContext";
import type { PaneNode } from "../data/model/pane";
import type { SessionId } from "../data/model/session";
import type { SidebarPanel } from "./components/Sidebar";
import "./App.css";

function Workspace() {
  const { activeTabId, activeTree } = usePaneTreeContext();
  const paneNumbers = useMemo(() => {
    const map = new Map<SessionId, number>();
    let counter = 1;
    const visit = (node: PaneNode): void => {
      if (node.kind === "leaf") {
        map.set(node.sessionId, counter++);
        return;
      }
      if (node.kind === "hsplit") {
        visit(node.left);
        visit(node.right);
        return;
      }
      if (node.kind === "vsplit") {
        visit(node.top);
        visit(node.bottom);
      }
    };
    visit(activeTree.root);
    return map;
  }, [activeTree.root]);
  return (
    <div className="workspace">
      <TabBar />
      <SplitContainer
        node={activeTree.root}
        tabId={activeTabId}
        focusedPath={activeTree.focusedPath}
        paneNumbers={paneNumbers}
      />
    </div>
  );
}

export default function App() {
  const [activePanel, setActivePanel] = useState<SidebarPanel | null>(null);
  const togglePanel = () => setActivePanel((current) => (current === null ? "sessions" : null));

  return (
    <PaneTreeProviderWithHook>
      <TitleBar sidebarOpen={activePanel !== null} onToggleSidebar={togglePanel} />
      <div className="contentArea">
        <Sidebar activePanel={activePanel} setActivePanel={setActivePanel} />
        <Workspace />
      </div>
      <StatusBar onToggleSidebar={togglePanel} />
    </PaneTreeProviderWithHook>
  );
}
