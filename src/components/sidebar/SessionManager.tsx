import { useState } from "react";
import { useSession } from "../../contexts/SessionContext";
import { type SavedSessionConfig, type SessionGroup } from "../../types/session";
import {
  LocalSessionIcon,
  SshSessionIcon,
  FolderIcon,
  ChevronIcon,
  CloseIcon,
  PlusIcon,
} from "../icons/Icon";
import { ContextMenu } from "../ui/ContextMenu";
import { EditGroupDialog } from "../dialogs/EditGroupDialog";
import { EditSessionDialog } from "../dialogs/EditSessionDialog";
import { NewGroupDialog } from "../dialogs/NewGroupDialog";
import { useSessionDragDrop } from "../useSessionDragDrop";

interface SessionManagerProps {
  onCreateSession: () => void;
  onCreateSessionWithGroup: (groupId: number) => void;
}

/**
 * SessionManager - manages the list and grouping of session configurations, supports click to select, double-click to open, right-click menu operations.
 * Click: marks selection state (highlighted background).
 * Double-click: opens the corresponding session and establishes a connection.
 * Sessions can be grouped by SessionGroup, with drag-and-drop grouping support.
 */
export function SessionManager({ onCreateSession, onCreateSessionWithGroup }: SessionManagerProps) {
  const {
    sessions,
    savedConfigs,
    groups,
    createWindowFromSavedConfig,
    removeConfig,
    createGroup,
    toggleGroup,
    closeSession,
    renameGroup,
    deleteGroup,
    updateConfig,
    moveConfigToGroup,
  } = useSession();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SessionGroup | null>(null);
  const [editingSession, setEditingSession] = useState<SavedSessionConfig | null>(null);
  const [editingSessionGroupId, setEditingSessionGroupId] = useState<number | null>(null);

  const isConnected = (config: SavedSessionConfig) =>
    sessions.some((s) => s.configId === config.id);

  const handleConfigClick = (config: SavedSessionConfig) => {
    setSelectedConfigId(config.id);
  };

  const handleConfigDoubleClick = (config: SavedSessionConfig) => {
    createWindowFromSavedConfig(config.id).catch(console.error);
  };

  const removeOrCloseConfig = (config: SavedSessionConfig) => {
    if (isConnected(config)) {
      const session = sessions.find((s) => s.configId === config.id);
      if (session) closeSession(session.id);
    } else {
      removeConfig(config.id);
    }
  };

  const handleConfigClose = (config: SavedSessionConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    removeOrCloseConfig(config);
  };

  const getConfigGroupId = (configId: string): number | null => {
    const group = groups.find((g) => g.configIds.includes(configId));
    return group ? group.id : null;
  };

  const handleEditSession = (config: SavedSessionConfig) => {
    setEditingSession(config);
    setEditingSessionGroupId(getConfigGroupId(config.id));
  };

  const handleSessionSave = (config: SavedSessionConfig, groupId: number | null) => {
    updateConfig(config);
    moveConfigToGroup(config.id, groupId);
  };

  const {
    dragOverGroupId,
    handleDragStart,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
  } = useSessionDragDrop({
    onDrop: (configId, groupId) => moveConfigToGroup(configId, groupId),
  });

  return (
    <div className="session-manager">
      <div className="submenu-header">Session Manager</div>
      <div className="session-history">
        {groups.map((group) => (
          <div
            key={group.id}
            className={`session-group ${dragOverGroupId === group.id ? "drag-over" : ""}`}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDragLeave={handleGroupDragLeave}
            onDrop={(e) => handleGroupDrop(e, group.id)}
          >
            <ContextMenu
              items={[
                { label: "Create Session", onClick: () => onCreateSessionWithGroup(group.id) },
                { label: "Edit", onClick: () => setEditingGroup(group) },
                { label: "Delete", onClick: () => deleteGroup(group.id), danger: true },
              ]}
              onOpen={() => setSelectedConfigId(null)}
            >
              <button className="session-group-header" onClick={() => toggleGroup(group.id)}>
                <span
                  className="session-group-chevron"
                  style={{ transform: !group.collapsed ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  <ChevronIcon size={14} />
                </span>
                <FolderIcon size={14} />
                <span className="session-group-name">{group.name}</span>
              </button>
            </ContextMenu>
            {!group.collapsed && (
              <div className="session-group-items">
                {savedConfigs
                  .filter((c) => group.configIds.includes(c.id))
                  .map((config) => (
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
        ))}
      </div>

      <div className="session-actions">
        <button className="submenu-item" onClick={() => setShowNewGroupDialog(true)}>
          <PlusIcon size={14} />
          New Group
        </button>
        <button className="submenu-item" onClick={onCreateSession}>
          <PlusIcon size={14} />
          New Session
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
        <EditSessionDialog
          isOpen={true}
          onClose={() => setEditingSession(null)}
          config={editingSession}
          groups={groups}
          groupId={editingSessionGroupId}
          onSave={handleSessionSave}
        />
      )}
    </div>
  );
}

interface SessionItemProps {
  config: SavedSessionConfig;
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
      className={`session-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {indented && <span className="session-item-indent" />}
      {config.type === "local" ? <LocalSessionIcon size={14} /> : <SshSessionIcon size={14} />}
      <span className={`session-item-name ${!connected ? "disconnected" : ""}`}>{config.name}</span>
      <button className="session-item-close" onClick={onClose}>
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
