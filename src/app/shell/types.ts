export type ToolId =
  | "terminal-manager"
  | "terminal-status-manager"
  | "tmux-manager"
  | "tmux-status-manager"
  | "window-manager"
  | "workspace-manager"
  | "settings";

export type PreviewDialogId =
  | "create-terminal"
  | "create-tmux"
  | "edit-terminal"
  | "edit-tmux"
  | "rename"
  | "confirm"
  | "error";

export const TOOL_TITLES: Readonly<Record<ToolId, string>> = {
  "terminal-manager": "Terminal Manager",
  "terminal-status-manager": "Terminal Status",
  "tmux-manager": "tmux Manager",
  "tmux-status-manager": "tmux Status",
  "window-manager": "Window Manager",
  "workspace-manager": "Workspace Manager",
  settings: "Settings",
};
