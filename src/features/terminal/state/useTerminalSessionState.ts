import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TerminalId } from "../../../models";
import type { Terminal } from "../contracts";

export interface TerminalSessionState {
  terminals: Terminal[];
  setSessions: Dispatch<SetStateAction<Terminal[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  establishingSessionsRef: MutableRefObject<Set<TerminalId>>;
  terminalSizesRef: MutableRefObject<Map<TerminalId, { rows: number; cols: number }>>;
  terminalSizesVersion: number;
  reportTerminalSize: (terminalId: TerminalId, rows: number, cols: number) => void;
}

export function useTerminalSessionState(): TerminalSessionState {
  const [terminals, setSessions] = useState<Terminal[]>([]);
  const [terminalSizesVersion, setTerminalSizesVersion] = useState(0);
  const terminalsRef = useRef(terminals);
  const establishingSessionsRef = useRef<Set<TerminalId>>(new Set());
  const terminalSizesRef = useRef<Map<TerminalId, { rows: number; cols: number }>>(new Map());

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  const reportTerminalSize = useCallback((terminalId: TerminalId, rows: number, cols: number) => {
    const previous = terminalSizesRef.current.get(terminalId);
    if (previous?.rows === rows && previous?.cols === cols) return;
    terminalSizesRef.current.set(terminalId, { rows, cols });
    setTerminalSizesVersion((version) => version + 1);
  }, []);

  return {
    terminals,
    setSessions,
    terminalsRef,
    establishingSessionsRef,
    terminalSizesRef,
    terminalSizesVersion,
    reportTerminalSize,
  };
}
