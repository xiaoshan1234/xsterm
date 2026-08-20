import { useCallback, useEffect, useRef, useState } from "react";

type SplitMode = "line" | "character";
type RunState = "idle" | "running" | "paused";

interface LineSendMeta {
  timestamp: string;
  number: number;
}

interface UseCommandExecutorDeps {
  input: string;
  splitMode: SplitMode;
  count: number;
  intervalMs: number;
  writeSession: (id: number, data: string) => Promise<void>;
  getTargetSessions: () => number[];
}

export interface CommandExecutor {
  runState: RunState;
  breakpoints: Set<number>;
  setBreakpoints: React.Dispatch<React.SetStateAction<Set<number>>>;
  lineMeta: Record<number, LineSendMeta>;
  toggleBreakpoint: (lineIndex: number) => void;
  handlePlay: () => void;
  handleStop: () => void;
  markIntervalUserSet: () => void;
  intervalUserSet: boolean;
  getActiveLineIndex: () => number | null;
}

function formatTimestamp(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function useCommandExecutor(deps: UseCommandExecutorDeps): CommandExecutor {
  const { input, splitMode, count, intervalMs, writeSession, getTargetSessions } = deps;

  const [runState, setRunState] = useState<RunState>("idle");
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [lineMeta, setLineMeta] = useState<Record<number, LineSendMeta>>({});
  const [intervalUserSet, setIntervalUserSet] = useState(false);

  const stopRef = useRef(false);
  const lineCounterRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkIndexRef = useRef(0);
  const repetitionRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const chunkToLineIndexRef = useRef<number[]>([]);
  const hasUserSetIntervalRef = useRef(false);
  const isContinuingRef = useRef(false);

  // Latest-ref pattern: keeps the executor's useCallbacks stable across
  // caller-side prop changes (matches the original CommandSendPanel behaviour).
  const breakpointsRef = useRef(breakpoints);
  const countRef = useRef(count);
  const intervalValueRef = useRef(intervalMs);
  const splitModeRef = useRef(splitMode);
  const writeSessionRef = useRef(writeSession);
  const getTargetSessionsRef = useRef(getTargetSessions);

  useEffect(() => {
    breakpointsRef.current = breakpoints;
    countRef.current = count;
    intervalValueRef.current = intervalMs;
    splitModeRef.current = splitMode;
    writeSessionRef.current = writeSession;
    getTargetSessionsRef.current = getTargetSessions;
  });

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resetExecution = useCallback(() => {
    clearTimer();
    stopRef.current = true;
    isContinuingRef.current = false;
    chunkIndexRef.current = 0;
    repetitionRef.current = 0;
    chunksRef.current = [];
    chunkToLineIndexRef.current = [];
    setRunState("idle");
  }, [clearTimer]);

  const runNext = useCallback(() => {
    if (stopRef.current) return;

    const chunks = chunksRef.current;
    const chunkToLineIndex = chunkToLineIndexRef.current;

    if (repetitionRef.current >= countRef.current || chunks.length === 0) {
      resetExecution();
      return;
    }

    const chunkIndex = chunkIndexRef.current;
    const chunk = chunks[chunkIndex];

    if (splitModeRef.current === "line" && chunkToLineIndex.length > 0) {
      const lineIndex = chunkToLineIndex[chunkIndex];
      if (breakpointsRef.current.has(lineIndex)) {
        setRunState("paused");
        return;
      }
    }

    const dataToSend = splitModeRef.current === "line" ? chunk + "\r\n" : chunk;

    const sessionIds = getTargetSessionsRef.current();
    sessionIds.forEach((id) => {
      writeSessionRef.current(id, dataToSend).catch(console.error);
    });

    if (splitModeRef.current === "line" && chunkToLineIndex.length > 0) {
      const sentLineIndex = chunkToLineIndex[chunkIndex];
      lineCounterRef.current += 1;
      const number = lineCounterRef.current;
      const timestamp = formatTimestamp(new Date());
      setLineMeta((prev) => ({ ...prev, [sentLineIndex]: { timestamp, number } }));
    }

    chunkIndexRef.current++;
    if (chunkIndexRef.current >= chunks.length) {
      chunkIndexRef.current = 0;
      repetitionRef.current++;
    }

    if (stopRef.current) return;

    if (repetitionRef.current >= countRef.current) {
      resetExecution();
      return;
    }

    const currentInterval = intervalValueRef.current;
    if (currentInterval > 0) {
      intervalRef.current = setTimeout(runNext, currentInterval);
    } else {
      intervalRef.current = setTimeout(runNext, 0);
    }
  }, [resetExecution]);

  const parseChunks = useCallback((): { chunks: string[]; chunkToLineIndex: number[] } => {
    if (!input.trim()) {
      return { chunks: [], chunkToLineIndex: [] };
    }

    if (splitMode === "line") {
      const lines = input.split("\n");
      const chunks: string[] = [];
      const chunkToLineIndex: number[] = [];
      lines.forEach((line, lineIndex) => {
        if (line.length > 0) {
          chunks.push(line);
          chunkToLineIndex.push(lineIndex);
        }
      });
      return { chunks, chunkToLineIndex };
    }

    return { chunks: input.split("").filter((c) => c.length > 0), chunkToLineIndex: [] };
  }, [input, splitMode]);

  const startExecution = useCallback(() => {
    const { chunks, chunkToLineIndex } = parseChunks();
    if (chunks.length === 0) return;

    const sessionIds = getTargetSessionsRef.current();
    if (sessionIds.length === 0) return;

    chunksRef.current = chunks;
    chunkToLineIndexRef.current = chunkToLineIndex;
    chunkIndexRef.current = 0;
    repetitionRef.current = 0;
    stopRef.current = false;

    setRunState("running");
    runNext();
  }, [parseChunks, runNext]);

  const handleContinue = useCallback(() => {
    if (runState !== "paused" || isContinuingRef.current) return;
    isContinuingRef.current = true;

    const chunks = chunksRef.current;
    const chunkIndex = chunkIndexRef.current;

    if (chunkIndex >= chunks.length || chunks.length === 0) {
      resetExecution();
      return;
    }

    const chunk = chunks[chunkIndex];
    const dataToSend = splitModeRef.current === "line" ? chunk + "\r\n" : chunk;

    const sessionIds = getTargetSessionsRef.current();
    sessionIds.forEach((id) => {
      writeSessionRef.current(id, dataToSend).catch(console.error);
    });

    if (splitModeRef.current === "line" && chunkToLineIndexRef.current.length > 0) {
      const sentLineIndex = chunkToLineIndexRef.current[chunkIndex];
      lineCounterRef.current += 1;
      const number = lineCounterRef.current;
      const timestamp = formatTimestamp(new Date());
      setLineMeta((prev) => ({ ...prev, [sentLineIndex]: { timestamp, number } }));
    }

    chunkIndexRef.current++;
    if (chunkIndexRef.current >= chunks.length) {
      chunkIndexRef.current = 0;
      repetitionRef.current++;
    }

    if (repetitionRef.current >= countRef.current) {
      resetExecution();
      return;
    }

    setRunState("running");
    stopRef.current = false;

    isContinuingRef.current = false;

    if (intervalValueRef.current > 0) {
      intervalRef.current = setTimeout(runNext, intervalValueRef.current);
    } else {
      intervalRef.current = setTimeout(runNext, 0);
    }
  }, [count, resetExecution, runNext, runState]);

  const handleStop = useCallback(() => {
    if (runState === "running" || runState === "paused") {
      isContinuingRef.current = false;
      resetExecution();
    }
  }, [resetExecution, runState]);

  const handlePlay = useCallback(() => {
    if (runState === "running") return;
    if (runState === "paused") {
      handleContinue();
      return;
    }
    startExecution();
  }, [handleContinue, runState, startExecution]);

  const toggleBreakpoint = useCallback((lineIndex: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(lineIndex)) {
        next.delete(lineIndex);
      } else {
        next.add(lineIndex);
      }
      return next;
    });
  }, []);

  const markIntervalUserSet = useCallback(() => {
    hasUserSetIntervalRef.current = true;
    setIntervalUserSet(true);
  }, []);

  const getActiveLineIndex = useCallback((): number | null => {
    const idx = chunkIndexRef.current;
    if (idx < 0 || idx >= chunkToLineIndexRef.current.length) return null;
    return chunkToLineIndexRef.current[idx];
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    runState,
    breakpoints,
    setBreakpoints,
    lineMeta,
    toggleBreakpoint,
    handlePlay,
    handleStop,
    markIntervalUserSet,
    intervalUserSet,
    getActiveLineIndex,
  };
}