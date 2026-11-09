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

interface TmuxStatusPanelProps {
  controllers: readonly TmuxStatusControllerViewData[];
  onFocusPane: (terminalId: number) => void;
}

export function TmuxStatusPanel({ controllers, onFocusPane }: TmuxStatusPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const paneCount = controllers.reduce(
    (total, controller) =>
      total +
      controller.windows.reduce((windowTotal, window) => windowTotal + window.panes.length, 0),
    0,
  );

  return (
    <ManagerPanelFrame>
      <ManagerStatusHeader
        label="Runtime status"
        value={`${controllers.length} controllers · ${paneCount} panes`}
      />
      {controllers.length === 0 ? (
        <ManagerEmptyState>No live Tmux controllers.</ManagerEmptyState>
      ) : (
        controllers.map((controller) => (
          <section key={controller.controllerId} className="manager-section">
            <ManagerRow
              title={controller.title}
              subtitle={`${controller.windows.length} windows · ${controller.transport.toUpperCase()}`}
              badge={controller.status === "connected" ? "Connected" : "Disconnected"}
              isSelected={selectedKey === `controller:${controller.controllerId}`}
              onSelect={() => setSelectedKey(`controller:${controller.controllerId}`)}
              onOpen={() => focusFirstPane(controller.windows, onFocusPane)}
              contextMenuItems={focusMenuItems(controller.windows, onFocusPane)}
            />
            {controller.windows.map((window) => (
              <div key={window.tmuxWindowId} className="manager-section-items">
                <ManagerRow
                  title={window.name}
                  subtitle={`${window.tmuxWindowId} · ${window.panes.length} panes`}
                  badge={window.status === "connected" ? "Connected" : "Disconnected"}
                  isSelected={
                    selectedKey === `window:${controller.controllerId}:${window.tmuxWindowId}`
                  }
                  onSelect={() =>
                    setSelectedKey(`window:${controller.controllerId}:${window.tmuxWindowId}`)
                  }
                  onOpen={() => focusFirstPane([window], onFocusPane)}
                  contextMenuItems={focusMenuItems([window], onFocusPane)}
                />
                {window.panes.map((pane) => (
                  <ManagerRow
                    key={pane.terminalId}
                    title={pane.title}
                    subtitle={`${pane.tmuxWindowId}/${pane.tmuxPaneId} · ${formatPaneLocation(pane.location)}`}
                    badge={pane.status === "connected" ? "Live" : "Down"}
                    isSelected={
                      selectedKey === `pane:${controller.controllerId}:${pane.terminalId}`
                    }
                    onSelect={() =>
                      setSelectedKey(`pane:${controller.controllerId}:${pane.terminalId}`)
                    }
                    onOpen={() => onFocusPane(pane.terminalId)}
                    contextMenuItems={[
                      {
                        id: "focus",
                        label: "Focus",
                        onClick: () => onFocusPane(pane.terminalId),
                      },
                    ]}
                  />
                ))}
              </div>
            ))}
          </section>
        ))
      )}
    </ManagerPanelFrame>
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
