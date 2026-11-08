import {
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
  ManagerStatusHeader,
} from "../../../shared/ui/ManagerPanel";
import { type TmuxStatusControllerViewData } from "../viewModels/statusViewModel";

interface TmuxStatusPanelProps {
  controllers: readonly TmuxStatusControllerViewData[];
  onFocusPane: (terminalId: number) => void;
}

export function TmuxStatusPanel({ controllers, onFocusPane }: TmuxStatusPanelProps) {
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
        <ManagerEmptyState>No live tmux controllers.</ManagerEmptyState>
      ) : (
        controllers.map((controller) => (
          <section key={controller.controllerId} className="manager-section">
            <ManagerRow
              title={controller.title}
              subtitle={`${controller.windows.length} windows · ${controller.transport.toUpperCase()}`}
              badge={controller.status === "connected" ? "Connected" : "Disconnected"}
            />
            {controller.windows.map((window) => (
              <div key={window.tmuxWindowId} className="manager-section-items">
                <ManagerRow
                  title={window.name}
                  subtitle={`${window.tmuxWindowId} · ${window.panes.length} panes`}
                  badge={window.status === "connected" ? "Connected" : "Disconnected"}
                />
                {window.panes.map((pane) => (
                  <ManagerRow
                    key={pane.terminalId}
                    title={pane.title}
                    subtitle={`${pane.tmuxWindowId}/${pane.tmuxPaneId} · ${formatPaneLocation(pane.location)}`}
                    badge={pane.status === "connected" ? "Live" : "Down"}
                    onClick={() => onFocusPane(pane.terminalId)}
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

function formatPaneLocation(
  location: { windowName: string; paneNumber: number } | undefined,
): string {
  return location ? `${location.windowName} / Pane ${location.paneNumber}` : "unattached";
}
