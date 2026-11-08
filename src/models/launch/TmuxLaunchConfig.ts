import { modelSuccess, type ModelResult } from "../result";
import {
  createSshTerminalTransport,
  type SshTerminalTransport,
} from "../terminal/TerminalTransport";

export interface LocalTmuxLaunchTransport {
  readonly kind: "local";
  readonly socketName?: string;
}

export interface SshTmuxLaunchTransport {
  readonly kind: "ssh";
  readonly socketName?: string;
  readonly ssh: SshTerminalTransport;
}

export type TmuxLaunchTransport = LocalTmuxLaunchTransport | SshTmuxLaunchTransport;

export interface TmuxLaunchConfig {
  readonly kind: "tmux";
  readonly tmuxSessionName?: string;
  readonly startCommand?: string;
  readonly transport: TmuxLaunchTransport;
}

export function createLocalTmuxLaunchConfig(input?: {
  tmuxSessionName?: string;
  socketName?: string;
  startCommand?: string;
}): ModelResult<TmuxLaunchConfig> {
  return createTmuxLaunchConfig({
    ...input,
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
  host: string;
  port: number;
  username: string;
}): ModelResult<TmuxLaunchConfig> {
  const sshResult = createSshTerminalTransport({
    host: input.host,
    port: input.port,
    username: input.username,
  });
  if (!sshResult.ok) {
    return sshResult;
  }

  return createTmuxLaunchConfig({
    ...input,
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
  transport: TmuxLaunchTransport;
}): ModelResult<TmuxLaunchConfig> {
  const tmuxSessionName = input.tmuxSessionName?.trim();
  const startCommand = input.startCommand?.trim();

  return modelSuccess({
    kind: "tmux",
    ...(tmuxSessionName ? { tmuxSessionName } : {}),
    ...(startCommand ? { startCommand } : {}),
    transport: input.transport,
  });
}
