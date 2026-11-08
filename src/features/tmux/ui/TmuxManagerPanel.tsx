import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
} from "../../../shared/ui/ManagerPanel";
import { type TmuxManagerItemViewData } from "../viewModels/managerViewModel";

interface TmuxManagerPanelProps {
  items: readonly TmuxManagerItemViewData[];
  onNewTmux: () => void;
  onOpenConfig: (configId: string) => void;
  onEditConfig: (configId: string) => void;
  onRemoveConfig: (configId: string) => void;
}

export function TmuxManagerPanel({
  items,
  onNewTmux,
  onOpenConfig,
  onEditConfig,
  onRemoveConfig,
}: TmuxManagerPanelProps) {
  return (
    <ManagerPanelFrame
      footer={
        <ManagerActionButton label="New Tmux Session" variant="primary" onClick={onNewTmux} />
      }
    >
      {items.length === 0 ? (
        <ManagerEmptyState>No saved Tmux configurations.</ManagerEmptyState>
      ) : (
        items.map((item) => (
          <ManagerRow
            key={item.configId}
            title={item.name}
            subtitle={formatTmuxItem(item)}
            badge={item.transport === "ssh" ? "SSH" : "Local"}
            onClick={() => onOpenConfig(item.configId)}
            onDoubleClick={() => onOpenConfig(item.configId)}
          >
            <span className="manager-inline-actions">
              <button
                type="button"
                className="manager-text-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditConfig(item.configId);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="manager-text-action manager-text-action--danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveConfig(item.configId);
                }}
              >
                Remove
              </button>
            </span>
          </ManagerRow>
        ))
      )}
    </ManagerPanelFrame>
  );
}

function formatTmuxItem(item: TmuxManagerItemViewData): string {
  const parts = [
    item.tmuxSessionName ?? item.name,
    item.socketName ? `socket ${item.socketName}` : null,
    item.baseConfigName ? `base ${item.baseConfigName}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
