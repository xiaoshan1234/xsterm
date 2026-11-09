import { useState } from "react";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
            isSelected={selectedId === item.configId}
            onSelect={() => setSelectedId(item.configId)}
            onOpen={() => onLoad(item.configId)}
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
