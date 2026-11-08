import {
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
  ManagerStatusHeader,
} from "../../../shared/ui/ManagerPanel";
import { type TerminalStatusItemViewData } from "../viewModels/statusViewModel";

interface TerminalStatusPanelProps {
  items: readonly TerminalStatusItemViewData[];
  onFocus: (terminalId: number) => void;
  onReconnect: (terminalId: number) => void;
  onClose: (terminalId: number) => void;
}

export function TerminalStatusPanel({
  items,
  onFocus,
  onReconnect,
  onClose,
}: TerminalStatusPanelProps) {
  const connectedCount = items.filter((item) => item.status === "connected").length;

  return (
    <ManagerPanelFrame>
      <ManagerStatusHeader
        label="Runtime status"
        value={`${connectedCount}/${items.length} connected`}
      />
      {items.length === 0 ? (
        <ManagerEmptyState>No live terminals.</ManagerEmptyState>
      ) : (
        items.map((item) => (
          <ManagerRow
            key={item.terminalId}
            title={item.title}
            subtitle={formatLocation(item)}
            badge={item.status === "connected" ? "Connected" : "Disconnected"}
            onClick={() => onFocus(item.terminalId)}
          >
            <span className="manager-inline-actions">
              {item.canReconnect && (
                <button
                  type="button"
                  className="manager-text-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReconnect(item.terminalId);
                  }}
                >
                  Reconnect
                </button>
              )}
              <button
                type="button"
                className="manager-text-action manager-text-action--danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(item.terminalId);
                }}
              >
                Close
              </button>
            </span>
          </ManagerRow>
        ))
      )}
    </ManagerPanelFrame>
  );
}

function formatLocation(item: TerminalStatusItemViewData): string {
  if (!item.location) {
    return `${item.transport.toUpperCase()} · unattached`;
  }
  return `${item.location.workspaceName} / ${item.location.windowName} / Pane ${item.location.paneNumber}`;
}
