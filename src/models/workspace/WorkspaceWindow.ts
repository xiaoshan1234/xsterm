import {
  createTmuxControllerId,
  createTmuxWindowId,
  createWindowId,
  type TmuxControllerId,
  type TmuxWindowId,
  type WindowId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { findDirectPane, type DirectPaneNode } from "./DirectPaneTree";

export interface DirectWindow {
  readonly kind: "direct-window";
  readonly id: WindowId;
  readonly name: string;
  readonly activePaneId: DirectPaneNode["id"];
  readonly layout: DirectPaneNode;
}

export interface TmuxWindowReference {
  readonly kind: "tmux-window-reference";
  readonly id: WindowId;
  readonly controllerId: TmuxControllerId;
  readonly tmuxWindowId: TmuxWindowId;
}

export type WorkspaceWindow = DirectWindow | TmuxWindowReference;

export interface CreateDirectWindowInput {
  id: string;
  name: string;
  activePaneId: DirectPaneNode["id"];
  layout: DirectPaneNode;
}

export function createDirectWindow(input: CreateDirectWindowInput): ModelResult<DirectWindow> {
  const name = input.name.trim();
  if (!name) {
    return modelFailure("invalid-value", "Window name must not be empty");
  }
  if (!findDirectPane(input.layout, input.activePaneId)) {
    return modelFailure("invalid-layout", "Active pane must exist in the direct window");
  }

  try {
    return modelSuccess({
      kind: "direct-window",
      id: createWindowId(input.id),
      name,
      activePaneId: input.activePaneId,
      layout: input.layout,
    });
  } catch (error) {
    return modelFailure("invalid-id", error instanceof Error ? error.message : "Invalid window id");
  }
}

export interface CreateTmuxWindowReferenceInput {
  id: string;
  controllerId: number;
  tmuxWindowId: string;
}

export function createTmuxWindowReference(
  input: CreateTmuxWindowReferenceInput,
): ModelResult<TmuxWindowReference> {
  try {
    return modelSuccess({
      kind: "tmux-window-reference",
      id: createWindowId(input.id),
      controllerId: createTmuxControllerId(input.controllerId),
      tmuxWindowId: createTmuxWindowId(input.tmuxWindowId),
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid tmux window reference id",
    );
  }
}

export function renameDirectWindow(window: DirectWindow, name: string): ModelResult<DirectWindow> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return modelFailure("invalid-value", "Window name must not be empty");
  }

  return modelSuccess({
    ...window,
    name: normalizedName,
  });
}
