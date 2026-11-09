import { useState } from "react";
import {
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
  ManagerStatusHeader,
} from "../../../shared/ui/ManagerPanel";
import {
  type TmuxStatusControllerViewData,
  type TmuxStatusWindowViewData,
} from "../viewModels/statusViewModel";
import "./TmuxStatusPanel.css";

interface TmuxStatusPanelProps {
  controllers: readonly TmuxStatusControllerViewData[];
  onFocusPane: (terminalId: number) => void;
}

export function TmuxStatusPanel({ controllers, onFocusPane }: TmuxStatusPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(new Set());
  const paneCount = controllers.reduce(
    (total, controller) =>
      total +
      controller.windows.reduce((windowTotal, window) => windowTotal + window.panes.length, 0),
    0,
  );

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
      <ManagerStatusHeader
        label="Runtime status"
        value={`${controllers.length} controllers · ${paneCount} panes`}
      />
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
}

function TmuxSessionTree({
  controller,
  selectedKey,
  collapsedKeys,
  onSelect,
  onToggleCollapsed,
  onFocusPane,
}: TmuxSessionTreeProps) {
  const sessionKey = `session:${controller.controllerId}`;
  const isCollapsed = collapsedKeys.has(sessionKey);
  const sessionTitle = controller.sessionName
    ? `${controller.sessionName} (#${controller.controllerId})`
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
        contextMenuItems={focusMenuItems(controller.windows, onFocusPane)}
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
        subtitle={`${window.tmuxWindowId} · ${window.panes.length} panes`}
        badge={window.status === "connected" ? "Connected" : "Disconnected"}
        isSelected={selectedKey === windowKey}
        onSelect={() => onSelect(windowKey)}
        onOpen={() => focusFirstPane([window], onFocusPane)}
        isExpanded={!isCollapsed}
        onToggleExpand={() => onToggleCollapsed(windowKey)}
        contextMenuItems={focusMenuItems([window], onFocusPane)}
      />
      {!isCollapsed && (
        <div className="tmux-status-children">
          {window.panes.map((pane) => {
            const paneKey = `pane:${controllerId}:${pane.terminalId}`;
            return (
              <ManagerRow
                key={pane.terminalId}
                title={pane.title}
                subtitle={`${pane.tmuxWindowId}/${pane.tmuxPaneId} · ${formatPaneLocation(pane.location)}`}
                badge={pane.status === "connected" ? "Live" : "Down"}
                isSelected={selectedKey === paneKey}
                onSelect={() => onSelect(paneKey)}
                onOpen={() => onFocusPane(pane.terminalId)}
                reserveChevron
                contextMenuItems={[
                  {
                    id: "focus",
                    label: "Focus",
                    onClick: () => onFocusPane(pane.terminalId),
                  },
                ]}
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

function focusMenuItems(
  windows: readonly TmuxStatusWindowViewData[],
  onFocusPane: (terminalId: number) => void,
): Array<{ id: string; label: string; onClick: () => void }> {
  const terminalId = firstPaneId(windows);
  if (terminalId === undefined) return [];
  return [
    {
      id: "focus",
      label: "Focus First Pane",
      onClick: () => onFocusPane(terminalId),
    },
  ];
}

function formatPaneLocation(
  location: { windowName: string; paneNumber: number } | undefined,
): string {
  return location ? `${location.windowName} / Pane ${location.paneNumber}` : "unattached";
}
