import { useState } from "react";
import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
  ManagerSection,
} from "../../../shared/ui/ManagerPanel";
import {
  type TmuxManagerGroupViewData,
  type TmuxManagerItemViewData,
} from "../viewModels/managerViewModel";

interface TmuxManagerPanelProps {
  groups: readonly TmuxManagerGroupViewData[];
  onCreateTmux: () => void;
  onNewTmux: () => void;
  onOpenConfig: (configId: string) => void;
  onEditConfig: (configId: string) => void;
  onRemoveConfig: (configId: string) => void;
  onDetachConfig: (configId: string) => void;
}

export function TmuxManagerPanel({
  groups,
  onCreateTmux,
  onNewTmux,
  onOpenConfig,
  onEditConfig,
  onRemoveConfig,
  onDetachConfig,
}: TmuxManagerPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
      {groups.length === 0 ? (
        <ManagerEmptyState>No saved Tmux configurations.</ManagerEmptyState>
      ) : (
        <div className="manager-group-list">
          {groups.map((group) => (
            <ManagerSection
              key={group.key}
              label={group.name}
              isExpanded={!collapsedGroups.has(group.key)}
              onToggle={() => toggleGroup(group.key)}
            >
              {group.items.map((item) => (
                <ManagerRow
                  key={item.configId}
                  title={item.name}
                  status={item.isOpen ? "connected" : undefined}
                  badge={formatTransport(item.transport)}
                  isSelected={selectedId === item.configId}
                  onSelect={() => setSelectedId(item.configId)}
                  onOpen={() => onOpenConfig(item.configId)}
                  contextMenuItems={[
                    {
                      id: "detach",
                      label: "Detach",
                      onClick: () => onDetachConfig(item.configId),
                      disabled: !item.isOpen,
                    },
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
              ))}
            </ManagerSection>
          ))}
        </div>
      )}
    </ManagerPanelFrame>
  );
}

function formatTransport(transport: TmuxManagerItemViewData["transport"]): string {
  if (transport === "ssh") return "SSH";
  if (transport === "wsl") return "WSL";
  return "Local";
}
