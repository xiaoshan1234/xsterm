import {
  createLaunchConfigId,
  createPaneId,
  createTmuxWindowId,
  createWindowId,
  createWorkspaceId,
  type LaunchConfigId,
  type PaneId,
  type TmuxWindowId,
  type WindowId,
  type WorkspaceId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import { type RawPaneDirection } from "./RawPaneTree";

/**
 * Persisted layout format. Runtime-only ids such as TerminalId,
 * TerminalStreamId and TmuxControllerId are intentionally absent.
 */
export interface WorkspaceSnapshot {
  readonly version: 1;
  readonly id: WorkspaceId;
  readonly name: string;
  readonly activeWindowId: WindowId;
  readonly windows: readonly WorkspaceWindowSnapshot[];
}

export type WorkspaceWindowSnapshot = RawWindowSnapshot | TmuxWindowReferenceSnapshot;

export interface RawWindowSnapshot {
  readonly kind: "raw-window";
  readonly id: WindowId;
  readonly name: string;
  readonly activePaneId: PaneId;
  readonly layout: RawPaneNodeSnapshot;
}

export interface TmuxWindowReferenceSnapshot {
  readonly kind: "tmux-window-reference";
  readonly id: WindowId;
  /** Persist the launch config that can recreate/attach this controller. */
  readonly controllerConfigId: LaunchConfigId;
  readonly tmuxWindowId: TmuxWindowId;
}

export type RawPaneNodeSnapshot = RawPaneLeafSnapshot | RawPaneSplitSnapshot;

export interface RawPaneLeafSnapshot {
  readonly kind: "leaf";
  readonly id: PaneId;
  readonly content:
    | { readonly kind: "empty" }
    | {
        readonly kind: "terminal";
        /** Runtime `TerminalId` is intentionally replaced by its launch config. */
        readonly configId: LaunchConfigId;
      };
}

export interface RawPaneSplitSnapshot {
  readonly kind: "split";
  readonly id: PaneId;
  readonly direction: RawPaneDirection;
  readonly ratio: number;
  readonly children: readonly [RawPaneNodeSnapshot, RawPaneNodeSnapshot];
}

/**
 * Entry point for persisted workspace data. The version field is validated
 * before the layout is trusted.
 */
export function migrateWorkspaceSnapshot(raw: unknown): ModelResult<WorkspaceSnapshot> {
  if (!isRecord(raw)) {
    return modelFailure("invalid-value", "Workspace snapshot must be an object");
  }

  if (raw.version !== 1) {
    return modelFailure(
      "invalid-value",
      `Unsupported workspace snapshot version: ${String(raw.version)}`,
    );
  }

  return parseWorkspaceSnapshotV1(raw);
}

export function parseWorkspaceSnapshot(raw: unknown): ModelResult<WorkspaceSnapshot> {
  return migrateWorkspaceSnapshot(raw);
}

function parseWorkspaceSnapshotV1(raw: Record<string, unknown>): ModelResult<WorkspaceSnapshot> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || !Array.isArray(raw.windows) || raw.windows.length === 0) {
    return modelFailure(
      "invalid-layout",
      "Workspace snapshot requires a name and at least one window",
    );
  }

  const windowIds = new Set<string>();
  const tmuxWindowKeys = new Set<string>();
  const windows: WorkspaceWindowSnapshot[] = [];

  for (const rawWindow of raw.windows) {
    const windowResult = parseWorkspaceWindowSnapshot(rawWindow, windowIds, tmuxWindowKeys);
    if (!windowResult.ok) {
      return windowResult;
    }
    windows.push(windowResult.value);
  }

  try {
    const id = createWorkspaceId(requireString(raw.id, "workspace id"));
    const activeWindowId = createWindowId(requireString(raw.activeWindowId, "active window id"));
    if (!windowIds.has(activeWindowId)) {
      return modelFailure("invalid-layout", "Active window does not exist in the snapshot");
    }

    return modelSuccess({
      version: 1,
      id,
      name,
      activeWindowId,
      windows,
    });
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid workspace snapshot id",
    );
  }
}

