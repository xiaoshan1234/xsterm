import { useState, useRef, useEffect } from "react";
import { LogLevel, LogEntry } from "../types/log";

interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export default function LogViewer({ logs, onClear }: LogViewerProps) {
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = logs.filter((log) => {
    if (filter !== "all" && log.level !== filter) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case LogLevel.DEBUG: return "#888";
      case LogLevel.INFO: return "#4fc3f7";
      case LogLevel.WARN: return "#ffb74d";
      case LogLevel.ERROR: return "#ef5350";
    }
  };

  return (
    <div className="log-viewer">
      <div className="log-header">
        <span>Logs ({filtered.length})</span>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <button onClick={onClear}>Clear</button>
      </div>
      <div className="log-content">
        {filtered.map((log) => (
          <div key={log.id} className="log-entry" style={{ borderLeftColor: getLevelColor(log.level) }}>
            <span className="log-time">
              {log.timestamp.toLocaleTimeString()}
            </span>
            <span className="log-level" style={{ color: getLevelColor(log.level) }}>
              [{log.level.toUpperCase()}]
            </span>
            <span className="log-source">[{log.source}]</span>
            <span className="log-message">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
