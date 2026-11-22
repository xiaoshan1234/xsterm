import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { TerminalId } from "../../../models";

export interface TerminalViewportController {
  getTopLine: () => number;
  scrollToLine: (line: number) => void;
  getBufferType: () => "normal" | "alternate";
  scrollToBottom: () => void;
  jumpToPrompt: () => Promise<boolean>;
}

interface TerminalViewportContextValue {
  register: (terminalId: TerminalId, controller: TerminalViewportController) => () => void;
  getTopLine: (terminalId: TerminalId) => number | undefined;
  scrollToLine: (terminalId: TerminalId, line: number) => void;
  getBufferType: (terminalId: TerminalId) => "normal" | "alternate" | undefined;
  scrollToBottom: (terminalId: TerminalId) => void;
  jumpToPrompt: (terminalId: TerminalId) => Promise<boolean>;
}

const TerminalViewportContext = createContext<TerminalViewportContextValue | null>(null);

export function TerminalViewportProvider({ children }: { children: ReactNode }) {
  const controllersRef = useRef(new Map<TerminalId, TerminalViewportController>());

  const register = useCallback((terminalId: TerminalId, controller: TerminalViewportController) => {
    controllersRef.current.set(terminalId, controller);
    return () => {
      if (controllersRef.current.get(terminalId) === controller) {
        controllersRef.current.delete(terminalId);
      }
    };
  }, []);

  const getTopLine = useCallback((terminalId: TerminalId) => {
    return controllersRef.current.get(terminalId)?.getTopLine();
  }, []);

  const scrollToLine = useCallback((terminalId: TerminalId, line: number) => {
    controllersRef.current.get(terminalId)?.scrollToLine(line);
  }, []);

  const getBufferType = useCallback((terminalId: TerminalId) => {
    return controllersRef.current.get(terminalId)?.getBufferType();
  }, []);

  const scrollToBottom = useCallback((terminalId: TerminalId) => {
    controllersRef.current.get(terminalId)?.scrollToBottom();
  }, []);

  const jumpToPrompt = useCallback((terminalId: TerminalId) => {
    return controllersRef.current.get(terminalId)?.jumpToPrompt() ?? Promise.resolve(false);
  }, []);

  const value = useMemo(
    () => ({ register, getTopLine, scrollToLine, getBufferType, scrollToBottom, jumpToPrompt }),
    [getBufferType, getTopLine, jumpToPrompt, register, scrollToBottom, scrollToLine],
  );

  return (
    <TerminalViewportContext.Provider value={value}>{children}</TerminalViewportContext.Provider>
  );
}

export function useTerminalViewport(): TerminalViewportContextValue {
  const value = useContext(TerminalViewportContext);
  if (!value) {
    throw new Error("TerminalViewportProvider is missing");
  }
  return value;
}
