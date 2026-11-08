import {
  createLaunchConfigId,
  createTerminalId,
  type LaunchConfigId,
  type TerminalId,
} from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";
import {
  createDefaultTerminalCapabilities,
  type TerminalCapabilities,
} from "./TerminalCapabilities";
import {
  createDefaultTerminalDisplayConfig,
  resolveTerminalDisplayConfig,
  type ResolvedTerminalDisplayConfig,
  type TerminalDisplayOverrides,
} from "./TerminalDisplayConfig";
import {
  createConnectedStatus,
  createConnectingStatus,
  createDisconnectedStatus,
  createFailedStatus,
  type TerminalStatus,
} from "./TerminalStatus";
import { type TerminalTransport } from "./TerminalTransport";

/**
 * A terminal that owns exactly one backend terminal stream. Local shells
 * and SSH terminals share this model because both are attached to one pane.
 *
 * tmux panes are intentionally not represented as `Terminal`; they belong to a
 * `TmuxController` aggregate.
 */
export interface Terminal {
  readonly kind: "terminal";
  readonly id: TerminalId;
  readonly configId: LaunchConfigId | null;
  readonly title: string;
  readonly transport: TerminalTransport;
  readonly status: TerminalStatus;
  readonly capabilities: TerminalCapabilities;
  /** Fully resolved; consumers never have to apply defaults themselves. */
  readonly displayConfig: ResolvedTerminalDisplayConfig;
  readonly createdAt: number;
}

export interface CreateTerminalInput {
  id: number;
  configId: string | null;
  title: string;
  transport: TerminalTransport;
  capabilities?: TerminalCapabilities;
  displayConfig?: ResolvedTerminalDisplayConfig;
  createdAt?: number;
}

export function createTerminal(input: CreateTerminalInput): ModelResult<Terminal> {
  const title = input.title.trim();
  if (!title) {
    return modelFailure("invalid-value", "Terminal title must not be empty");
  }

  let id: TerminalId;
  try {
    id = createTerminalId(input.id);
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid terminal instance id",
    );
  }

  let configId: LaunchConfigId | null = null;
  if (input.configId !== null) {
    try {
      configId = createLaunchConfigId(input.configId);
    } catch (error) {
      return modelFailure(
        "invalid-id",
        error instanceof Error ? error.message : "Invalid launch config id",
      );
    }
  }

  const createdAt = input.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt)) {
    return modelFailure("invalid-value", "Terminal createdAt must be a finite timestamp");
  }

  return modelSuccess({
    kind: "terminal",
    id,
    configId,
    title,
    transport: input.transport,
    status: createConnectingStatus(),
    capabilities: input.capabilities ?? createDefaultTerminalCapabilities(),
    displayConfig: input.displayConfig ?? createDefaultTerminalDisplayConfig(),
    createdAt,
  });
}

export function markTerminalConnected(terminal: Terminal, connectedAt: number): Terminal {
  return {
    ...terminal,
    status: createConnectedStatus(connectedAt),
  };
}

export function markTerminalDisconnected(
  terminal: Terminal,
  disconnectedAt: number,
  reason?: string,
): Terminal {
  return {
    ...terminal,
    status: createDisconnectedStatus(disconnectedAt, reason),
  };
}

export function markTerminalFailed(terminal: Terminal, failedAt: number, error: string): Terminal {
  return {
    ...terminal,
    status: createFailedStatus(failedAt, error),
  };
}

export function renameTerminal(terminal: Terminal, title: string): ModelResult<Terminal> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return modelFailure("invalid-value", "Terminal title must not be empty");
  }

  return modelSuccess({
    ...terminal,
    title: normalizedTitle,
  });
}

export function updateTerminalDisplayConfig(
  terminal: Terminal,
  overrides: TerminalDisplayOverrides,
): ModelResult<Terminal> {
  // Runtime changes are layered over the effective config so unsaved terminals
  // and saved terminals follow the same behavior.
  const displayResult = resolveTerminalDisplayConfig(terminal.displayConfig, overrides);
  if (!displayResult.ok) {
    return displayResult;
  }

  return modelSuccess({
    ...terminal,
    displayConfig: displayResult.value,
  });
}

export type TerminalEvent =
  | {
      readonly kind: "terminal.connected";
      readonly terminalId: Terminal["id"];
      readonly occurredAt: number;
    }
  | {
      readonly kind: "terminal.disconnected";
      readonly terminalId: Terminal["id"];
      readonly occurredAt: number;
      readonly reason?: string;
    }
  | {
      readonly kind: "terminal.closed";
      readonly terminalId: Terminal["id"];
      readonly occurredAt: number;
    };
