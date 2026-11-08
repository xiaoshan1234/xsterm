import { modelSuccess, type ModelResult } from "../result";
import {
  createLocalTerminalTransport,
  createSshTerminalTransport,
} from "../terminal/TerminalTransport";

export type TerminalLaunchConfig = LocalTerminalLaunchConfig | SshTerminalLaunchConfig;

export interface LocalTerminalLaunchConfig {
  readonly kind: "local";
  readonly shell: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
}

export interface SshTerminalLaunchConfig {
  readonly kind: "ssh";
  readonly host: string;
  readonly port: number;
  readonly username: string;
}

export function createLocalTerminalLaunchConfig(
  shell: string,
  cwd?: string,
  args?: readonly string[],
): ModelResult<LocalTerminalLaunchConfig> {
  const transportResult = createLocalTerminalTransport({ shell, cwd, args });
  if (!transportResult.ok) {
    return transportResult;
  }

  return modelSuccess({
    ...transportResult.value,
  });
}

export function createSshTerminalLaunchConfig(
  host: string,
  port: number,
  username: string,
): ModelResult<SshTerminalLaunchConfig> {
  const transportResult = createSshTerminalTransport({ host, port, username });
  if (!transportResult.ok) {
    return transportResult;
  }

  return modelSuccess({
    ...transportResult.value,
  });
}
