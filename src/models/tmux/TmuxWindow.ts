import { type TmuxPaneId, type TmuxWindowId, createTmuxWindowId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { type TmuxPane } from "./TmuxPane";
import {
  collectTmuxPaneIds,
  findTmuxPaneLeaf,
  type TmuxPaneLeaf,
  type TmuxPaneNode,
} from "./TmuxPaneLayout";

export interface TmuxWindow {
  readonly kind: "tmux-window";
  readonly id: TmuxWindowId;
  readonly name: string;
  readonly activePaneId: TmuxPaneId;
  readonly panes: readonly TmuxPane[];
  readonly layout: TmuxPaneNode;
}

export interface CreateTmuxWindowInput {
  id: string;
  name: string;
  activePaneId: TmuxPaneId;
  panes: readonly TmuxPane[];
  layout: TmuxPaneNode;
}

export function createTmuxWindow(input: CreateTmuxWindowInput): ModelResult<TmuxWindow> {
  const name = input.name.trim();
  if (!name) {
    return modelFailure("invalid-value", "tmux window name must not be empty");
  }

  const paneIds = input.panes.map((pane) => pane.id);
  if (new Set(paneIds).size !== paneIds.length) {
    return modelFailure("duplicate-id", "tmux window contains duplicate panes");
  }

  const layoutPaneIds = collectTmuxPaneIds(input.layout);
  if (new Set(layoutPaneIds).size !== layoutPaneIds.length) {
    return modelFailure("invalid-layout", "tmux layout contains duplicate panes");
  }
  if (
    paneIds.length !== layoutPaneIds.length ||
    paneIds.some((paneId) => !layoutPaneIds.includes(paneId))
  ) {
    return modelFailure(
      "invalid-layout",
      "tmux window panes and layout must contain the same pane ids",
    );
  }
  if (!paneIds.includes(input.activePaneId)) {
    return modelFailure("invalid-layout", "active tmux pane must exist in the window");
  }

  try {
    return modelSuccess({
      kind: "tmux-window",
      id: createTmuxWindowId(input.id),
      name,
      activePaneId: input.activePaneId,
      panes: [...input.panes],
      layout: input.layout,
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid tmux window id",
    );
  }
}

export function findTmuxPane(window: TmuxWindow, paneId: TmuxPaneId): TmuxPane | null {
  return window.panes.find((pane) => pane.id === paneId) ?? null;
}

export function findTmuxPaneFromLayout(
  window: TmuxWindow,
  paneId: TmuxPaneId,
): TmuxPaneLeaf | null {
  return findTmuxPaneLeaf(window.layout, paneId);
}

export function setActiveTmuxPane(window: TmuxWindow, paneId: TmuxPaneId): ModelResult<TmuxWindow> {
  if (!findTmuxPane(window, paneId)) {
    return modelFailure("not-found", "tmux pane does not exist in this window");
  }

  return modelSuccess({
    ...window,
    activePaneId: paneId,
  });
}
