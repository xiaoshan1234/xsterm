import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
} from "../../../shared/ui/ManagerPanel";
import { type WorkspaceManagerItemViewData } from "../viewModels/managerViewModel";

interface WorkspaceManagerPanelProps {
  items: readonly WorkspaceManagerItemViewData[];
  onNewWorkspace: () => void;
  onOpen: (configId: string, isLoaded: boolean) => void;
  onRename: (configId: string) => void;
  onDelete: (configId: string) => void;
}

export function WorkspaceManagerPanel({
  items,
  onNewWorkspace,
  onOpen,
  onRename,
  onDelete,
}: WorkspaceManagerPanelProps) {
  return (
    <ManagerPanelFrame
      footer={
        <ManagerActionButton label="New Workspace" variant="primary" onClick={onNewWorkspace} />
      }
    >
      {items.length === 0 ? (
        <ManagerEmptyState>No saved workspaces.</ManagerEmptyState>
      ) : (
        items.map((item) => (
          <ManagerRow
            key={item.configId}
            title={item.name}
            subtitle={`${item.windowCount} windows`}
            badge={item.isLoaded ? "Loaded" : "Saved"}
            onClick={() => onOpen(item.configId, item.isLoaded)}
            onDoubleClick={() => onOpen(item.configId, item.isLoaded)}
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
