import { useState } from "react";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
            badge={item.isLoaded ? "Loaded" : "Saved"}
            isSelected={selectedId === item.configId}
            onSelect={() => setSelectedId(item.configId)}
            onOpen={() => onOpen(item.configId, item.isLoaded)}
            contextMenuItems={[
              {
                id: "rename",
                label: "Rename",
                onClick: () => onRename(item.configId),
              },
              {
                id: "delete",
                label: "Delete",
                onClick: () => onDelete(item.configId),
                danger: true,
              },
            ]}
          />
        ))
      )}
    </ManagerPanelFrame>
  );
}
