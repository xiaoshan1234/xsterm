import { modelFailure, modelSuccess, type ModelResult } from "../result";
import {
  createSshTerminalTransport,
  type SshTerminalTransport,
} from "../terminal/TerminalTransport";
import {
  createSshAuthentication,
  type SshAuthentication,
  type SshAuthenticationInput,
} from "./SshAuthentication";

/**
 * Complete configuration required to establish an SSH connection. This is a
 * launch/persistence model and may contain credentials.
 *
 * Use `toSshTerminalTransport` before storing connection details on a running
 * terminal so passwords and passphrases do not leak into runtime UI state.
 */
export interface SshConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authentication: SshAuthentication;
  readonly keepaliveIntervalSeconds?: number;
  readonly connectionTimeoutSeconds?: number;
  readonly tcpNoDelay?: boolean;
  readonly socketKeepalive?: boolean;
  readonly nullPacketKeepalive?: boolean;
  readonly enableCompression?: boolean;
  readonly proxyJump?: string;
  readonly knownHostsPath?: string;
}

export interface CreateSshConnectionConfigInput {
  host: string;
  port: number;
  username: string;
  authentication: SshAuthenticationInput;
  keepaliveIntervalSeconds?: number;
  connectionTimeoutSeconds?: number;
  tcpNoDelay?: boolean;
  socketKeepalive?: boolean;
  nullPacketKeepalive?: boolean;
  enableCompression?: boolean;
  proxyJump?: string;
  knownHostsPath?: string;
}

export function createSshConnectionConfig(
  input: CreateSshConnectionConfigInput,
): ModelResult<SshConnectionConfig> {
  const transportResult = createSshTerminalTransport({
    host: input.host,
    port: input.port,
    username: input.username,
  });
  if (!transportResult.ok) {
    return transportResult;
  }

  const authenticationResult = createSshAuthentication(input.authentication);
  if (!authenticationResult.ok) {
    return authenticationResult;
  }
  if (
    input.keepaliveIntervalSeconds !== undefined &&
    (!Number.isInteger(input.keepaliveIntervalSeconds) || input.keepaliveIntervalSeconds < 0)
  ) {
    return modelFailure("invalid-value", "SSH keepalive interval must be a non-negative integer");
  }
  if (
    input.connectionTimeoutSeconds !== undefined &&
    (!Number.isInteger(input.connectionTimeoutSeconds) || input.connectionTimeoutSeconds < 1)
  ) {
    return modelFailure("invalid-value", "SSH connection timeout must be a positive integer");
  }

  const proxyJump = input.proxyJump?.trim();
  const knownHostsPath = input.knownHostsPath?.trim();

  return modelSuccess({
    host: transportResult.value.host,
    port: transportResult.value.port,
    username: transportResult.value.username,
    authentication: authenticationResult.value,
    ...(input.keepaliveIntervalSeconds !== undefined
      ? { keepaliveIntervalSeconds: input.keepaliveIntervalSeconds }
      : {}),
    ...(input.connectionTimeoutSeconds !== undefined
      ? { connectionTimeoutSeconds: input.connectionTimeoutSeconds }
      : {}),
    ...(input.tcpNoDelay !== undefined ? { tcpNoDelay: input.tcpNoDelay } : {}),
    ...(input.socketKeepalive !== undefined ? { socketKeepalive: input.socketKeepalive } : {}),
    ...(input.nullPacketKeepalive !== undefined
      ? { nullPacketKeepalive: input.nullPacketKeepalive }
      : {}),
    ...(input.enableCompression !== undefined
      ? { enableCompression: input.enableCompression }
      : {}),
    ...(proxyJump ? { proxyJump } : {}),
    ...(knownHostsPath ? { knownHostsPath } : {}),
  });
}

/** Projects sensitive launch configuration into a safe runtime summary. */
export function toSshTerminalTransport(config: SshConnectionConfig): SshTerminalTransport {
  return {
    kind: "ssh",
    host: config.host,
    port: config.port,
    username: config.username,
  };
}
