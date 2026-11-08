import {
  createPaneId,
  createTmuxControllerId,
  createTmuxPaneId,
  createTmuxWindowId,
  createWindowId,
  createWorkspaceId,
  type PaneId,
  type TerminalId,
  type TerminalStreamId,
  type TmuxControllerId,
  type TmuxPaneId,
  type TmuxWindowId,
  type WindowId,
  type WorkspaceId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Stable user-selected pane identity. It survives a Terminal reconnect and can
 * be persisted by features such as the global command panel.
 */
export type PaneTargetRef = RawPaneTargetRef | TmuxPaneTargetRef;

export interface RawPaneTargetRef {
  readonly kind: "raw-pane";
  readonly workspaceId: WorkspaceId;
  readonly windowId: WindowId;
  readonly paneId: PaneId;
}

export interface TmuxPaneTargetRef {
  readonly kind: "tmux-pane";
  readonly controllerId: TmuxControllerId;
  readonly tmuxWindowId: TmuxWindowId;
  readonly tmuxPaneId: TmuxPaneId;
}

export interface CreateRawPaneTargetRefInput {
  workspaceId: string;
  windowId: string;
  paneId: string;
}

export interface CreateTmuxPaneTargetRefInput {
  controllerId: number;
  tmuxWindowId: string;
  tmuxPaneId: string;
}

/** Current backend endpoint used to write input for a selected pane. */
export type TerminalStreamRef =
  | {
      readonly kind: "terminal";
      readonly terminalId: TerminalId;
    }
  | {
      readonly kind: "tmux-pane";
      readonly streamId: TerminalStreamId;
      readonly tmuxPaneId: TmuxPaneId;
    };

export interface ResolvedPaneTarget {
  readonly target: PaneTargetRef;
  readonly stream: TerminalStreamRef;
}

export interface PaneTargetDisplayInfo {
  readonly target: PaneTargetRef;
  readonly displayId: string;
  readonly title: string;
  readonly breadcrumb: string;
  readonly technicalId?: string;
  readonly isAvailable: boolean;
}

export function createRawPaneTargetRef(
  input: CreateRawPaneTargetRefInput,
): ModelResult<RawPaneTargetRef> {
  try {
    return modelSuccess({
      kind: "raw-pane",
      workspaceId: createWorkspaceId(input.workspaceId),
      windowId: createWindowId(input.windowId),
      paneId: createPaneId(input.paneId),
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid raw pane target id",
    );
  }
}

export function createTmuxPaneTargetRef(
  input: CreateTmuxPaneTargetRefInput,
): ModelResult<TmuxPaneTargetRef> {
  try {
    return modelSuccess({
      kind: "tmux-pane",
      controllerId: createTmuxControllerId(input.controllerId),
      tmuxWindowId: createTmuxWindowId(input.tmuxWindowId),
      tmuxPaneId: createTmuxPaneId(input.tmuxPaneId),
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid tmux pane target id",
    );
  }
}

/** Stable key for React lists, drafts, and persisted command jobs. */
export function createPaneTargetKey(target: PaneTargetRef): string {
  return target.kind === "raw-pane"
    ? `raw:${target.workspaceId}:${target.windowId}:${target.paneId}`
    : `tmux:${target.controllerId}:${target.tmuxWindowId}:${target.tmuxPaneId}`;
}

export function createResolvedRawPaneTarget(
  target: RawPaneTargetRef,
  terminalId: TerminalId,
): ResolvedPaneTarget {
  return {
    target,
    stream: { kind: "terminal", terminalId },
  };
}

export function createResolvedTmuxPaneTarget(
  target: TmuxPaneTargetRef,
  streamId: TerminalStreamId,
): ResolvedPaneTarget {
  return {
    target,
    stream: {
      kind: "tmux-pane",
      streamId,
      tmuxPaneId: target.tmuxPaneId,
    },
  };
}

export function createPaneTargetDisplayInfo(input: {
  target: PaneTargetRef;
  displayId: string;
  title: string;
  breadcrumb: string;
  technicalId?: string;
  isAvailable: boolean;
}): ModelResult<PaneTargetDisplayInfo> {
  const displayId = input.displayId.trim();
  const title = input.title.trim();
  const breadcrumb = input.breadcrumb.trim();

  if (!displayId || !title || !breadcrumb) {
    return modelFailure(
      "invalid-value",
      "Pane target display id, title, and breadcrumb must not be empty",
    );
  }

  return modelSuccess({
    target: input.target,
    displayId,
    title,
    breadcrumb,
    ...(input.technicalId ? { technicalId: input.technicalId } : {}),
    isAvailable: input.isAvailable,
  });
}
