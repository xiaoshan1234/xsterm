import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Terminal } from "../contracts";

export interface TerminalSessionState {
  terminals: Terminal[];
  setSessions: Dispatch<SetStateAction<Terminal[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  establishingSessionsRef: MutableRefObject<Set<number>>;
  terminalSizesRef: MutableRefObject<Map<number, { rows: number; cols: number }>>;
  terminalSizesVersion: number;
  reportTerminalSize: (terminalId: number, rows: number, cols: number) => void;
}

export function useTerminalSessionState(): TerminalSessionState {
  const [terminals, setSessions] = useState<Terminal[]>([]);
  const [terminalSizesVersion, setTerminalSizesVersion] = useState(0);
  const terminalsRef = useRef(terminals);
  const establishingSessionsRef = useRef<Set<number>>(new Set());
  const terminalSizesRef = useRef<Map<number, { rows: number; cols: number }>>(new Map());

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  const reportTerminalSize = useCallback((terminalId: number, rows: number, cols: number) => {
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
