import { modelFailure, modelSuccess, type ModelResult } from "../result";
import {
  createSshConnectionConfig,
  type CreateSshConnectionConfigInput,
  type SshConnectionConfig,
} from "../ssh/SshConnectionConfig";
import { createLocalTerminalTransport } from "../terminal/TerminalTransport";
import {
  createShellEnvironmentConfig,
  type CreateShellEnvironmentConfigInput,
  type ShellEnvironmentConfig,
} from "./ShellEnvironmentConfig";

/**
 * Inputs required to create a single non-tmux terminal. This model contains
 * launch configuration, not runtime status or pane identity.
 */
export type TerminalLaunchConfig = LocalTerminalLaunchConfig | SshTerminalLaunchConfig;

export interface LocalTerminalLaunchConfig {
  readonly kind: "local";
  readonly shell: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
  readonly environment: ShellEnvironmentConfig;
  readonly termType?: string;
  readonly charset?: string;
  readonly startupCommand?: string;
  readonly startupDelayMs?: number;
}

export interface SshTerminalLaunchConfig {
  readonly kind: "ssh";
  /** Full connection configuration, including sensitive authentication data. */
  readonly connection: SshConnectionConfig;
  readonly termType?: string;
  readonly charset?: string;
}

export interface CreateLocalTerminalLaunchConfigInput {
  shell: string;
  cwd?: string;
  args?: readonly string[];
  environment?: CreateShellEnvironmentConfigInput;
  termType?: string;
  charset?: string;
  startupCommand?: string;
  startupDelayMs?: number;
}

export interface CreateSshTerminalLaunchConfigInput {
  connection: CreateSshConnectionConfigInput;
  termType?: string;
  charset?: string;
}

export function createLocalTerminalLaunchConfig(
  input: CreateLocalTerminalLaunchConfigInput,
): ModelResult<LocalTerminalLaunchConfig> {
  const transportResult = createLocalTerminalTransport({
    shell: input.shell,
    cwd: input.cwd,
    args: input.args,
  });
  if (!transportResult.ok) {
    return transportResult;
  }

  const environmentResult = createShellEnvironmentConfig(input.environment);
  if (!environmentResult.ok) {
    return environmentResult;
  }
  if (
    input.startupDelayMs !== undefined &&
    (!Number.isInteger(input.startupDelayMs) || input.startupDelayMs < 0)
  ) {
    return modelFailure("invalid-value", "Terminal startup delay must be a non-negative integer");
  }

  const termType = input.termType?.trim();
  const charset = input.charset?.trim();
  const startupCommand = input.startupCommand?.trim();

  return modelSuccess({
    ...transportResult.value,
    environment: environmentResult.value,
    ...(termType ? { termType } : {}),
    ...(charset ? { charset } : {}),
    ...(startupCommand ? { startupCommand } : {}),
    ...(input.startupDelayMs !== undefined ? { startupDelayMs: input.startupDelayMs } : {}),
  });
}

export function createSshTerminalLaunchConfig(
  input: CreateSshTerminalLaunchConfigInput,
): ModelResult<SshTerminalLaunchConfig> {
  const connectionResult = createSshConnectionConfig(input.connection);
  if (!connectionResult.ok) {
    return connectionResult;
  }

  const termType = input.termType?.trim();
  const charset = input.charset?.trim();

  return modelSuccess({
    kind: "ssh",
    connection: connectionResult.value,
    ...(termType ? { termType } : {}),
    ...(charset ? { charset } : {}),
  });
}
