import { useState, useMemo } from "react";
import { useSession } from "../terminals/TerminalContext";
import { DEFAULT_GROUP_ID } from "../terminals/state/constants";
import { type SavedTerminalConfig, type TerminalGroup } from "../../types/terminal";
import {
  ShellIcon,
  SshIcon,
  FolderIcon,
  ChevronIcon,
  CloseIcon,
  PlusIcon,
} from "../../shared/icons/Icon";
import { ContextMenu } from "../../shared/ui/ContextMenu";
import { EditGroupDialog } from "../terminals/dialogs/EditGroupDialog";
import { EditTerminalDialog } from "../terminals/dialogs/EditTerminalDialog";
import { NewGroupDialog } from "../terminals/dialogs/NewGroupDialog";
import { useTerminalDragDrop } from "./useTerminalDragDrop";

interface TerminalManagerProps {
  onCreateSession: () => void;
  onCreateSessionWithGroup: (groupId: number) => void;
}

/**
 * TerminalManager - manages the list and grouping of terminal configurations, supports click to select, double-click to open, right-click menu operations.
 * Click: marks selection state (highlighted background).
 * Double-click: opens the corresponding terminal and establishes a connection.
 * Sessions can be grouped by TerminalGroup, with drag-and-drop grouping support.
 */
