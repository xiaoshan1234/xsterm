import {
  ManagerActionButton,
  ManagerEmptyState,
  ManagerPanelFrame,
  ManagerRow,
  ManagerSection,
} from "../../../shared/ui/ManagerPanel";
import { type TerminalManagerGroupViewData } from "../viewModels/managerViewModel";

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
      {groups.map((group) => (
        <ManagerSection
          key={group.groupId}
          label={group.name}
          isExpanded={!group.isCollapsed}
          onToggle={() => onToggleGroup(group.groupId)}
          actions={
            <>
              <button
                type="button"
                className="manager-text-action"
                onClick={() => onEditGroup(group.groupId)}
              >
                Edit
              </button>
              {!group.isDefault && (
                <button
                  type="button"
                  className="manager-text-action manager-text-action--danger"
                  onClick={() => onDeleteGroup(group.groupId)}
                >
                  Delete
                </button>
              )}
            </>
          }
        >
          {group.items.length === 0 ? (
            <ManagerEmptyState>This group is empty.</ManagerEmptyState>
          ) : (
            group.items.map((item) => (
              <ManagerRow
                key={item.configId}
                title={item.name}
                subtitle={item.detail}
                badge={item.kind === "ssh" ? "SSH" : "Shell"}
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
        </ManagerSection>
      ))}
    </ManagerPanelFrame>
  );
}
