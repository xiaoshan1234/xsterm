import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Runtime-only connection summary used for display and terminal operations.
 * Credentials and full launch options live in `SshConnectionConfig` and
 * `LocalTerminalLaunchConfig`, not here.
 */
export interface LocalTerminalTransport {
  readonly kind: "local";
  readonly shell: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
}

export interface SshTerminalTransport {
  readonly kind: "ssh";
  readonly host: string;
  readonly port: number;
  readonly username: string;
}

export type TerminalTransport = LocalTerminalTransport | SshTerminalTransport;

export interface LocalTerminalTransportInput {
  shell: string;
  cwd?: string;
  args?: readonly string[];
}

export interface SshTerminalTransportInput {
  host: string;
  port: number;
  username: string;
}

export function createLocalTerminalTransport(
  input: LocalTerminalTransportInput,
): ModelResult<LocalTerminalTransport> {
  const shell = input.shell.trim();
  if (!shell) {
    return modelFailure("invalid-value", "Shell must not be empty");
  }

  const cwd = input.cwd?.trim();
  return modelSuccess({
    kind: "local",
    shell,
    ...(cwd ? { cwd } : {}),
    ...(input.args ? { args: [...input.args] } : {}),
  });
}

export function createSshTerminalTransport(
  input: SshTerminalTransportInput,
): ModelResult<SshTerminalTransport> {
  const host = input.host.trim();
  const username = input.username.trim();

  if (!host) {
    return modelFailure("invalid-value", "SSH host must not be empty");
  }
  if (!username) {
    return modelFailure("invalid-value", "SSH username must not be empty");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    return modelFailure("invalid-value", "SSH port must be between 1 and 65535");
  }

  return modelSuccess({
    kind: "ssh",
    host,
    port: input.port,
    username,
  });
}
