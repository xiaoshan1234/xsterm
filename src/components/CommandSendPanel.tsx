import { useEffect, useState, type CSSProperties } from "react";
import { Session, Workspace } from "../types/session";
import { useDragResize } from "../hooks/useDragResize";
import { getDefaultPaneId, useCommandTargets } from "./useCommandTargets";
import { useCommandExecutor } from "./useCommandExecutor";
import "./CommandSendPanel.css";

interface CommandSendPanelProps {
  workspace: Workspace;
  sessions: Session[];
  writeSession: (id: number, data: string) => Promise<void>;
  style?: CSSProperties;
  onHeightChange?: (height: number) => void;
}

type SplitMode = "line" | "character";

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

  const targets = useCommandTargets(workspace);
  const executor = useCommandExecutor({
    input,
    splitMode,
    count,
    intervalMs,
    writeSession,
    getTargetSessions: targets.getTargetSessions,
  });

  const initialHeight = typeof style?.height === "number" ? style.height : 160;
  const { start } = useDragResize({
    direction: "vertical",
    onDelta: ({ delta, initialValue }) => {
      onHeightChange?.(initialValue - delta);
    },
  });

  useEffect(() => {
    if (!executor.intervalUserSet) {
      setIntervalMs(splitMode === "line" ? 1000 : 20);
    }
  }, [splitMode, executor.intervalUserSet]);

  const adjustCount = (delta: number) => {
    setCount((prev) => Math.max(1, prev + delta));
  };

  const lines = input.split("\n");
  const activeLineIndex = executor.getActiveLineIndex();

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
            onClick={executor.handlePlay}
            disabled={executor.runState === "running"}
            title={executor.runState === "paused" ? "Continue" : "Play"}
          >
            ▶
          </button>
          <button
            className={`btn btn--secondary ${executor.runState !== "idle" ? "panel-stop--running" : ""}`}
            onClick={executor.handleStop}
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
                executor.markIntervalUserSet();
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
              value={targets.targetWindowId}
              onChange={(e) => {
                const newWindowId = e.target.value;
                targets.setTargetWindowId(newWindowId);
                if (newWindowId === "active") {
                  targets.setTargetPaneId("active");
                } else {
                  const newWindow = workspace.windows.find((w) => w.id === newWindowId);
                  targets.setTargetPaneId(newWindow ? getDefaultPaneId(newWindow) : null);
                }
              }}
            >
              <option value="active">Active</option>
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
              value={targets.targetPaneId ?? ""}
              onChange={(e) => targets.setTargetPaneId(e.target.value || null)}
            >
              <option value="active">Active</option>
              {targets.paneOptions.map(({ pane, number }) => {
                const session = sessions.find((s) => s.id === pane.sessionId);
                return (
                  <option key={pane.id} value={pane.id}>
                    #{number} {session?.name ?? pane.id}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      </div>

      <div className="panel-row panel-editor">
        <div className="panel-gutter">
          {lines.map((_, lineIndex) => {
            const hasBreakpoint = executor.breakpoints.has(lineIndex);
            const isActive = activeLineIndex === lineIndex && executor.runState !== "idle";
            const meta = executor.lineMeta[lineIndex];
            const displayNumber = meta ? meta.number : lineIndex + 1;
            const displayTimestamp = meta ? meta.timestamp : "";
            return (
              <div
                key={lineIndex}
                className={`panel-gutter-line ${isActive ? "panel-gutter-line--active" : ""}`}
                onClick={() => executor.toggleBreakpoint(lineIndex)}
                title={hasBreakpoint ? "Remove breakpoint" : "Add breakpoint"}
              >
                <span className="panel-timestamp">{displayTimestamp ? `[${displayTimestamp}]` : ""}</span>
                <span className="panel-breakpoint">{hasBreakpoint ? "●" : ""}</span>
                <span className="panel-line-number">{displayNumber}</span>
              </div>
            );
          })}
        </div>
        <textarea
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