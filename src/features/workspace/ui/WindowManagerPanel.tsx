import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
} from "../../../shared/ui/ManagerPanel";
import { type WindowManagerItemViewData } from "../viewModels/managerViewModel";

interface WindowManagerPanelProps {
  items: readonly WindowManagerItemViewData[];
  onNewWindow: () => void;
  onLoad: (configId: string) => void;
  onRename: (configId: string) => void;
  onDelete: (configId: string) => void;
}

export function WindowManagerPanel({
  items,
  onNewWindow,
  onLoad,
  onRename,
  onDelete,
}: WindowManagerPanelProps) {
  return (
    <ManagerPanelFrame
      footer={<ManagerActionButton label="New Window" variant="primary" onClick={onNewWindow} />}
    >
      {items.length === 0 ? (
        <ManagerEmptyState>No saved window configurations.</ManagerEmptyState>
      ) : (
        items.map((item) => (
          <ManagerRow
            key={item.configId}
            title={item.name}
            subtitle={`${item.paneCount} panes`}
            onClick={() => onLoad(item.configId)}
            onDoubleClick={() => onLoad(item.configId)}
          >
            <span className="manager-inline-actions">
              <button
                type="button"
                className="manager-text-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRename(item.configId);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="manager-text-action manager-text-action--danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.configId);
                }}
              >
                Delete
              </button>
            </span>
          </ManagerRow>
        ))
      )}
    </ManagerPanelFrame>
  );
}
