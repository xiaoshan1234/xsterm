import {
  createTmuxControllerId,
  createTmuxWindowId,
  createWindowId,
  type TmuxControllerId,
  type TmuxWindowId,
  type WindowId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { findRawPane, type RawPaneNode } from "./RawPaneTree";

/**
 * A raw window owns an editable frontend pane tree and may contain mixed
 * local/SSH terminal references.
 */
export interface RawWindow {
  readonly kind: "raw-window";
  readonly id: WindowId;
  readonly name: string;
  readonly activePaneId: RawPaneNode["id"];
  readonly layout: RawPaneNode;
}

/**
 * A reference to a window owned by a `TmuxController`. It deliberately has no
 * editable direct pane tree, which makes tmux/direct pane mixing impossible.
 */
export interface TmuxWindowReference {
  readonly kind: "tmux-window-reference";
  readonly id: WindowId;
  readonly controllerId: TmuxControllerId;
  readonly tmuxWindowId: TmuxWindowId;
}

export type WorkspaceWindow = RawWindow | TmuxWindowReference;

export interface CreateRawWindowInput {
  id: string;
  name: string;
  activePaneId: RawPaneNode["id"];
  layout: RawPaneNode;
}

export function createRawWindow(input: CreateRawWindowInput): ModelResult<RawWindow> {
  const name = input.name.trim();
  if (!name) {
    return modelFailure("invalid-value", "Window name must not be empty");
  }
  if (!findRawPane(input.layout, input.activePaneId)) {
    return modelFailure("invalid-layout", "Active pane must exist in the raw window");
  }

  try {
    return modelSuccess({
      kind: "raw-window",
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

export function renameRawWindow(window: RawWindow, name: string): ModelResult<RawWindow> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return modelFailure("invalid-value", "Window name must not be empty");
  }

  return modelSuccess({
    ...window,
    name: normalizedName,
  });
}
