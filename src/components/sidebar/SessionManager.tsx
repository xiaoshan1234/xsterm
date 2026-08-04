import { useState } from "react";
import {
  Box,
  Button,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
} from "@mui/material";
import { useSession } from "../../contexts/SessionContext";
import { SavedSessionConfig, SessionGroup } from "../../types/session";
import { LocalSessionIcon, SshSessionIcon, FolderIcon, ChevronIcon, CloseIcon, PlusIcon } from "../icons";
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
 * SessionManager -管理会话配置的列表和分组，支持单击选中、双击打开、右键菜单操作。
 * 单击：标记选中状态（高亮背景）。
 * 双击：打开对应会话并建立连接。
 * 会话可按组（SessionGroup）归类，支持拖拽分组。
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

  // selectedConfigId: 当前被单击选中的会话配置 ID，用于高亮显示
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState("");

  const [editingGroup, setEditingGroup] = useState<SessionGroup | null>(null);
  const [editingSession, setEditingSession] = useState<SavedSessionConfig | null>(null);
  const [editingSessionGroupId, setEditingSessionGroupId] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  // isConnected - 检查某配置是否已有活跃会话连接
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

  // handleConfigClick - 单击时设置选中状态（高亮背景），不影响已连接状态
  const handleConfigClick = (config: SavedSessionConfig) => {
    setSelectedConfigId(config.id);
  };

  // handleConfigDoubleClick - 双击时根据配置类型打开对应会话（本地/SSH）并建立连接
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
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <List
        component="div"
        dense
        disablePadding
        sx={{ flex: 1, overflowY: "auto" }}
        subheader={
          <ListSubheader
            component="div"
            sx={{
              bgcolor: "transparent",
              color: "text.secondary",
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.05em",
              lineHeight: "32px",
              textTransform: "uppercase",
            }}
          >
            Session Manager
          </ListSubheader>
        }
      >
        {groups.map((group) => (
          <Box
            key={group.id}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDragLeave={handleGroupDragLeave}
            onDrop={(e) => handleGroupDrop(e, group.id)}
            sx={
              dragOverGroupId === group.id
                ? { bgcolor: "action.hover", outline: "1px dashed", outlineColor: "primary.main", outlineOffset: -1 }
                : undefined
            }
          >
            {/* 右键分组头菜单：Create Session（在组内新建）、Edit（重命名）、Delete（删除分组） */}
            <ContextMenu
              items={[
                { label: "Create Session", onClick: () => onCreateSessionWithGroup(group.id) },
                { label: "Edit", onClick: () => setEditingGroup(group) },
                { label: "Delete", onClick: () => deleteGroup(group.id), danger: true },
              ]}
              onOpen={() => setSelectedConfigId(null)}
            >
              <ListItemButton onClick={() => toggleGroup(group.id)} sx={{ py: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <ChevronIcon
                    fontSize="small"
                    sx={{
                      transform: !group.collapsed ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  />
                </ListItemIcon>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <FolderIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={group.name}
                  primaryTypographyProps={{ noWrap: true, fontSize: "0.875rem" }}
                />
                <Typography variant="caption" color="text.secondary">
                  {group.configIds.length}
                </Typography>
              </ListItemButton>
            </ContextMenu>
            <Collapse in={!group.collapsed} timeout="auto" unmountOnExit>
              <List component="div" dense disablePadding>
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
                      <SessionItem
                        config={config}
                        selected={selectedConfigId === config.id}
                        connected={isConnected(config)}
                        onDragStart={(e) => handleDragStart(e, config.id)}
                        onClick={() => handleConfigClick(config)}
                        onDoubleClick={() => handleConfigDoubleClick(config)}
                        onClose={(e) => handleConfigClose(config, e)}
                      />
                    </ContextMenu>
                  ))}
              </List>
            </Collapse>
          </Box>
        ))}
      </List>

      <Box sx={{ display: "flex", gap: 1, p: 1, borderTop: 1, borderColor: "divider" }}>
        <Button
          size="small"
          variant="text"
          fullWidth
          startIcon={<PlusIcon fontSize="small" />}
          onClick={() => setShowNewGroupDialog(true)}
        >
          New Group
        </Button>
        <Button
          size="small"
          variant="text"
          fullWidth
          startIcon={<PlusIcon fontSize="small" />}
          onClick={onCreateSession}
        >
          New Session
        </Button>
      </Box>

      <Dialog
        isOpen={showNewGroupDialog}
        onClose={() => { setShowNewGroupDialog(false); setGroupError(""); }}
        title="Create Group"
        size="small"
        footer={
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button variant="outlined" size="small" onClick={() => setShowNewGroupDialog(false)}>Cancel</Button>
            <Button variant="contained" size="small" onClick={handleCreateGroup}>Create</Button>
          </Box>
        }
      >
        {groupError && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            {groupError}
          </Typography>
        )}
        <FormField label="Group Name">
          <input
            type="text"
            placeholder="e.g., Work, Personal"
            value={newGroupName}
            onChange={(e) => { setNewGroupName(e.target.value); setGroupError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
            autoFocus
            style={{ width: "100%", padding: "8px", fontSize: "0.875rem" }}
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
    </Box>
  );
}

// SessionItem - 单个会话条目组件，支持选中高亮和已连接状态区分
// selected: 是否选中（单击选中），通过 ListItemButton 的 selected 属性高亮
// connected: 是否已建立连接，未连接时 name 显示为 text.disabled 颜色
interface SessionItemProps {
  config: SavedSessionConfig;
  selected: boolean;
  connected: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

function SessionItem({
  config,
  selected,
  connected,
  onDragStart,
  onClick,
  onDoubleClick,
  onClose,
}: SessionItemProps) {
  return (
    <ListItemButton
      draggable
      onDragStart={onDragStart}
      selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      sx={{ pl: 4, py: 0.5, pr: 1 }}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        {config.type === "local" ? (
          <LocalSessionIcon fontSize="small" />
        ) : (
          <SshSessionIcon fontSize="small" />
        )}
      </ListItemIcon>
      <ListItemText
        primary={config.name}
        primaryTypographyProps={{
          noWrap: true,
          fontSize: "0.875rem",
          color: connected ? "text.primary" : "text.disabled",
        }}
      />
      <IconButton
        size="small"
        edge="end"
        aria-label="close session"
        onClick={onClose}
        sx={{ ml: 0.5 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </ListItemButton>
  );
}
