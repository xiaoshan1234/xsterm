export type TerminalStatus =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly connectedAt: number;
    }
  | {
      readonly kind: "disconnected";
      readonly disconnectedAt: number;
      readonly reason?: string;
    }
  | {
      readonly kind: "failed";
      readonly failedAt: number;
      readonly error: string;
    };

export function createConnectingStatus(): TerminalStatus {
  return { kind: "connecting" };
}

export function createConnectedStatus(connectedAt: number): TerminalStatus {
  return { kind: "connected", connectedAt };
}

export function createDisconnectedStatus(disconnectedAt: number, reason?: string): TerminalStatus {
  return {
    kind: "disconnected",
    disconnectedAt,
    ...(reason ? { reason } : {}),
  };
}

export function createFailedStatus(failedAt: number, error: string): TerminalStatus {
  return {
    kind: "failed",
    failedAt,
    error,
  };
}

export function canWriteToTerminal(status: TerminalStatus): boolean {
  return status.kind === "connected";
}
