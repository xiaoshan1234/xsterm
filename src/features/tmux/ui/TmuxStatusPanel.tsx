import { useState } from "react";
import { ManagerEmptyState, ManagerPanelFrame, ManagerRow } from "../../../shared/ui/ManagerPanel";
import {
  type TmuxStatusControllerViewData,
  type TmuxStatusWindowViewData,
} from "../viewModels/statusViewModel";
import "./TmuxStatusPanel.css";

interface TmuxStatusPanelProps {
  controllers: readonly TmuxStatusControllerViewData[];
  onFocusPane: (terminalId: number) => void;
  onReconnectSession: (controllerId: number) => void;
  onDetachSession: (controllerId: number) => void;
}

export function TmuxStatusPanel({
  controllers,
  onFocusPane,
  onReconnectSession,
  onDetachSession,
}: TmuxStatusPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(new Set());

  const toggleCollapsed = (key: string) => {
    setCollapsedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <ManagerPanelFrame>
      {controllers.length === 0 ? (
        <ManagerEmptyState>No live Tmux controllers.</ManagerEmptyState>
      ) : (
        <div className="tmux-status-tree">
          {controllers.map((controller) => (
            <TmuxSessionTree
              key={controller.controllerId}
              controller={controller}
              selectedKey={selectedKey}
              collapsedKeys={collapsedKeys}
              onSelect={setSelectedKey}
              onToggleCollapsed={toggleCollapsed}
              onFocusPane={onFocusPane}
              onReconnectSession={onReconnectSession}
              onDetachSession={onDetachSession}
            />
          ))}
        </div>
      )}
    </ManagerPanelFrame>
  );
}

interface TmuxSessionTreeProps {
  controller: TmuxStatusControllerViewData;
  selectedKey: string | null;
  collapsedKeys: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onToggleCollapsed: (key: string) => void;
  onFocusPane: (terminalId: number) => void;
  onReconnectSession: (controllerId: number) => void;
  onDetachSession: (controllerId: number) => void;
}

function TmuxSessionTree({
  controller,
  selectedKey,
  collapsedKeys,
  onSelect,
  onToggleCollapsed,
  onFocusPane,
  onReconnectSession,
  onDetachSession,
}: TmuxSessionTreeProps) {
  const sessionKey = `session:${controller.controllerId}`;
  const isCollapsed = collapsedKeys.has(sessionKey);
  const sessionTitle = controller.sessionName
    ? `${controller.sessionName}:${controller.controllerId}`
    : controller.title;

  return (
    <section className="tmux-status-session">
      <ManagerRow
        title={sessionTitle}
        subtitle={`${controller.windows.length} windows · ${controller.transport.toUpperCase()}`}
        badge={controller.status === "connected" ? "Connected" : "Disconnected"}
        isSelected={selectedKey === sessionKey}
        onSelect={() => onSelect(sessionKey)}
        onOpen={() => focusFirstPane(controller.windows, onFocusPane)}
        isExpanded={!isCollapsed}
        onToggleExpand={() => onToggleCollapsed(sessionKey)}
        contextMenuItems={[
          {
            id: "reconnect-session",
            label: "Reconnect Session",
            onClick: () => onReconnectSession(controller.controllerId),
          },
          {
            id: "detach-session",
            label: "Detach Session",
            onClick: () => onDetachSession(controller.controllerId),
          },
        ]}
      />
      {!isCollapsed && (
        <div className="tmux-status-children">
          {controller.windows.map((window) => (
            <TmuxWindowTree
              key={window.tmuxWindowId}
              controllerId={controller.controllerId}
              window={window}
              selectedKey={selectedKey}
              collapsedKeys={collapsedKeys}
              onSelect={onSelect}
              onToggleCollapsed={onToggleCollapsed}
              onFocusPane={onFocusPane}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface TmuxWindowTreeProps {
  controllerId: number;
  window: TmuxStatusWindowViewData;
  selectedKey: string | null;
  collapsedKeys: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onToggleCollapsed: (key: string) => void;
  onFocusPane: (terminalId: number) => void;
}

function TmuxWindowTree({
  controllerId,
  window,
  selectedKey,
  collapsedKeys,
  onSelect,
  onToggleCollapsed,
  onFocusPane,
}: TmuxWindowTreeProps) {
  const windowKey = `window:${controllerId}:${window.tmuxWindowId}`;
  const isCollapsed = collapsedKeys.has(windowKey);

  return (
    <div className="tmux-status-window">
      <ManagerRow
        title={window.name}
        subtitle={`${window.windowIndex ?? "?"} · ${window.panes.length} panes`}
        badge={window.status === "connected" ? "Connected" : "Disconnected"}
        isSelected={selectedKey === windowKey}
        onSelect={() => {
          onSelect(windowKey);
          focusFirstPane([window], onFocusPane);
        }}
        onOpen={() => focusFirstPane([window], onFocusPane)}
        isExpanded={!isCollapsed}
        onToggleExpand={() => onToggleCollapsed(windowKey)}
      />
      {!isCollapsed && (
        <div className="tmux-status-children">
          {window.panes.map((pane) => {
            const paneKey = `pane:${controllerId}:${pane.terminalId}`;
            return (
              <ManagerRow
                key={pane.terminalId}
                title={pane.currentCommand ?? pane.title}
                subtitle={`${pane.windowIndex ?? "?"}.${pane.paneIndex ?? "?"} · ${pane.width ?? "?"}x${pane.height ?? "?"}${pane.isActive ? " · ACTIVE" : ""}`}
                badge={pane.status === "connected" ? "Live" : "Down"}
                isSelected={selectedKey === paneKey}
                onSelect={() => {
                  onSelect(paneKey);
                  onFocusPane(pane.terminalId);
                }}
                onOpen={() => onFocusPane(pane.terminalId)}
                reserveChevron
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function firstPaneId(windows: readonly TmuxStatusWindowViewData[]): number | undefined {
  for (const window of windows) {
    const pane = window.panes[0];
    if (pane) return pane.terminalId;
  }
  return undefined;
}

function focusFirstPane(
  windows: readonly TmuxStatusWindowViewData[],
  onFocusPane: (terminalId: number) => void,
): void {
  const terminalId = firstPaneId(windows);
  if (terminalId !== undefined) onFocusPane(terminalId);
}
