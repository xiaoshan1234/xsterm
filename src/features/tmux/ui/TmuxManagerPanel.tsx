import { useState } from "react";
import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
} from "../../../shared/ui/ManagerPanel";
import { type TmuxManagerItemViewData } from "../viewModels/managerViewModel";

interface TmuxManagerPanelProps {
  items: readonly TmuxManagerItemViewData[];
  onCreateTmux: () => void;
  onNewTmux: () => void;
  onOpenConfig: (configId: string) => void;
  onEditConfig: (configId: string) => void;
  onRemoveConfig: (configId: string) => void;
}

export function TmuxManagerPanel({
  items,
  onCreateTmux,
  onNewTmux,
  onOpenConfig,
  onEditConfig,
  onRemoveConfig,
}: TmuxManagerPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <ManagerPanelFrame
      footer={
        <>
          <ManagerActionButton
            label="Create Tmux Session"
            variant="primary"
            onClick={onCreateTmux}
          />
          <ManagerActionButton
            label="Attach Tmux Session"
            variant="secondary"
            onClick={onNewTmux}
          />
        </>
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
            badge={formatTransport(item.transport)}
            isSelected={selectedId === item.configId}
            onSelect={() => setSelectedId(item.configId)}
            onOpen={() => onOpenConfig(item.configId)}
            contextMenuItems={[
              {
                id: "edit",
                label: "Edit",
                onClick: () => onEditConfig(item.configId),
              },
              {
                id: "remove",
                label: "Remove",
                onClick: () => onRemoveConfig(item.configId),
                danger: true,
              },
            ]}
          />
        ))
      )}
    </ManagerPanelFrame>
  );
}

function formatTmuxItem(item: TmuxManagerItemViewData): string {
  const parts = [
    item.tmuxSessionName ?? item.name,
    item.socketName ? `socket ${item.socketName}` : null,
    item.wslDistribution ? `WSL ${item.wslDistribution}` : null,
    item.baseConfigName ? `base ${item.baseConfigName}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function formatTransport(transport: TmuxManagerItemViewData["transport"]): string {
  if (transport === "ssh") return "SSH";
  if (transport === "wsl") return "WSL";
  return "Local";
}
