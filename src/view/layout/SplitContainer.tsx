import type { PaneNode, PanePath } from "../../data/model/pane";
import type { SessionId } from "../../data/model/session";
import PaneChrome from "../components/PaneChrome";
import PaneInitCard from "../components/PaneInitCard";
import { usePaneTreeContext } from "../hooks/paneTreeContext";
import "./SplitContainer.css";

interface SplitContainerProps {
  node: PaneNode;
  tabId: number;
  focusedPath: PanePath;
  paneNumbers: Map<SessionId, number>;
}

function pathAt(path: PanePath, step: 0 | 1): PanePath {
  return [...path, step];
}

function isFocused(path: PanePath, focused: PanePath): boolean {
  if (path.length !== focused.length) return false;
  for (let i = 0; i < path.length; i++) {
    if (path[i] !== focused[i]) return false;
  }
  return true;
}

export default function SplitContainer({
  node,
  tabId,
  focusedPath,
  paneNumbers,
}: SplitContainerProps) {
  const { initToLeaf, splitActivePane, closeLeaf, focusLeaf } = usePaneTreeContext();

  if (node.kind === "leaf") {
    const paneNumber = paneNumbers.get(node.sessionId) ?? 0;
    return (
      <PaneChrome
        tabId={tabId}
        path={focusedPath}
        focused={isFocused(focusedPath, focusedPath)}
        leaf={node}
        paneNumber={paneNumber}
        onFocus={() => focusLeaf(tabId, node.sessionId)}
        onSplitH={() => void splitActivePane(tabId, "h")}
        onSplitV={() => void splitActivePane(tabId, "v")}
        onClose={() => void closeLeaf(tabId, node.sessionId)}
      />
    );
  }

  if (node.kind === "init") {
    return <PaneInitCard shell={node.shell} onCreate={() => void initToLeaf(tabId)} />;
  }

  if (node.kind === "hsplit") {
    return (
      <div className="splitContainer splitH">
        <div className="splitPane">
          <SplitContainer
            node={node.left}
            tabId={tabId}
            focusedPath={pathAt(focusedPath, 0)}
            paneNumbers={paneNumbers}
          />
        </div>
        <div className="splitPane">
          <SplitContainer
            node={node.right}
            tabId={tabId}
            focusedPath={pathAt(focusedPath, 1)}
            paneNumbers={paneNumbers}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="splitContainer splitV">
      <div className="splitPane">
        <SplitContainer
          node={node.top}
          tabId={tabId}
          focusedPath={pathAt(focusedPath, 0)}
          paneNumbers={paneNumbers}
        />
      </div>
      <div className="splitPane">
        <SplitContainer
          node={node.bottom}
          tabId={tabId}
          focusedPath={pathAt(focusedPath, 1)}
          paneNumbers={paneNumbers}
        />
      </div>
    </div>
  );
}
