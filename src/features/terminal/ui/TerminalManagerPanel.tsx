import { useState } from "react";
import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
  ManagerSection,
} from "../../../shared/ui/ManagerPanel";
import { type TerminalManagerGroupViewData } from "../viewModels/managerViewModel";
import "./TerminalManagerPanel.css";

interface TerminalManagerPanelProps {
  groups: readonly TerminalManagerGroupViewData[];
  onNewTerminal: () => void;
  onNewGroup: () => void;
  onToggleGroup: (groupId: number) => void;
  onEditGroup: (groupId: number) => void;
  onDeleteGroup: (groupId: number) => void;
  onOpenConfig: (configId: string) => void;
  onEditConfig: (configId: string) => void;
  onRemoveConfig: (configId: string) => void;
}

export function TerminalManagerPanel({
  groups,
  onNewTerminal,
  onNewGroup,
  onToggleGroup,
  onEditGroup,
  onDeleteGroup,
  onOpenConfig,
  onEditConfig,
  onRemoveConfig,
}: TerminalManagerPanelProps) {
  const hasConfigs = groups.some((group) => group.items.length > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <ManagerPanelFrame
      footer={
        <>
          <ManagerActionButton label="New Terminal" variant="primary" onClick={onNewTerminal} />
          <ManagerActionButton label="New Group" onClick={onNewGroup} />
        </>
      }
    >
      {!hasConfigs && <ManagerEmptyState>No saved terminal configurations.</ManagerEmptyState>}
      <div className="terminal-manager-groups">
        {groups.map((group) => (
          <ManagerSection
            key={group.groupId}
            label={group.name}
            isExpanded={!group.isCollapsed}
            onToggle={() => onToggleGroup(group.groupId)}
            contextMenuItems={[
              {
                id: "edit-group",
                label: "Edit Group",
                onClick: () => onEditGroup(group.groupId),
              },
              ...(!group.isDefault
                ? [
                    {
                      id: "delete-group",
                      label: "Delete Group",
                      onClick: () => onDeleteGroup(group.groupId),
                      danger: true,
                    },
                  ]
                : []),
            ]}
          >
            {group.items.length === 0 ? (
              <ManagerEmptyState>This group is empty.</ManagerEmptyState>
            ) : (
              group.items.map((item) => (
                <ManagerRow
                  key={item.configId}
                  title={item.name}
                  badge={item.kind === "ssh" ? "SSH" : "Shell"}
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
          </ManagerSection>
        ))}
      </div>
    </ManagerPanelFrame>
  );
}
