import type { ToolId } from "./types";
import type { TerminalManagerGroupViewData } from "../../features/terminal";
import type { TmuxManagerGroupViewData } from "../../features/tmux";
import type {
  WindowManagerItemViewData,
  WorkspaceManagerItemViewData,
} from "../../features/workspace";
import { SettingsPanel } from "../../features/settings";
import { TerminalManagerPanel } from "../../features/terminal";
import { TmuxManagerPanel } from "../../features/tmux";
import { WindowManagerPanel, WorkspaceManagerPanel } from "../../features/workspace";

interface RuntimeToolPanelProps {
  activeTool: ToolId | null;
  terminalManagerGroups: readonly TerminalManagerGroupViewData[];
  tmuxManagerGroups: readonly TmuxManagerGroupViewData[];
  windowManagerItems: readonly WindowManagerItemViewData[];
  workspaceManagerItems: readonly WorkspaceManagerItemViewData[];
  onCreateTerminal: () => void;
  onCreateTmux: () => void;
  onAttachTmux: () => void;
  onNewGroup: () => void;
  onToggleGroup: (id: number) => void;
  onEditGroup: (id: number) => void;
  onDeleteGroup: (id: number) => void;
  onOpenConfig: (configId: string) => void;
  onEditTerminalConfig: (configId: string) => void;
  onEditTmuxConfig: (configId: string) => void;
  onRemoveConfig: (configId: string) => void;
  onDetachTmuxConfig: (configId: string) => void;
  onCreateWindow: () => void;
  onLoadWindow: (configId: string) => void;
  onRenameWindow: (configId: string) => void;
  onDeleteWindow: (configId: string) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: (configId: string, isLoaded: boolean) => void;
  onRenameWorkspace: (configId: string) => void;
  onDeleteWorkspace: (configId: string) => void;
}

export function RuntimeToolPanel({
  activeTool,
  terminalManagerGroups,
  tmuxManagerGroups,
  windowManagerItems,
  workspaceManagerItems,
  onCreateTerminal,
  onCreateTmux,
  onAttachTmux,
  onNewGroup,
  onToggleGroup,
  onEditGroup,
  onDeleteGroup,
  onOpenConfig,
  onEditTerminalConfig,
  onEditTmuxConfig,
  onRemoveConfig,
  onDetachTmuxConfig,
  onCreateWindow,
  onLoadWindow,
  onRenameWindow,
  onDeleteWindow,
  onCreateWorkspace,
  onOpenWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
}: RuntimeToolPanelProps) {
  switch (activeTool) {
    case "terminal-manager":
      return (
        <TerminalManagerPanel
          groups={terminalManagerGroups}
          onNewTerminal={onCreateTerminal}
          onNewGroup={onNewGroup}
          onToggleGroup={onToggleGroup}
          onEditGroup={onEditGroup}
          onDeleteGroup={onDeleteGroup}
          onOpenConfig={onOpenConfig}
          onEditConfig={onEditTerminalConfig}
          onRemoveConfig={onRemoveConfig}
        />
      );
    case "tmux-manager":
      return (
        <TmuxManagerPanel
          groups={tmuxManagerGroups}
          onCreateTmux={onCreateTmux}
          onNewTmux={onAttachTmux}
          onOpenConfig={onOpenConfig}
          onEditConfig={onEditTmuxConfig}
          onRemoveConfig={onRemoveConfig}
          onDetachConfig={onDetachTmuxConfig}
        />
      );
    case "window-manager":
      return (
        <WindowManagerPanel
          items={windowManagerItems}
          onNewWindow={onCreateWindow}
          onLoad={onLoadWindow}
          onRename={onRenameWindow}
          onDelete={onDeleteWindow}
        />
      );
    case "workspace-manager":
      return (
        <WorkspaceManagerPanel
          items={workspaceManagerItems}
          onNewWorkspace={onCreateWorkspace}
          onOpen={onOpenWorkspace}
          onRename={onRenameWorkspace}
          onDelete={onDeleteWorkspace}
        />
      );
    case "settings":
      return <SettingsPanel />;
    default:
      return null;
  }
}
