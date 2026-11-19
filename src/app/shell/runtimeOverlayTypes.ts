import { type EditableTerminalConfig, type EditableTmuxConfig } from "../../features/launch-config";
import type { LaunchConfigId } from "../../models";
import { type ErrorDialogData } from "./ErrorDialog";

export type RuntimeDialog =
  | { kind: "create-terminal"; initialTab: "local" | "ssh"; groupId: number }
  | { kind: "create-tmux" }
  | { kind: "attach-tmux" }
  | { kind: "edit-terminal"; config: EditableTerminalConfig }
  | { kind: "edit-tmux"; config: EditableTmuxConfig }
  | { kind: "new-group" }
  | { kind: "edit-group"; groupId: number }
  | { kind: "rename-window"; configId: LaunchConfigId; defaultName: string }
  | { kind: "rename-workspace"; configId: LaunchConfigId; defaultName: string }
  | null;

export interface RuntimeConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
}

export interface RuntimeErrorState extends ErrorDialogData {}
