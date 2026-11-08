import { modelSuccess, type ModelResult } from "../result";
import {
  createSshConnectionConfig,
  type CreateSshConnectionConfigInput,
  type SshConnectionConfig,
} from "../ssh/SshConnectionConfig";
import {
  createShellEnvironmentConfig,
  type CreateShellEnvironmentConfigInput,
  type ShellEnvironmentConfig,
} from "./ShellEnvironmentConfig";

export interface LocalTmuxLaunchTransport {
  readonly kind: "local";
  readonly socketName?: string;
}

export interface SshTmuxLaunchTransport {
  readonly kind: "ssh";
  readonly socketName?: string;
  /** Full SSH connection config; this does not create an SSH `Terminal`. */
  readonly ssh: SshConnectionConfig;
}

export type TmuxLaunchTransport = LocalTmuxLaunchTransport | SshTmuxLaunchTransport;

/**
 * tmux launch configuration. The transport describes how tmux is started;
 * windows and panes are created later and belong to `TmuxController`.
 */
export interface TmuxLaunchConfig {
  readonly kind: "tmux";
  readonly tmuxSessionName?: string;
  readonly startCommand?: string;
  /** Environment overrides applied to the tmux server or initial command. */
  readonly environment: ShellEnvironmentConfig;
  readonly transport: TmuxLaunchTransport;
}

export function createLocalTmuxLaunchConfig(input?: {
  tmuxSessionName?: string;
  socketName?: string;
  startCommand?: string;
  environment?: CreateShellEnvironmentConfigInput;
}): ModelResult<TmuxLaunchConfig> {
  const environmentResult = createShellEnvironmentConfig(input?.environment);
  if (!environmentResult.ok) {
    return environmentResult;
  }

  return createTmuxLaunchConfig({
    ...input,
    environment: environmentResult.value,
    transport: {
      kind: "local",
      ...(input?.socketName ? { socketName: input.socketName } : {}),
    },
  });
}

export function createSshTmuxLaunchConfig(input: {
  tmuxSessionName?: string;
  socketName?: string;
  startCommand?: string;
  environment?: CreateShellEnvironmentConfigInput;
  connection: CreateSshConnectionConfigInput;
}): ModelResult<TmuxLaunchConfig> {
  const sshResult = createSshConnectionConfig(input.connection);
  if (!sshResult.ok) {
    return sshResult;
  }
  const environmentResult = createShellEnvironmentConfig(input.environment);
  if (!environmentResult.ok) {
    return environmentResult;
  }

  return createTmuxLaunchConfig({
    ...input,
    environment: environmentResult.value,
    transport: {
      kind: "ssh",
      ssh: sshResult.value,
      ...(input.socketName ? { socketName: input.socketName } : {}),
    },
  });
}

function createTmuxLaunchConfig(input: {
  tmuxSessionName?: string;
  startCommand?: string;
  environment: ShellEnvironmentConfig;
  transport: TmuxLaunchTransport;
}): ModelResult<TmuxLaunchConfig> {
  const tmuxSessionName = input.tmuxSessionName?.trim();
  const startCommand = input.startCommand?.trim();

  return modelSuccess({
    kind: "tmux",
    ...(tmuxSessionName ? { tmuxSessionName } : {}),
    ...(startCommand ? { startCommand } : {}),
    environment: input.environment,
    transport: input.transport,
  });
}
