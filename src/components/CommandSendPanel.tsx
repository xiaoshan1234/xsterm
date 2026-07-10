import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";
import { Session } from "../types/session";
import { useDragResize } from "../hooks/useDragResize";
import "./CommandSendPanel.css";

interface CommandSendPanelProps {
  sessions: Session[];
  activeSessionId: number | null;
  writeSession: (id: number, data: string) => Promise<void>;
  style?: CSSProperties;
  onHeightChange?: (height: number) => void;
}

type SendMode = "text" | "hex";
type SplitMode = "line" | "character";
type TargetMode = "current" | "all" | number;
type RunState = "idle" | "running" | "paused";

export default function CommandSendPanel({
  sessions,
  activeSessionId,
  writeSession,
  style,
  onHeightChange,
}: CommandSendPanelProps) {
  const [input, setInput] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("text");
  const [splitMode, setSplitMode] = useState<SplitMode>("line");
  const [count, setCount] = useState(1);
  const [interval, setIntervalSec] = useState(1.0);
  const [target, setTarget] = useState<TargetMode>("current");
  const [runState, setRunState] = useState<RunState>("idle");
  const [hexError, setHexError] = useState<string | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  const stopRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const chunkIndexRef = useRef(0);
  const repetitionRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const chunkToLineIndexRef = useRef<number[]>([]);

  const getTargetSessions = useCallback((): number[] => {
    if (target === "current") {
      return activeSessionId !== null ? [activeSessionId] : [];
    }
    if (target === "all") {
      return sessions.filter((s) => s.is_connected).map((s) => s.id);
    }
    return [target as number];
  }, [target, activeSessionId, sessions]);

  const breakpointsRef = useRef(breakpoints);
  const countRef = useRef(count);
  const intervalValueRef = useRef(interval);
  const sendModeRef = useRef(sendMode);
  const splitModeRef = useRef(splitMode);
  const writeSessionRef = useRef(writeSession);
  const getTargetSessionsRef = useRef(getTargetSessions);

  const initialHeight = typeof style?.height === "number" ? style.height : 160;

  const { start } = useDragResize({
    direction: "vertical",
    onDelta: ({ delta, initialValue }) => {
      onHeightChange?.(initialValue + delta);
    },
  });

  useEffect(() => {
    breakpointsRef.current = breakpoints;
    countRef.current = count;
    intervalValueRef.current = interval;
    sendModeRef.current = sendMode;
    splitModeRef.current = splitMode;
    writeSessionRef.current = writeSession;
    getTargetSessionsRef.current = getTargetSessions;
  });

  const parseChunks = useCallback((): { chunks: string[]; chunkToLineIndex: number[] } => {
    setHexError(null);

    if (!input.trim()) {
      return { chunks: [], chunkToLineIndex: [] };
    }

    if (sendMode === "hex") {
      const hexStr = input.replace(/\s+/g, "");
      if (hexStr.length % 2 !== 0) {
        setHexError("Hex input must have even number of characters");
        return { chunks: [], chunkToLineIndex: [] };
      }
      const validHex = /^[0-9a-fA-F]*$/;
      if (!validHex.test(hexStr)) {
        setHexError("Invalid hex characters detected");
        return { chunks: [], chunkToLineIndex: [] };
      }
      const chunks: string[] = [];
      for (let i = 0; i < hexStr.length; i += 2) {
        const byte = parseInt(hexStr.substring(i, i + 2), 16);
        chunks.push(String.fromCharCode(byte));
      }
      return { chunks, chunkToLineIndex: [] };
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
  }, [input, sendMode, splitMode]);

  const currentLineIndex = useCallback((): number | null => {
    const idx = chunkIndexRef.current;
    if (idx < 0 || idx >= chunkToLineIndexRef.current.length) return null;
    return chunkToLineIndexRef.current[idx];
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resetExecution = useCallback(() => {
    clearTimer();
    stopRef.current = true;
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

    const dataToSend =
      sendModeRef.current === "text" && splitModeRef.current === "line" ? chunk + "\r\n" : chunk;

    const sessionIds = getTargetSessionsRef.current();
    sessionIds.forEach((id) => {
      writeSessionRef.current(id, dataToSend).catch(console.error);
    });

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
      intervalRef.current = setTimeout(runNext, currentInterval * 1000);
    } else {
      intervalRef.current = setTimeout(runNext, 0);
    }
  }, [resetExecution]);

  const startExecution = useCallback(() => {
    const { chunks, chunkToLineIndex } = parseChunks();
    if (chunks.length === 0) return;

    const sessionIds = getTargetSessions();
    if (sessionIds.length === 0) return;

    chunksRef.current = chunks;
    chunkToLineIndexRef.current = chunkToLineIndex;
    chunkIndexRef.current = 0;
    repetitionRef.current = 0;
    stopRef.current = false;

    setRunState("running");
    runNext();
  }, [parseChunks, getTargetSessions, runNext]);

  const handleSend = useCallback(() => {
    resetExecution();
    startExecution();
  }, [resetExecution, startExecution]);

  const handleStop = useCallback(() => {
    resetExecution();
  }, [resetExecution]);

  const handlePlay = useCallback(() => {
    resetExecution();
    startExecution();
  }, [resetExecution, startExecution]);

  const handleContinue = useCallback(() => {
    if (runState !== "paused") return;

    const chunks = chunksRef.current;
    const chunkIndex = chunkIndexRef.current;

    if (chunkIndex >= chunks.length || chunks.length === 0) {
      resetExecution();
      return;
    }

    const chunk = chunks[chunkIndex];
    const dataToSend =
      sendMode === "text" && splitMode === "line" ? chunk + "\r\n" : chunk;

    const sessionIds = getTargetSessions();
    sessionIds.forEach((id) => {
      writeSession(id, dataToSend).catch(console.error);
    });

    chunkIndexRef.current++;
    if (chunkIndexRef.current >= chunks.length) {
      chunkIndexRef.current = 0;
      repetitionRef.current++;
    }

    if (repetitionRef.current >= count) {
      resetExecution();
      return;
    }

    setRunState("running");
    stopRef.current = false;

    if (interval > 0) {
      intervalRef.current = setTimeout(runNext, interval * 1000);
    } else {
      intervalRef.current = setTimeout(runNext, 0);
    }
  }, [count, getTargetSessions, interval, resetExecution, runNext, runState, sendMode, splitMode, writeSession]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const adjustCount = (delta: number) => {
    setCount((prev) => Math.max(1, prev + delta));
  };

  const toggleBreakpoint = (lineIndex: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(lineIndex)) {
        next.delete(lineIndex);
      } else {
        next.add(lineIndex);
      }
      return next;
    });
  };

  const lines = input.split("\n");
  const activeLineIndex = currentLineIndex();

  const renderGutter = () => {
    return (
      <div className="panel-gutter" ref={gutterRef}>
          {lines.map((_, lineIndex) => {
            const hasBreakpoint = breakpoints.has(lineIndex);
            const isActive = activeLineIndex === lineIndex && runState !== "idle";
            return (
              <div
                key={lineIndex}
                className={`panel-gutter-line ${isActive ? "panel-gutter-line--active" : ""}`}
                onClick={() => toggleBreakpoint(lineIndex)}
                title={hasBreakpoint ? "Remove breakpoint" : "Add breakpoint"}
              >
              <span className="panel-breakpoint">
                {hasBreakpoint ? "●" : ""}
              </span>
              <span className="panel-line-number">{lineIndex + 1}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="command-send-panel" style={style}>
      <div
        className="panel-resize-handle"
        onMouseDown={(e) => start(initialHeight, e)}
      />
      <div className="panel-row panel-controls">
        <div className="control-group">
          <button className="btn btn--primary panel-send" onClick={handleSend}>
            Send
          </button>
          {runState === "running" ? (
            <button className="btn btn--secondary" onClick={handleStop}>
              ■
            </button>
          ) : runState === "paused" ? (
            <button className="btn btn--secondary panel-continue" onClick={handleContinue}>
              Continue
            </button>
          ) : (
            <button className="btn btn--secondary" onClick={handlePlay}>
              ▶
            </button>
          )}
          <button className="btn btn--secondary" onClick={() => adjustCount(1)}>
            +
          </button>
          <button className="btn btn--secondary" onClick={() => adjustCount(-1)}>
            −
          </button>
        </div>

        <div className="control-group">
          <label className="radio-label">
            <input
              type="radio"
              name="sendMode"
              checked={sendMode === "text"}
              onChange={() => setSendMode("text")}
            />
            <span>Text</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="sendMode"
              checked={sendMode === "hex"}
              onChange={() => setSendMode("hex")}
            />
            <span>Hex</span>
          </label>
        </div>

        <div className="control-group">
          <label className="radio-label">
            <input
              type="radio"
              name="splitMode"
              checked={splitMode === "line"}
              onChange={() => setSplitMode("line")}
            />
            <span>Line</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="splitMode"
              checked={splitMode === "character"}
              onChange={() => setSplitMode("character")}
            />
            <span>Char</span>
          </label>
        </div>

        <div className="control-group form-field">
          <label className="input-label">
            <span>Count</span>
            <input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </label>
        </div>

        <div className="control-group form-field">
          <label className="input-label">
            <span>Interval</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={interval}
              onChange={(e) => setIntervalSec(Math.max(0, parseFloat(e.target.value) || 0))}
            />
            <span className="unit">s</span>
          </label>
        </div>

        <div className="control-group form-field">
          <label className="input-label">
            <span>Target</span>
            <select
              value={
                target === "current"
                  ? "current"
                  : target === "all"
                  ? "all"
                  : String(target)
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "current") setTarget("current");
                else if (val === "all") setTarget("all");
                else setTarget(parseInt(val));
              }}
            >
              <option value="current">Current</option>
              <option value="all">All</option>
              {sessions.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {hexError && <span className="hex-error">{hexError}</span>}
      </div>

      <div className="panel-row panel-editor">
        {renderGutter()}
        <textarea
          ref={textareaRef}
          className="panel-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter command or Hex data, click line number to set breakpoint..."
          spellCheck={false}
          rows={Math.max(lines.length, 1)}
        />
      </div>
    </div>
  );
}
