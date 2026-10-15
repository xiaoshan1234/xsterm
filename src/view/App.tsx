import SplitContainer from "./layout/SplitContainer";
import TabBar from "./layout/TabBar";
import { PaneTreeProviderWithHook } from "./hooks/PaneTreeProvider";
import { usePaneTreeContext } from "./hooks/paneTreeContext";
import "./App.css";

function Workspace() {
  const { activeTabId, activeTree } = usePaneTreeContext();
  return (
    <>
      <TabBar />
      <SplitContainer
        node={activeTree.root}
        tabId={activeTabId}
        focusedPath={activeTree.focusedPath}
      />
    </>
  );
}

export default function App() {
  return (
    <PaneTreeProviderWithHook>
      <Workspace />
    </PaneTreeProviderWithHook>
  );
}
