import {
  ChatIcon,
  LayoutIcon,
  SessionIcon,
  SettingsIcon,
  TerminalIcon,
  WindowIcon,
  WorkspaceIcon,
} from "../../shared/icons/Icon";
import { type ToolId } from "./types";

interface ToolbarProps {
  activeTool: ToolId | null;
  onSelectTool: (tool: ToolId) => void;
}

const CONFIGURATION_TOOLS = [
  { id: "terminal-manager", label: "Terminal Manager", icon: ChatIcon },
  { id: "tmux-manager", label: "Tmux Manager", icon: SessionIcon },
  { id: "window-manager", label: "Window Manager", icon: WindowIcon },
  { id: "workspace-manager", label: "Workspace Manager", icon: WorkspaceIcon },
] as const;

const STATUS_TOOLS = [
  { id: "terminal-status-manager", label: "Terminal Status", icon: TerminalIcon },
  { id: "tmux-status-manager", label: "Tmux Status", icon: LayoutIcon },
] as const;

export function Toolbar({ activeTool, onSelectTool }: ToolbarProps) {
  return (
    <nav className="shell-toolbar" aria-label="Application tools">
      <div className="shell-toolbar-group">
        {CONFIGURATION_TOOLS.map((tool) => (
          <ToolbarButton
            key={tool.id}
            id={tool.id}
            label={tool.label}
            activeTool={activeTool}
            onSelectTool={onSelectTool}
            icon={<tool.icon size={18} />}
          />
        ))}
      </div>
      <div className="shell-toolbar-divider" aria-hidden="true" />
      <div className="shell-toolbar-group">
        {STATUS_TOOLS.map((tool) => (
          <ToolbarButton
            key={tool.id}
            id={tool.id}
            label={tool.label}
            activeTool={activeTool}
            onSelectTool={onSelectTool}
            icon={<tool.icon size={18} />}
          />
        ))}
      </div>
      <div className="shell-toolbar-spacer" />
      <div className="shell-toolbar-group">
        <ToolbarButton
          id="settings"
          label="Settings"
          activeTool={activeTool}
          onSelectTool={onSelectTool}
          icon={<SettingsIcon size={18} />}
        />
      </div>
    </nav>
  );
}

interface ToolbarButtonProps {
  id: ToolId;
  label: string;
  icon: React.ReactNode;
  activeTool: ToolId | null;
  onSelectTool: (tool: ToolId) => void;
}

function ToolbarButton({ id, label, icon, activeTool, onSelectTool }: ToolbarButtonProps) {
  const isActive = activeTool === id;

  return (
    <button
      type="button"
      className={`shell-toolbar-button${isActive ? " shell-toolbar-button--active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      onClick={() => onSelectTool(id)}
    >
      {icon}
    </button>
  );
}
