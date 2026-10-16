import type { ReactNode } from "react";
import type { PaneNode, PanePath, PaneTree } from "../../data/model/pane";
import PaneChrome from "../components/PaneChrome";
import PaneInitCard from "../components/PaneInitCard";
import { usePaneTreeContext } from "../hooks/paneTreeContext";
import "./SplitContainer.css";

interface SplitContainerProps {
  tree: PaneTree;
  tabId: number;
}

function pathAt(path: PanePath, step: 0 | 1): PanePath {
  return [...path, step];
}

function pathEquals(a: PanePath, b: PanePath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default function SplitContainer({ tree, tabId }: SplitContainerProps) {
  const { initToLeaf } = usePaneTreeContext();
  const paneNumbers = new Map<number, number>();
  let counter = 1;
  const assign = (node: PaneNode) => {
    if (node.kind === "leaf") {
      paneNumbers.set(node.sessionId, counter++);
      return;
    }
    if (node.kind === "hsplit") {
      assign(node.left);
      assign(node.right);
      return;
    }
    if (node.kind === "vsplit") {
      assign(node.top);
      assign(node.bottom);
    }
  };
  assign(tree.root);

  return renderNode(tree.root, tree.focusedPath, tabId);

  function renderNode(node: PaneNode, focusedPath: PanePath, tabId: number): ReactNode {
    if (node.kind === "leaf") {
      return (
        <PaneChrome
          key={`leaf-${node.sessionId}`}
          tabId={tabId}
          sessionId={node.sessionId}
          focused={pathEquals(focusedPath, tree.focusedPath)}
          paneNumber={paneNumbers.get(node.sessionId) ?? 0}
          style={{ position: "absolute", inset: 0 }}
        />
      );
    }
    if (node.kind === "init") {
      return <PaneInitCard shell={node.shell} onCreate={() => void initToLeaf(tabId)} />;
    }
    if (node.kind === "hsplit") {
      return (
        <div key="hsplit" className="splitContainer splitH">
          <div className="splitPane">{renderNode(node.left, pathAt(focusedPath, 0), tabId)}</div>
          <div className="splitPane">{renderNode(node.right, pathAt(focusedPath, 1), tabId)}</div>
        </div>
      );
    }
    return (
      <div key="vsplit" className="splitContainer splitV">
        <div className="splitPane">{renderNode(node.top, pathAt(focusedPath, 0), tabId)}</div>
        <div className="splitPane">{renderNode(node.bottom, pathAt(focusedPath, 1), tabId)}</div>
      </div>
    );
  }
}
