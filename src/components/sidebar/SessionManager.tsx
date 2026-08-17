import { useState } from "react";
import { useSession } from "../../contexts/SessionContext";
import { SavedSessionConfig, SessionGroup } from "../../types/session";
import { LocalSessionIcon, SshSessionIcon, FolderIcon, ChevronIcon, CloseIcon, PlusIcon } from "../icons/Icon";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { ContextMenu } from "../ui/ContextMenu";
import { EditGroupDialog } from "../dialogs/EditGroupDialog";
import { EditSessionDialog } from "../dialogs/EditSessionDialog";

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

  // selectedConfigId: the session config ID currently selected by single-click, used for highlight display
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState("");

  const [editingGroup, setEditingGroup] = useState<SessionGroup | null>(null);
  const [editingSession, setEditingSession] = useState<SavedSessionConfig | null>(null);
  const [editingSessionGroupId, setEditingSessionGroupId] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  // isConnected - checks whether a config already has an active session connection
  const isConnected = (config: SavedSessionConfig) =>
    sessions.some((s) => s.configId === config.id);

  const handleCreateGroup = () => {
    setGroupError("");
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setGroupError("Group name is required");
      return;
    }
    if (groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
      setGroupError("A group with this name already exists");
      return;
    }
    createGroup(trimmed);
    setNewGroupName("");
    setShowNewGroupDialog(false);
  };

  // handleConfigClick - sets selection state on single-click (highlighted background), does not affect connected state
  const handleConfigClick = (config: SavedSessionConfig) => {
    setSelectedConfigId(config.id);
  };

  // handleConfigDoubleClick - opens the corresponding session (local/SSH) and establishes a connection on double-click
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

  const handleDragStart = (e: React.DragEvent, configId: string) => {
    e.dataTransfer.setData("text/x-session-config-id", configId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleGroupDragOver = (e: React.DragEvent, groupId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupId(groupId);
  };

  const handleGroupDragLeave = () => {
    setDragOverGroupId(null);
  };

  const handleGroupDrop = (e: React.DragEvent, groupId: number) => {
    e.preventDefault();
    const configId = e.dataTransfer.getData("text/x-session-config-id");
    if (configId) {
      moveConfigToGroup(configId, groupId);
    }
    setDragOverGroupId(null);
  };

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
            {/* Right-click group header menu: Create Session (new in group), Edit (rename), Delete (delete group) */}
            <ContextMenu
              items={[
                { label: "Create Session", onClick: () => onCreateSessionWithGroup(group.id) },
                { label: "Edit", onClick: () => setEditingGroup(group) },
                { label: "Delete", onClick: () => deleteGroup(group.id), danger: true },
              ]}
              onOpen={() => setSelectedConfigId(null)}
            >
              <button
                className="session-group-header"
                onClick={() => toggleGroup(group.id)}
              >
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
                    { label: "Remove", onClick: () => removeOrCloseConfig(config), danger: true },
                  ]}
                  onOpen={() => handleConfigClick(config)}
                >
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, config.id)}
                  >
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

      <Dialog
        isOpen={showNewGroupDialog}
        onClose={() => { setShowNewGroupDialog(false); setGroupError(""); }}
        title="Create Group"
        size="small"
        footer={
          <div className="dialog-footer-buttons">
            <button className="btn btn--secondary" onClick={() => setShowNewGroupDialog(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={handleCreateGroup}>Create</button>
          </div>
        }
      >
        {groupError && <div className="dialog-error">{groupError}</div>}
        <FormField label="Group Name">
          <input
            type="text"
            placeholder="e.g., Work, Personal"
            value={newGroupName}
            onChange={(e) => { setNewGroupName(e.target.value); setGroupError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
            autoFocus
          />
        </FormField>
      </Dialog>

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

// SessionItem - single session entry component, supports selection highlight and connected state distinction
// selected: whether selected (single-click to select), adds "selected" class name for highlight when selected
// connected: whether a connection has been established, name displays in disconnected style when not connected
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
      {config.type === "local" ? (
        <LocalSessionIcon size={14} />
      ) : (
        <SshSessionIcon size={14} />
      )}
      <span className={`session-item-name ${!connected ? "disconnected" : ""}`}>{config.name}</span>
      <button className="session-item-close" onClick={onClose}>
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
