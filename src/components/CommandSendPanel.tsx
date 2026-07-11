import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";
import { Session, Workspace, PaneNode, Window } from "../types/session";
import { useDragResize } from "../hooks/useDragResize";
import { forEachPane, findPaneNode, findFirstLeafWithSession } from "../contexts/session/paneUtils";
import "./CommandSendPanel.css";

interface CommandSendPanelProps {
  workspace: Workspace;
  sessions: Session[];
  writeSession: (id: number, data: string) => Promise<void>;
  style?: CSSProperties;
  onHeightChange?: (height: number) => void;
}

type SplitMode = "line" | "character";
type RunState = "idle" | "running" | "paused";

function getLeafPanesWithSession(root: PaneNode): PaneNode[] {
  const panes: PaneNode[] = [];
  forEachPane(root, (node) => {
    if (node.type === "leaf" && node.sessionId !== undefined) {
      panes.push(node);
    }
  });
  return panes;
}

function getDefaultPaneId(window: Window): string | null {
  if (window.activePaneId) {
    const pane = findPaneNode(window.rootPane, window.activePaneId);
    if (pane?.type === "leaf" && pane.sessionId !== undefined) {
      return pane.id;
    }
  }
  return findFirstLeafWithSession(window.rootPane)?.id ?? null;
}

function getFallbackSelection(workspace: Workspace): { windowId: string; paneId: string | null } {
  const windowsWithTargets = workspace.windows.filter(
    (w) => getLeafPanesWithSession(w.rootPane).length > 0
  );
  if (windowsWithTargets.length === 0) {
    return { windowId: "", paneId: null };
  }
  const activeWindow = windowsWithTargets.find((w) => w.id === workspace.activeWindowId);
  if (activeWindow) {
    return { windowId: activeWindow.id, paneId: getDefaultPaneId(activeWindow) };
  }
  const firstWindow = windowsWithTargets[0];
  return { windowId: firstWindow.id, paneId: getDefaultPaneId(firstWindow) };
}

