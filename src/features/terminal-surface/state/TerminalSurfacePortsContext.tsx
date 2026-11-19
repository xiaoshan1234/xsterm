import { createContext, useContext, type ReactNode } from "react";

export interface TerminalSurfaceTmuxError {
  reason?: string;
}

export interface TerminalSurfacePorts {
  session: {
    getEffectiveLocalEcho: (terminalId: number) => boolean;
    reconnect: (terminalId: number) => Promise<unknown>;
    resize: (terminalId: number, rows: number, cols: number) => Promise<void>;
    reportSize: (terminalId: number, rows: number, cols: number) => void;
    uploadImage: (terminalId: number, filename: string, data: Uint8Array) => Promise<string>;
    write: (terminalId: number, data: string) => Promise<void>;
    isTmuxTerminal: (terminalId: number) => boolean;
    touchActivity: (terminalId: number) => void;
  };
  stream: {
    subscribeOutput: (
      terminalId: number,
      onOutput: (data: Uint8Array) => void,
    ) => Promise<() => void>;
    writeBytes: (terminalId: number, data: Uint8Array) => Promise<void>;
  };
  clipboard: {
    readImages: (event: ClipboardEvent) => Promise<File[]>;
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  tmux: {
    capturePane: (terminalId: number, lines: number) => Promise<string>;
    getControllerError: (controllerId: number) => TerminalSurfaceTmuxError | undefined;
    retryController: (controllerId: number) => Promise<void>;
    dismissControllerError: (controllerId: number) => void;
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
