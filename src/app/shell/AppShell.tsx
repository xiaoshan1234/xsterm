import { type ReactNode } from "react";
import { BottomBar } from "./BottomBar";
import { Toolbar } from "./Toolbar";
import { ToolPanel } from "./ToolPanel";
import { type ToolId } from "./types";
import { useToolPanelWidth } from "./useToolPanelWidth";
import "./AppShell.css";

interface AppShellProps {
  activeTool: ToolId | null;
  navBar: ReactNode;
  toolTitle: string;
  toolPanelContent: ReactNode;
  mainArea: ReactNode;
  textSender: ReactNode;
  overlay: ReactNode;
  workspaceName: string;
  workspaces: readonly string[];
  isTextSenderOpen: boolean;
  isInteractionBlocked?: boolean;
  onSelectTool: (tool: ToolId) => void;
  onSelectWorkspace: (workspaceName: string) => void;
  onToggleTextSender: () => void;
}

export function AppShell({
  activeTool,
  navBar,
  toolTitle,
  toolPanelContent,
  mainArea,
  textSender,
  overlay,
  workspaceName,
  workspaces,
  isTextSenderOpen,
  isInteractionBlocked = false,
  onSelectTool,
  onSelectWorkspace,
  onToggleTextSender,
}: AppShellProps) {
  const { width: toolPanelWidth, startResize, nudgeWidth } = useToolPanelWidth();

  return (
    <div className="shell-root">
      <div
        className="shell-content"
        {...(isInteractionBlocked ? { inert: true, "aria-hidden": true } : {})}
      >
        {navBar}
        <div className="shell-body">
          <aside className="shell-left-sidebar">
            <Toolbar activeTool={activeTool} onSelectTool={onSelectTool} />
            {activeTool && (
              <ToolPanel
                title={toolTitle}
                width={toolPanelWidth}
                onResizeStart={startResize}
                onResizeBy={nudgeWidth}
              >
                {toolPanelContent}
              </ToolPanel>
            )}
          </aside>
          <main className="shell-main-area">
            <div className="shell-main-content">{mainArea}</div>
            {isTextSenderOpen && <div className="shell-text-sender-slot">{textSender}</div>}
          </main>
        </div>
        <BottomBar
          workspaceName={workspaceName}
          workspaces={workspaces}
          isTextSenderOpen={isTextSenderOpen}
          onToggleTextSender={onToggleTextSender}
          onSelectWorkspace={onSelectWorkspace}
        />
      </div>
      {overlay}
    </div>
  );
}