export function TerminalManager({
  onCreateSession,
  onCreateSessionWithGroup,
}: TerminalManagerProps) {
  const {
    terminals,
    savedConfigs,
    groups,
    createWindowFromSavedConfig,
    removeConfig,
    createGroup,
    toggleGroup,
    closeTerminal,
    renameGroup,
    deleteGroup,
    updateConfig,
    moveConfigToGroup,
    applyDisplayConfigToLiveSession,
  } = useSession();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TerminalGroup | null>(null);
  const [editingSession, setEditingSession] = useState<SavedTerminalConfig | null>(null);
  const [editingTerminalGroupId, setEditingTerminalGroupId] = useState<number | null>(null);

  const ungroupedConfigs = useMemo(() => {
    const grouped = new Set<string>();
    groups.forEach((g) => {
      if (g.id !== DEFAULT_GROUP_ID) {
        g.configIds.forEach((id) => grouped.add(id));
      }
    });
    return savedConfigs.filter((c) => !grouped.has(c.id));
  }, [savedConfigs, groups]);

  const isConnected = (config: SavedTerminalConfig) =>
    terminals.some((s) => s.configId === config.id);

  const handleConfigClick = (config: SavedTerminalConfig) => {
    setSelectedConfigId(config.id);
  };

  const handleConfigDoubleClick = (config: SavedTerminalConfig) => {
    createWindowFromSavedConfig(config.id).catch(console.error);
  };

  const removeOrCloseConfig = (config: SavedTerminalConfig) => {
    if (isConnected(config)) {
      const terminal = terminals.find((s) => s.configId === config.id);
      if (terminal) closeTerminal(terminal.id);
    } else {
      removeConfig(config.id);
    }
  };

  const handleConfigClose = (config: SavedTerminalConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    removeOrCloseConfig(config);
  };

  const getConfigGroupId = (configId: string): number | null => {
    const group = groups.find((g) => g.configIds.includes(configId));
    return group ? group.id : null;
  };

  const handleEditSession = (config: SavedTerminalConfig) => {
    setEditingSession(config);
    setEditingTerminalGroupId(getConfigGroupId(config.id));
  };

  const handleSessionSave = (config: SavedTerminalConfig, groupId: number | null) => {
    updateConfig(config);
    moveConfigToGroup(config.id, groupId);
    // If this config corresponds to a currently-running terminal, push the
    // new displayConfig into its in-memory state so Terminal →
    // useTerminalResize applies the change live (no terminal restart).
    const liveSession = terminals.find((s) => s.configId === config.id);
    if (liveSession && config.displayConfig) {
      applyDisplayConfigToLiveSession(liveSession.id, config.displayConfig);
    }
  };

  const {
    dragOverGroupId,
    handleDragStart,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
  } = useTerminalDragDrop({
    onDrop: (configId, groupId) => moveConfigToGroup(configId, groupId),
  });

  return (
    <div className="terminal-manager">
      <div className="submenu-header">Terminal Manager</div>
      <div className="terminal-history">
        {groups.map((group) => {
          const isDefault = group.id === DEFAULT_GROUP_ID;
          const items = isDefault
            ? ungroupedConfigs
            : savedConfigs.filter((c) => group.configIds.includes(c.id));
          const contextMenuItems = isDefault
            ? [
                { label: "Create Terminal", onClick: () => onCreateSessionWithGroup(group.id) },
                { label: "Edit", onClick: () => setEditingGroup(group) },
              ]
            : [
                { label: "Create Terminal", onClick: () => onCreateSessionWithGroup(group.id) },
                { label: "Edit", onClick: () => setEditingGroup(group) },
                { label: "Delete", onClick: () => deleteGroup(group.id), danger: true },
              ];
          return (
            <div
              key={group.id}
              className={`terminal-group ${dragOverGroupId === group.id ? "drag-over" : ""}`}
              onDragOver={(e) => handleGroupDragOver(e, group.id)}
              onDragLeave={handleGroupDragLeave}
              onDrop={(e) => handleGroupDrop(e, group.id)}
            >
              <ContextMenu items={contextMenuItems} onOpen={() => setSelectedConfigId(null)}>
                <button className="terminal-group-header" onClick={() => toggleGroup(group.id)}>
                  <span
                    className="terminal-group-chevron"
                    style={{ transform: !group.collapsed ? "rotate(90deg)" : "rotate(0deg)" }}
                  >
                    <ChevronIcon size={14} />
                  </span>
                  <FolderIcon size={14} />
                  <span className="terminal-group-name">{group.name}</span>
                </button>
              </ContextMenu>
              {!group.collapsed && (
                <div className="terminal-group-items">
                  {items.map((config) => (
                    <ContextMenu
                      key={config.id}
                      items={[
                        { label: "Edit", onClick: () => handleEditSession(config) },
                        {
                          label: "Remove",
                          onClick: () => removeOrCloseConfig(config),
                          danger: true,
                        },
                      ]}
                      onOpen={() => handleConfigClick(config)}
                    >
                      <div draggable onDragStart={(e) => handleDragStart(e, config.id)}>
                        <SessionItem
                          config={config}
                          selected={selectedConfigId === config.id}
                          connected={isConnected(config)}
                          indented
                          onClick={() => handleConfigClick(config)}
                          onDoubleClick={() => handleConfigDoubleClick(config)}
                          onClose={(e) => handleConfigClose(config, e)}
                        />
                      </div>
                    </ContextMenu>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="terminal-actions">
        <button className="submenu-item" onClick={() => setShowNewGroupDialog(true)}>
          <PlusIcon size={14} />
          New Group
        </button>
        <button className="submenu-item" onClick={onCreateSession}>
          <PlusIcon size={14} />
          New Terminal
        </button>
      </div>

      <NewGroupDialog
        isOpen={showNewGroupDialog}
        onClose={() => setShowNewGroupDialog(false)}
        existingGroupNames={groups.map((g) => g.name)}
        onCreate={(name) => {
          createGroup(name);
          setShowNewGroupDialog(false);
        }}
      />

      {editingGroup && (
        <EditGroupDialog
          isOpen={true}
          onClose={() => setEditingGroup(null)}
          group={editingGroup}
          groups={groups}
          onSave={(id, name) => renameGroup(id, name)}
        />
      )}

      {editingSession && (
        <EditTerminalDialog
          isOpen={true}
          onClose={() => setEditingSession(null)}
          config={editingSession}
          groups={groups}
          groupId={editingTerminalGroupId}
          onSave={handleSessionSave}
        />
      )}
    </div>
  );
}

interface SessionItemProps {
  config: SavedTerminalConfig;
  selected: boolean;
  connected: boolean;
  indented?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

function SessionItem({
  config,
  selected,
  connected,
  indented,
  onClick,
  onDoubleClick,
  onClose,
}: SessionItemProps) {
  return (
    <div
      className={`terminal-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {indented && <span className="terminal-item-indent" />}
      {config.type === "local" ? <ShellIcon size={14} /> : <SshIcon size={14} />}
      <span className={`terminal-item-name ${!connected ? "disconnected" : ""}`}>
        {config.name}
      </span>
      <button className="terminal-item-close" onClick={onClose}>
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