function parseWorkspaceWindowSnapshot(
  raw: unknown,
  windowIds: Set<string>,
  tmuxWindowKeys: Set<string>,
): ModelResult<WorkspaceWindowSnapshot> {
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    return modelFailure("invalid-value", "Workspace window snapshot is malformed");
  }

  try {
    const id = createWindowId(requireString(raw.id, "window id"));
    if (windowIds.has(id)) {
      return modelFailure("duplicate-id", `Duplicate window id: ${id}`);
    }
    windowIds.add(id);

    if (raw.kind === "raw-window") {
      if (typeof raw.name !== "string") {
        return modelFailure("invalid-value", "Raw window name must be a string");
      }
      const name = raw.name.trim();
      if (!name) {
        return modelFailure("invalid-value", "Raw window name must not be empty");
      }
      const activePaneId = createPaneId(requireString(raw.activePaneId, "active pane id"));
      const paneIds = new Set<string>();
      const layoutResult = parseRawPaneNodeSnapshot(raw.layout, paneIds);
      if (!layoutResult.ok) {
        return layoutResult;
      }
      if (!paneIds.has(activePaneId)) {
        return modelFailure("invalid-layout", "Active pane does not exist in raw window snapshot");
      }

      return modelSuccess({
        kind: "raw-window",
        id,
        name,
        activePaneId,
        layout: layoutResult.value,
      });
    }

    if (raw.kind === "tmux-window-reference") {
      const controllerConfigId = createLaunchConfigId(
        requireString(raw.controllerConfigId, "tmux controller config id"),
      );
      const tmuxWindowId = createTmuxWindowId(requireString(raw.tmuxWindowId, "tmux window id"));
      const key = `${controllerConfigId}:${tmuxWindowId}`;
      if (tmuxWindowKeys.has(key)) {
        return modelFailure("duplicate-id", "tmux window is referenced more than once");
      }
      tmuxWindowKeys.add(key);

      return modelSuccess({
        kind: "tmux-window-reference",
        id,
        controllerConfigId,
        tmuxWindowId,
      });
    }

    return modelFailure("invalid-value", `Unknown workspace window kind: ${raw.kind}`);
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid workspace window snapshot id",
    );
  }
}

function parseRawPaneNodeSnapshot(
  raw: unknown,
  paneIds: Set<string>,
): ModelResult<RawPaneNodeSnapshot> {
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    return modelFailure("invalid-value", "Raw pane snapshot is malformed");
  }

  try {
    const id = createPaneId(requireString(raw.id, "pane id"));
    if (paneIds.has(id)) {
      return modelFailure("duplicate-id", `Duplicate pane id: ${id}`);
    }
    paneIds.add(id);

    if (raw.kind === "leaf") {
      const content = parseRawPaneContentSnapshot(raw.content);
      if (!content.ok) {
        return content;
      }
      return modelSuccess({ kind: "leaf", id, content: content.value });
    }

    if (
      raw.kind === "split" &&
      (raw.direction === "horizontal" || raw.direction === "vertical") &&
      typeof raw.ratio === "number" &&
      raw.ratio >= 0.1 &&
      raw.ratio <= 0.9 &&
      Array.isArray(raw.children) &&
      raw.children.length === 2
    ) {
      const first = parseRawPaneNodeSnapshot(raw.children[0], paneIds);
      if (!first.ok) return first;
      const second = parseRawPaneNodeSnapshot(raw.children[1], paneIds);
      if (!second.ok) return second;

      return modelSuccess({
        kind: "split",
        id,
        direction: raw.direction,
        ratio: raw.ratio,
        children: [first.value, second.value],
      });
    }

    return modelFailure("invalid-layout", "Raw pane split snapshot is malformed");
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid pane snapshot id",
    );
  }
}

function parseRawPaneContentSnapshot(raw: unknown): ModelResult<RawPaneLeafSnapshot["content"]> {
  if (!isRecord(raw)) {
    return modelFailure("invalid-value", "Pane content snapshot is malformed");
  }
  if (raw.kind === "empty") {
    return modelSuccess({ kind: "empty" });
  }
  if (raw.kind === "terminal") {
    try {
      return modelSuccess({
        kind: "terminal",
        configId: createLaunchConfigId(requireString(raw.configId, "terminal config id")),
      });
    } catch (error) {
      return modelFailure(
        "invalid-id",
        error instanceof Error ? error.message : "Invalid terminal config id",
      );
    }
  }

  return modelFailure("invalid-value", "Unknown pane content kind");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  return value;
}