export default function CommandSendPanel({
  workspace,
  sessions,
  writeSession,
  style,
  onHeightChange,
}: CommandSendPanelProps) {
  const [input, setInput] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("line");
  const [count, setCount] = useState(1);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [targetWindowId, setTargetWindowId] = useState<string>(() => getFallbackSelection(workspace).windowId);
  const [targetPaneId, setTargetPaneId] = useState<string | null>(() => getFallbackSelection(workspace).paneId);
  const [runState, setRunState] = useState<RunState>("idle");
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  const stopRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const chunkIndexRef = useRef(0);
  const repetitionRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const chunkToLineIndexRef = useRef<number[]>([]);
  const hasUserSetIntervalRef = useRef(false);
  const isContinuingRef = useRef(false);

  const getTargetSessions = useCallback((): number[] => {
    const selectedWindow = workspace.windows.find((w) => w.id === targetWindowId);
    if (!selectedWindow) return [];
    const pane = targetPaneId ? findPaneNode(selectedWindow.rootPane, targetPaneId) : null;
    if (pane && pane.type === "leaf" && pane.sessionId !== undefined) {
      return [pane.sessionId];
    }
    return [];
  }, [workspace, targetWindowId, targetPaneId]);

  const breakpointsRef = useRef(breakpoints);
  const countRef = useRef(count);
  const intervalValueRef = useRef(intervalMs);
  const splitModeRef = useRef(splitMode);
  const writeSessionRef = useRef(writeSession);
  const getTargetSessionsRef = useRef(getTargetSessions);

  const initialHeight = typeof style?.height === "number" ? style.height : 160;

  const { start } = useDragResize({
    direction: "vertical",
    onDelta: ({ delta, initialValue }) => {
      onHeightChange?.(initialValue - delta);
    },
  });

  useEffect(() => {
    breakpointsRef.current = breakpoints;
    countRef.current = count;
    intervalValueRef.current = intervalMs;
    splitModeRef.current = splitMode;
    writeSessionRef.current = writeSession;
    getTargetSessionsRef.current = getTargetSessions;
  });

  useEffect(() => {
    const selectedWindow = workspace.windows.find((w) => w.id === targetWindowId);
    if (!selectedWindow) {
      const { windowId, paneId } = getFallbackSelection(workspace);
      setTargetWindowId(windowId);
      setTargetPaneId(paneId);
      return;
    }
    const panes = getLeafPanesWithSession(selectedWindow.rootPane);
    if (panes.length === 0) {
      const { windowId, paneId } = getFallbackSelection(workspace);
      setTargetWindowId(windowId);
      setTargetPaneId(paneId);
      return;
    }
    const paneExists = panes.some((p) => p.id === targetPaneId);
    if (!paneExists) {
      setTargetPaneId(getDefaultPaneId(selectedWindow));
    }
  }, [workspace, targetWindowId, targetPaneId]);

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
    const dataToSend = splitMode === "line" ? chunk + "\r\n" : chunk;

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

    isContinuingRef.current = false;

    if (intervalMs > 0) {
      intervalRef.current = setTimeout(runNext, intervalMs);
    } else {
      intervalRef.current = setTimeout(runNext, 0);
    }
  }, [count, getTargetSessions, intervalMs, resetExecution, runNext, runState, splitMode, writeSession]);

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

  useEffect(() => {
    if (!hasUserSetIntervalRef.current) {
      setIntervalMs(splitMode === "line" ? 1000 : 20);
    }
  }, [splitMode]);

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

  const selectedWindow = workspace.windows.find((w) => w.id === targetWindowId);
  const paneOptions = selectedWindow ? getLeafPanesWithSession(selectedWindow.rootPane) : [];

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
    <div
      className="command-send-panel"
      style={style}
      onMouseDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientY - rect.top <= 6) {
          start(initialHeight, e);
        }
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.cursor = e.clientY - rect.top <= 6 ? "ns-resize" : "";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.cursor = "";
      }}
    >
      <div className="panel-row panel-controls">
        <div className="control-group">
          <button
            className="btn btn--secondary"
            onClick={handlePlay}
            disabled={runState === "running"}
            title={runState === "paused" ? "Continue" : "Play"}
          >
            ▶
          </button>
          <button
            className={`btn btn--secondary ${runState !== "idle" ? "panel-stop--running" : ""}`}
            onClick={handleStop}
            title="Stop"
          >
            ■
          </button>
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
              step={1}
              value={intervalMs}
              onChange={(e) => {
                hasUserSetIntervalRef.current = true;
                setIntervalMs(Math.max(0, parseInt(e.target.value) || 0));
              }}
            />
            <span className="unit">ms</span>
          </label>
        </div>

        <div className="control-group form-field">
          <label className="input-label">
            <span>Window</span>
            <select
              value={targetWindowId}
              onChange={(e) => {
                const newWindowId = e.target.value;
                setTargetWindowId(newWindowId);
                const newWindow = workspace.windows.find((w) => w.id === newWindowId);
                setTargetPaneId(newWindow ? getDefaultPaneId(newWindow) : null);
              }}
            >
              {workspace.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="control-group form-field">
          <label className="input-label">
            <span>Pane</span>
            <select
              value={targetPaneId ?? ""}
              onChange={(e) => setTargetPaneId(e.target.value || null)}
            >
              {paneOptions.map((pane) => {
                const session = sessions.find((s) => s.id === pane.sessionId);
                return (
                  <option key={pane.id} value={pane.id}>
                    {session?.name ?? pane.id}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      </div>

      <div className="panel-row panel-editor">
        {renderGutter()}
        <textarea
          ref={textareaRef}
          className="panel-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter command data, click line number to set breakpoint..."
          spellCheck={false}
          rows={Math.max(lines.length, 1)}
        />
      </div>
    </div>
  );
}
