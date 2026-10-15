import { usePaneTreeContext } from "../hooks/paneTreeContext";
import { collectSessions, findFocusedLeaf } from "../../data/model/pane";
import { SHELL_LABEL, type ShellKind } from "../../data/model/shell";
import "./StatusBar.css";

interface StatusBarProps {
  onToggleSidebar: () => void;
}

function formatShell(shell: ShellKind): string {
  return SHELL_LABEL[shell] ?? shell;
}

export default function StatusBar({ onToggleSidebar }: StatusBarProps) {
  const { tabs, activeTree } = usePaneTreeContext();

  const tabCount = tabs.length;
  const paneCount = collectSessions(activeTree.root).length;
  const focused = findFocusedLeaf(activeTree);
  const focusedShell: ShellKind =
    focused.kind === "leaf" || focused.kind === "init" ? focused.shell : "powershell";

  return (
    <footer className="statusBar" role="status">
      <div className="statusBarLeft">
        <button
          className="statusBarAction"
          type="button"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
        >
          <span className="statusBarActionIcon" aria-hidden="true">
            ▣
          </span>
          <span>Sidebar</span>
        </button>
        <button
          className="statusBarAction statusBarActionMuted"
          type="button"
          disabled
          title="Command panel (M4)"
        >
          <span className="statusBarActionIcon" aria-hidden="true">
            ›_
          </span>
          <span>Commands</span>
        </button>
      </div>
      <div className="statusBarRight">
        <span className="statusBarItem">
          <span className="statusBarItemValue">{tabCount}</span>
          <span>{tabCount === 1 ? "tab" : "tabs"}</span>
        </span>
        <span className="statusBarItem">
          <span className="statusBarItemValue">{paneCount}</span>
          <span>{paneCount === 1 ? "pane" : "panes"}</span>
        </span>
        <span className="statusBarItem statusBarItemShell">
          <span className="statusBarDot" aria-hidden="true" />
          <span className="statusBarItemValue">{formatShell(focusedShell)}</span>
        </span>
        <span className="statusBarDivider" aria-hidden="true" />
        <span className="statusBarItem">
          <span className="statusBarItemValue">xsterm</span>
          <span>v0.1.0</span>
        </span>
      </div>
    </footer>
  );
}
