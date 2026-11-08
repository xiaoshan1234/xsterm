export interface TerminalCapabilities {
  readonly canReconnect: boolean;
  readonly canResize: boolean;
  readonly canUseLocalEcho: boolean;
  readonly canUseMultiplexing: boolean;
}

export function createDefaultTerminalCapabilities(): TerminalCapabilities {
  return {
    canReconnect: false,
    canResize: true,
    canUseLocalEcho: true,
    canUseMultiplexing: false,
  };
}
