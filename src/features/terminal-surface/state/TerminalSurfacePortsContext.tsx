import { createContext, useContext, type ReactNode } from "react";
import type { TerminalId } from "../../../models";
import type { KeyChord } from "../../../shared/keyboard";

export type TerminalKeyActionId =
  "terminal.copy" | "terminal.paste" | "terminal.selectAll" | "terminal.clear";

export interface TerminalSurfaceTmuxError {
  reason?: string;
}

export interface TerminalSurfacePorts {
  session: {
    getEffectiveLocalEcho: (terminalId: TerminalId) => boolean;
    reconnect: (terminalId: TerminalId) => Promise<unknown>;
    resize: (terminalId: TerminalId, rows: number, cols: number) => Promise<void>;
    reportSize: (terminalId: TerminalId, rows: number, cols: number) => void;
    uploadImage: (terminalId: TerminalId, filename: string, data: Uint8Array) => Promise<string>;
    write: (terminalId: TerminalId, data: string) => Promise<void>;
    isTmuxTerminal: (terminalId: TerminalId) => boolean;
    touchActivity: (terminalId: TerminalId) => void;
  };
  stream: {
    subscribeOutput: (
      terminalId: TerminalId,
      onOutput: (data: Uint8Array) => void,
    ) => Promise<() => void>;
    writeBytes: (terminalId: TerminalId, data: Uint8Array) => Promise<void>;
  };
  clipboard: {
    readImages: (event: ClipboardEvent) => Promise<File[]>;
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  tmux: {
    capturePane: (terminalId: TerminalId, lines: number) => Promise<string>;
    getControllerError: (controllerId: number) => TerminalSurfaceTmuxError | undefined;
    retryController: (controllerId: number) => Promise<void>;
    dismissControllerError: (controllerId: number) => void;
  };
  keyboard: {
    shouldBlockAppChord: (chord: KeyChord) => boolean;
    resolveTerminalAction: (chord: KeyChord) => TerminalKeyActionId | undefined;
  };
}

const TerminalSurfacePortsContext = createContext<TerminalSurfacePorts | null>(null);

export function TerminalSurfacePortsProvider({
  ports,
  children,
}: {
  ports: TerminalSurfacePorts;
  children: ReactNode;
}) {
  return (
    <TerminalSurfacePortsContext.Provider value={ports}>
      {children}
    </TerminalSurfacePortsContext.Provider>
  );
}

export function useTerminalSurfacePorts(): TerminalSurfacePorts {
  const ports = useContext(TerminalSurfacePortsContext);
  if (!ports) {
    throw new Error("TerminalSurfacePortsProvider is missing");
  }
  return ports;
}
