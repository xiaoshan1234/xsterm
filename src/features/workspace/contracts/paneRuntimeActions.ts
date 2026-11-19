import type { TerminalId } from "../../../models";

export interface WorkspacePaneRuntimeActions {
  createMultiplexedWindow: (terminalId: TerminalId) => Promise<void>;
  closeMultiplexedWindow: (xstermWindowId: number) => Promise<void>;
  renameMultiplexedWindow: (xstermWindowId: number, name: string) => Promise<void>;
}
