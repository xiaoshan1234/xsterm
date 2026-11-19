import { createLaunchConfigId, createPaneId, createTerminalId } from "../../../models";
import type {
  EditablePaneNode,
  PaneSplitDirection,
  SavedWindowConfig,
  SavedWorkspace,
} from "../contracts";

type JsonRecord = Record<string, unknown>;

export function parseSavedWindowConfig(value: unknown): SavedWindowConfig {
  const record = requireRecord(value, "SavedWindowConfig");
  return {
    id: createLaunchConfigId(requireNonEmptyString(record.id, "SavedWindowConfig.id")),
    name: requireNonEmptyString(record.name, "SavedWindowConfig.name"),
    rootPane: parseEditablePaneNode(record.rootPane),
  };
}

export function parseSavedWorkspace(value: unknown): SavedWorkspace {
  const record = requireRecord(value, "SavedWorkspace");
  if (!Array.isArray(record.windows)) {
    throw new Error("SavedWorkspace.windows must be an array");
  }
  return {
    id: createLaunchConfigId(requireNonEmptyString(record.id, "SavedWorkspace.id")),
    name: requireNonEmptyString(record.name, "SavedWorkspace.name"),
    windows: record.windows.map(parseSavedWindowConfig),
  };
}

export function parseLegacySavedWorkspace(value: unknown): SavedWorkspace {
  const record = requireRecord(value, "LegacySavedWorkspace");
  const id = createLaunchConfigId(requireNonEmptyString(record.id, "LegacySavedWorkspace.id"));
  const name = requireNonEmptyString(record.name, "LegacySavedWorkspace.name");
  return {
    id,
    name,
    windows: [
      {
        id: createLaunchConfigId(crypto.randomUUID()),
        name,
        rootPane: parseEditablePaneNode(record.rootPane),
      },
    ],
  };
}

export function parseEditablePaneNode(value: unknown): EditablePaneNode {
  const record = requireRecord(value, "EditablePaneNode");
  const type = record.type;
  if (type !== "leaf" && type !== "split") {
    throw new Error("EditablePaneNode.type must be leaf or split");
  }
  const configId = optionalConfigId(record.configId);

  const base: EditablePaneNode = {
    id: createPaneId(requireNonEmptyString(record.id, "EditablePaneNode.id")),
    type,
    size: requireFiniteNumber(record.size, "EditablePaneNode.size"),
    ...(record.terminalId !== undefined
      ? { terminalId: createTerminalId(requireFiniteNumber(record.terminalId, "terminalId")) }
      : {}),
    ...(configId !== undefined ? { configId } : {}),
  };

  if (type === "leaf") {
    return base;
  }

  const direction = requireSplitDirection(record.direction);
  if (!Array.isArray(record.children) || record.children.length < 2) {
    throw new Error("EditablePaneNode split nodes require at least two children");
  }
  return {
    ...base,
    type,
    direction,
    children: record.children.map(parseEditablePaneNode),
  };
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function optionalConfigId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("EditablePaneNode.configId must be a string");
  }
  return value.trim() || undefined;
}

function requireSplitDirection(value: unknown): PaneSplitDirection {
  if (value !== "horizontal" && value !== "vertical") {
    throw new Error("EditablePaneNode.direction must be horizontal or vertical");
  }
  return value;
}
