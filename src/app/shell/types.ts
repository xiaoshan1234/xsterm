export type ToolId =
  "terminal-manager" | "tmux-manager" | "window-manager" | "workspace-manager" | "settings";

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
  "tmux-manager": "Tmux Manager",
  "window-manager": "Window Manager",
  "workspace-manager": "Workspace Manager",
  settings: "Settings",
};
