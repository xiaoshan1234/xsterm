import { useState } from "react";
import { useSession } from "../../contexts/SessionContext";
import { SavedSessionConfig } from "../../types/session";
import { LocalSessionIcon, SshSessionIcon, FolderIcon, ChevronIcon, CloseIcon, PlusIcon } from "../icons/Icon";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

interface SessionManagerProps {
  width: number;
  onCreateSession: () => void;
}

export function SessionManager({ width, onCreateSession }: SessionManagerProps) {
  const {
    sessions,
    savedConfigs,
    groups,
    openFromConfig,
    removeConfig,
    createGroup,
    toggleGroup,
    closeSession,
  } = useSession();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState("");

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

  const handleConfigClick = (config: SavedSessionConfig) => {
    setSelectedConfigId(config.id);
  };

  const handleConfigDoubleClick = (config: SavedSessionConfig) => {
    openFromConfig(config.id).catch(console.error);
  };

  const handleConfigClose = (config: SavedSessionConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConnected(config)) {
      const session = sessions.find((s) => s.configId === config.id);
      if (session) closeSession(session.id);
    } else {
      removeConfig(config.id);
    }
  };

  const uncategorized = savedConfigs.filter(
    (c) => !groups.some((g) => g.configIds.includes(c.id))
  );

  return (
    <div className="sidebar-submenu" style={{ width }}>
      <div className="submenu-header">Session Manager</div>
      <div className="session-history">
        {groups.map((group) => (
          <div key={group.id} className="session-group">
            <button className="session-group-header" onClick={() => toggleGroup(group.id)}>
              <span
                className="session-group-chevron"
                style={{ transform: !group.collapsed ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                <ChevronIcon size={14} />
              </span>
              <FolderIcon size={14} />
              <span className="session-group-name">{group.name}</span>
              <span className="session-group-count">{group.configIds.length}</span>
            </button>
            {!group.collapsed && (
              <div className="session-group-items">
                {savedConfigs
                  .filter((c) => group.configIds.includes(c.id))
                  .map((config) => (
                    <SessionItem
                      key={config.id}
                      config={config}
                      selected={selectedConfigId === config.id}
                      connected={isConnected(config)}
                      indented
                      onClick={() => handleConfigClick(config)}
                      onDoubleClick={() => handleConfigDoubleClick(config)}
                      onClose={(e) => handleConfigClose(config, e)}
                    />
                  ))}
              </div>
            )}
          </div>
        ))}
        {uncategorized.map((config) => (
          <SessionItem
            key={config.id}
            config={config}
            selected={selectedConfigId === config.id}
            connected={isConnected(config)}
            uncategorized
            onClick={() => handleConfigClick(config)}
            onDoubleClick={() => handleConfigDoubleClick(config)}
            onClose={(e) => handleConfigClose(config, e)}
          />
        ))}
        <div className="session-divider" />
        <button className="submenu-item new-group-btn" onClick={() => setShowNewGroupDialog(true)}>
          <PlusIcon size={14} />
          New Group
        </button>
        <button className="submenu-item new-session-btn" onClick={onCreateSession}>
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
    </div>
  );
}

interface SessionItemProps {
  config: SavedSessionConfig;
  selected: boolean;
  connected: boolean;
  indented?: boolean;
  uncategorized?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

function SessionItem({
  config,
  selected,
  connected,
  indented,
  uncategorized,
  onClick,
  onDoubleClick,
  onClose,
}: SessionItemProps) {
  return (
    <div
      className={`session-item ${selected ? "selected" : ""} ${uncategorized ? "uncategorized" : ""}`}
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
