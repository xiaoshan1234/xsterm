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

export interface TerminalState {
  terminals: Terminal[];
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  establishingTerminalsRef: MutableRefObject<Set<TerminalId>>;
  terminalSizesRef: MutableRefObject<Map<TerminalId, { rows: number; cols: number }>>;
  terminalSizesVersion: number;
  reportTerminalSize: (terminalId: TerminalId, rows: number, cols: number) => void;
}

export function useTerminalState(): TerminalState {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalSizesVersion, setTerminalSizesVersion] = useState(0);
  const terminalsRef = useRef(terminals);
  const establishingTerminalsRef = useRef<Set<TerminalId>>(new Set());
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
    setTerminals,
    terminalsRef,
    establishingTerminalsRef,
    terminalSizesRef,
    terminalSizesVersion,
    reportTerminalSize,
  };
}
