import {
  createLaunchConfigId,
  createTmuxControllerId,
  type LaunchConfigId,
  type TmuxControllerId,
  type TmuxPaneId,
  type TmuxWindowId,
} from "../ids";
import { type TmuxLaunchTransport } from "../launch/TmuxLaunchConfig";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { type TmuxWindow } from "./TmuxWindow";

export type TmuxControllerStatus =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly connectedAt: number;
    }
  | {
      readonly kind: "exited";
      readonly exitedAt: number;
      readonly reason?: string;
    }
  | {
      readonly kind: "failed";
      readonly failedAt: number;
      readonly error: string;
    };

/**
 * Aggregate root for one tmux control connection. A controller owns all of its
 * windows and panes, and may be projected into a Workspace through one or more
 * `TmuxWindowReference` values.
 */
export interface TmuxController {
  readonly kind: "tmux-controller";
  readonly id: TmuxControllerId;
  readonly configId: LaunchConfigId;
  readonly launch: TmuxLaunchTransport;
  readonly status: TmuxControllerStatus;
  readonly windows: readonly TmuxWindow[];
  readonly createdAt: number;
}

export interface CreateTmuxControllerInput {
  id: number;
  configId: string;
  launch: TmuxLaunchTransport;
  createdAt?: number;
}

export function createTmuxController(
  input: CreateTmuxControllerInput,
): ModelResult<TmuxController> {
  const createdAt = input.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt)) {
    return modelFailure("invalid-value", "tmux controller createdAt must be a finite timestamp");
  }

  try {
    return modelSuccess({
      kind: "tmux-controller",
      id: createTmuxControllerId(input.id),
      configId: createLaunchConfigId(input.configId),
      launch: input.launch,
      status: { kind: "connecting" },
      windows: [],
      createdAt,
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid tmux controller id",
    );
  }
}

export function connectTmuxController(
  controller: TmuxController,
  windows: readonly TmuxWindow[],
  connectedAt: number,
): ModelResult<TmuxController> {
  // Windows and panes are unique across the controller, not just within one
  // window. This keeps pane lookup and tmux events unambiguous.
  const validationResult = validateTmuxWindows(windows);
  if (!validationResult.ok) {
    return validationResult;
  }

  return modelSuccess({
    ...controller,
    status: { kind: "connected", connectedAt },
    windows: [...windows],
  });
}

export function markTmuxControllerExited(
  controller: TmuxController,
  exitedAt: number,
  reason?: string,
): TmuxController {
  return {
    ...controller,
    status: {
      kind: "exited",
      exitedAt,
      ...(reason ? { reason } : {}),
    },
  };
}

export function markTmuxControllerFailed(
  controller: TmuxController,
  failedAt: number,
  error: string,
): TmuxController {
  return {
    ...controller,
    status: {
      kind: "failed",
      failedAt,
      error,
    },
  };
}

export function addTmuxWindow(
  controller: TmuxController,
  window: TmuxWindow,
): ModelResult<TmuxController> {
  if (controller.windows.some((candidate) => candidate.id === window.id)) {
    return modelFailure("duplicate-id", "tmux window already exists in this controller");
  }

  const result = validateTmuxWindows([...controller.windows, window]);
  if (!result.ok) {
    return result;
  }

  return modelSuccess({
    ...controller,
    windows: [...controller.windows, window],
  });
}

export function removeTmuxWindow(
  controller: TmuxController,
  windowId: TmuxWindowId,
): ModelResult<TmuxController> {
  if (!controller.windows.some((window) => window.id === windowId)) {
    return modelFailure("not-found", "tmux window does not exist in this controller");
  }

  return modelSuccess({
    ...controller,
    windows: controller.windows.filter((window) => window.id !== windowId),
  });
}

export function findTmuxWindow(
  controller: TmuxController,
  windowId: TmuxWindowId,
): TmuxWindow | null {
  return controller.windows.find((window) => window.id === windowId) ?? null;
}

export function findTmuxPaneInController(
  controller: TmuxController,
  paneId: TmuxPaneId,
): { window: TmuxWindow; pane: TmuxWindow["panes"][number] } | null {
  for (const window of controller.windows) {
    const pane = window.panes.find((candidate) => candidate.id === paneId);
    if (pane) {
      return { window, pane };
    }
  }
  return null;
}

export function collectTmuxControllerPaneIds(controller: TmuxController): readonly TmuxPaneId[] {
  return controller.windows.flatMap((window) => window.panes.map((pane) => pane.id));
}

function validateTmuxWindows(windows: readonly TmuxWindow[]): ModelResult<void> {
  const windowIds = windows.map((window) => window.id);
  if (new Set(windowIds).size !== windowIds.length) {
    return modelFailure("duplicate-id", "tmux controller contains duplicate windows");
  }

  const paneIds = windows.flatMap((window) => window.panes.map((pane) => pane.id));
  if (new Set(paneIds).size !== paneIds.length) {
    return modelFailure("duplicate-id", "tmux controller contains the same pane more than once");
  }

  return modelSuccess(undefined);
}
