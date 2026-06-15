import { useState, useRef, useCallback, useEffect } from "react";
import { Session } from "../types/session";
import "./CommandSendPanel.css";

interface CommandSendPanelProps {
  sessions: Session[];
  activeSessionId: number | null;
  writeSession: (id: number, data: string) => Promise<void>;
  style?: React.CSSProperties;
}

type SendMode = "text" | "hex";
type SplitMode = "line" | "character";
type TargetMode = "current" | "all" | number;

export default function CommandSendPanel({
  sessions,
  activeSessionId,
  writeSession,
  style,
}: CommandSendPanelProps) {
  const [input, setInput] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("text");
  const [splitMode, setSplitMode] = useState<SplitMode>("line");
  const [count, setCount] = useState(1);
  const [interval, setIntervalSec] = useState(1.0);
  const [target, setTarget] = useState<TargetMode>("current");
  const [isRunning, setIsRunning] = useState(false);
  const [hexError, setHexError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const stopRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getTargetSessions = useCallback((): number[] => {
    if (target === "current") {
      return activeSessionId !== null ? [activeSessionId] : [];
    }
    if (target === "all") {
      return sessions.filter((s) => s.is_connected).map((s) => s.id);
    }
    return [target as number];
  }, [target, activeSessionId, sessions]);

  const parseChunks = useCallback((): string[] => {
    setHexError(null);

    if (!input.trim()) {
      return [];
    }

    if (sendMode === "hex") {
      const hexStr = input.replace(/\s+/g, "");
      if (hexStr.length % 2 !== 0) {
        setHexError("Hex input must have even number of characters");
        return [];
      }
      const validHex = /^[0-9a-fA-F]*$/;
      if (!validHex.test(hexStr)) {
        setHexError("Invalid hex characters detected");
        return [];
      }
      const chunks: string[] = [];
      for (let i = 0; i < hexStr.length; i += 2) {
        const byte = parseInt(hexStr.substring(i, i + 2), 16);
        chunks.push(String.fromCharCode(byte));
      }
      return chunks;
    }

    if (splitMode === "line") {
      const lines = input.split("\n");
      return lines.filter((line) => line.length > 0);
    }

    // split by character
    return input.split("").filter((c) => c.length > 0);
  }, [input, sendMode, splitMode]);

  const sendChunks = useCallback(async () => {
    const chunks = parseChunks();
    if (chunks.length === 0) return;

    const sessionIds = getTargetSessions();
    if (sessionIds.length === 0) return;

    let repetition = 0;
    let chunkIndex = 0;

    stopRef.current = false;

    const runNext = () => {
      if (stopRef.current) return;

      if (repetition >= count) {
        setIsRunning(false);
        return;
      }

      const chunk = chunks[chunkIndex];

      // For line mode in text, append \r\n
      const dataToSend =
        sendMode === "text" && splitMode === "line" ? chunk + "\r\n" : chunk;

      sessionIds.forEach((id) => {
        writeSession(id, dataToSend).catch(console.error);
      });

      chunkIndex++;
      if (chunkIndex >= chunks.length) {
        chunkIndex = 0;
        repetition++;
      }

      if (interval > 0) {
        intervalRef.current = setTimeout(runNext, interval * 1000);
      } else {
        // No interval, run synchronously but still yield to UI
        setTimeout(runNext, 0);
      }
    };

    setIsRunning(true);
    runNext();
  }, [parseChunks, getTargetSessions, count, interval, sendMode, splitMode, writeSession]);

  const handleSend = useCallback(() => {
    stopRef.current = true;
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    sendChunks();
  }, [sendChunks]);

  const handleStop = useCallback(() => {
    stopRef.current = true;
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const handlePlay = useCallback(() => {
    handleStop();
    sendChunks();
  }, [handleStop, sendChunks]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, []);

  const adjustCount = (delta: number) => {
    setCount((prev) => Math.max(1, prev + delta));
  };

  if (collapsed) {
    return (
      <div className="command-send-panel command-send-panel--collapsed" style={style}>
        <button
          className="panel-toggle"
          onClick={() => setCollapsed(false)}
          title="展开"
        >
          ⬇
        </button>
      </div>
    );
  }

  return (
    <div className="command-send-panel" style={style}>
      <div className="panel-row panel-controls">
        <div className="control-group">
          <button className="btn btn--primary panel-send" onClick={handleSend}>
            发送
          </button>
          {isRunning ? (
            <button className="btn btn--secondary" onClick={handleStop}>
              ■
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
            <span>文本(T)</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="sendMode"
              checked={sendMode === "hex"}
              onChange={() => setSendMode("hex")}
            />
            <span>Hex(H)</span>
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
            <span>竖线(L)</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="splitMode"
              checked={splitMode === "character"}
              onChange={() => setSplitMode("character")}
            />
            <span>字符(C)</span>
          </label>
        </div>

        <div className="control-group form-field">
          <label className="input-label">
            <span>计数(C)</span>
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
            <span>间隔(I)</span>
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
            <span>目标(T)</span>
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
              <option value="current">当前会话</option>
              <option value="all">所有会话</option>
              {sessions.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {hexError && <span className="hex-error">{hexError}</span>}

        <button
          className="btn btn--secondary panel-close"
          onClick={() => setCollapsed(true)}
          title="折叠"
        >
          ✕
        </button>
      </div>

      <div className="panel-row panel-editor">
        <textarea
          className="panel-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入命令或 Hex 数据..."
        />
      </div>
    </div>
  );
}
