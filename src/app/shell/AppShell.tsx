import { type ReactNode } from "react";
import { BottomBar } from "./BottomBar";
import { Toolbar } from "./Toolbar";
import { ToolPanel } from "./ToolPanel";
import { type ToolId } from "./types";
import { useToolPanelWidth } from "./useToolPanelWidth";
import {
  MAX_TEXT_SENDER_HEIGHT,
  MIN_TEXT_SENDER_HEIGHT,
  useTextSenderHeight,
} from "./useTextSenderHeight";
import { type RuntimeStatusViewData } from "./runtimeStatusViewModel";
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
  runtimeStatus: RuntimeStatusViewData | null;
  isTextSenderOpen: boolean;
  isInteractionBlocked?: boolean;
  onSelectTool: (tool: ToolId) => void;
  onSelectWorkspace: (workspaceName: string) => void;
  onCloseWorkspace: (workspaceName: string) => void;
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
  runtimeStatus,
  isTextSenderOpen,
  isInteractionBlocked = false,
  onSelectTool,
  onSelectWorkspace,
  onCloseWorkspace,
  onToggleTextSender,
}: AppShellProps) {
  const { width: toolPanelWidth, startResize, nudgeWidth } = useToolPanelWidth();
  const {
    height: textSenderHeight,
    startResize: startTextSenderResize,
    nudgeHeight: nudgeTextSenderHeight,
  } = useTextSenderHeight();

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
            <div
              className={`shell-text-sender-slot ${
                isTextSenderOpen ? "" : "shell-text-sender-slot--closed"
              }`}
              aria-hidden={!isTextSenderOpen}
              style={isTextSenderOpen ? { height: `${textSenderHeight}px` } : undefined}
            >
              {isTextSenderOpen && (
                <div
                  className="shell-text-sender-resizer"
                  role="separator"
                  aria-label="Resize Sender"
                  aria-orientation="horizontal"
                  aria-valuemin={MIN_TEXT_SENDER_HEIGHT}
                  aria-valuemax={MAX_TEXT_SENDER_HEIGHT}
                  aria-valuenow={textSenderHeight}
                  tabIndex={0}
                  onMouseDown={startTextSenderResize}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      nudgeTextSenderHeight(8);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      nudgeTextSenderHeight(-8);
                    }
                  }}
                />
              )}
              {textSender}
            </div>
          </main>
        </div>
        <BottomBar
          workspaceName={workspaceName}
          workspaces={workspaces}
          runtimeStatus={runtimeStatus}
          isTextSenderOpen={isTextSenderOpen}
          onToggleTextSender={onToggleTextSender}
          onSelectWorkspace={onSelectWorkspace}
          onCloseWorkspace={onCloseWorkspace}
        />
      </div>
      {overlay}
    </div>
  );
}
