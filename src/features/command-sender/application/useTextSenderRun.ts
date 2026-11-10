import { useCallback, useEffect, useRef, useState } from "react";
import { getSenderIntervalMs } from "../viewModels/textSenderViewModel";

export type TextSenderRunStatus =
  "idle" | "sending" | "paused" | "completed" | "cancelled" | "error";

interface ActiveTextSenderRun {
  isCancelled: boolean;
  isPaused: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  wakeTimeout: (() => void) | null;
  pauseWaiters: (() => void)[];
}

export interface TextSenderRunController {
  status: TextSenderRunStatus;
  sentUnits: number;
  totalUnits: number;
  errorMessage: string | null;
  start: (chunks: readonly string[], rate: number) => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  resetFeedback: () => void;
}

export function useTextSenderRun(
  onWrite: (text: string) => Promise<void>,
): TextSenderRunController {
  const [status, setStatus] = useState<TextSenderRunStatus>("idle");
  const [sentUnits, setSentUnits] = useState(0);
  const [totalUnits, setTotalUnits] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeRunRef = useRef<ActiveTextSenderRun | null>(null);
  const onWriteRef = useRef(onWrite);

  useEffect(() => {
    onWriteRef.current = onWrite;
  }, [onWrite]);

  useEffect(
    () => () => {
      const run = activeRunRef.current;
      if (!run) return;
      run.isCancelled = true;
      releaseWaiters(run);
    },
    [],
  );

  const start = useCallback((chunks: readonly string[], rate: number) => {
    if (chunks.length === 0) return;

    const previousRun = activeRunRef.current;
    if (previousRun) {
      previousRun.isCancelled = true;
      releaseWaiters(previousRun);
    }

    const run: ActiveTextSenderRun = {
      isCancelled: false,
      isPaused: false,
      timeoutId: null,
      wakeTimeout: null,
      pauseWaiters: [],
    };
    const writeChunk = onWriteRef.current;
    const intervalMs = getSenderIntervalMs(rate);

    activeRunRef.current = run;
    setStatus("sending");
    setSentUnits(0);
    setTotalUnits(chunks.length);
    setErrorMessage(null);

    void (async () => {
      for (let index = 0; index < chunks.length; index += 1) {
        await waitWhilePaused(run);
        if (run.isCancelled) return;

        try {
          await writeChunk(chunks[index]);
        } catch (error) {
          if (run.isCancelled) return;
          activeRunRef.current = null;
          setErrorMessage(error instanceof Error ? error.message : String(error));
          setStatus("error");
          return;
        }

        if (run.isCancelled) return;
        setSentUnits(index + 1);

        if (index < chunks.length - 1) {
          await waitWhilePaused(run);
          if (run.isCancelled) return;
          await waitForInterval(run, intervalMs);
        }
      }

      if (run.isCancelled) return;
      activeRunRef.current = null;
      setStatus("completed");
    })();
  }, []);

  const pause = useCallback(() => {
    const run = activeRunRef.current;
    if (!run || run.isCancelled || run.isPaused) return;
    run.isPaused = true;
    releaseWaiters(run);
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const run = activeRunRef.current;
    if (!run || run.isCancelled || !run.isPaused) return;
    run.isPaused = false;
    wakePauseWaiters(run);
    setStatus("sending");
  }, []);

  const cancel = useCallback(() => {
    const run = activeRunRef.current;
    if (!run) return;
    run.isCancelled = true;
    releaseWaiters(run);
    activeRunRef.current = null;
    setStatus("cancelled");
  }, []);

  const resetFeedback = useCallback(() => {
    if (activeRunRef.current) return;
    setStatus("idle");
    setSentUnits(0);
    setTotalUnits(0);
    setErrorMessage(null);
  }, []);

  return {
    status,
    sentUnits,
    totalUnits,
    errorMessage,
    start,
    pause,
    resume,
    cancel,
    resetFeedback,
  };
}

function waitWhilePaused(run: ActiveTextSenderRun): Promise<void> {
  if (!run.isPaused || run.isCancelled) return Promise.resolve();
  return new Promise((resolve) => {
    run.pauseWaiters.push(resolve);
  });
}

function waitForInterval(run: ActiveTextSenderRun, intervalMs: number): Promise<void> {
  if (run.isCancelled || intervalMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    run.wakeTimeout = resolve;
    run.timeoutId = setTimeout(() => {
      run.timeoutId = null;
      run.wakeTimeout = null;
      resolve();
    }, intervalMs);
  });
}

function releaseWaiters(run: ActiveTextSenderRun): void {
  if (run.timeoutId !== null) {
    clearTimeout(run.timeoutId);
    run.timeoutId = null;
  }
  run.wakeTimeout?.();
  run.wakeTimeout = null;
  wakePauseWaiters(run);
}

function wakePauseWaiters(run: ActiveTextSenderRun): void {
  const waiters = run.pauseWaiters.splice(0);
  waiters.forEach((resolve) => resolve());
}
