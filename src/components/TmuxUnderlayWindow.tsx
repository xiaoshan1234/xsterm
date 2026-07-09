import { TmuxUnderlayStatus } from "../types/tmux";
import "./TmuxUnderlayWindow.css";

interface TmuxUnderlayWindowProps {
  sessionId: number;
  targetSession: string;
  status: TmuxUnderlayStatus;
  error?: string;
  onConnect: (name: string) => void;
  onDisconnect: () => void;
}

function statusLabel(status: TmuxUnderlayStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected";
    case "error":
      return "Error";
    case "disconnected":
      return "Disconnected";
  }
}

export function TmuxUnderlayWindow({
  targetSession,
  status,
  error,
  onConnect,
  onDisconnect,
}: TmuxUnderlayWindowProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="tmux-underlay-window">
      <div className="tmux-underlay-card">
        <div className="tmux-underlay-row">
          <span className="tmux-underlay-label">Status</span>
          <span className={`tmux-underlay-status tmux-underlay-status--${status}`}>
            {statusLabel(status)}
          </span>
        </div>
        <div className="tmux-underlay-row">
          <span className="tmux-underlay-label">Target session</span>
          <span className="tmux-underlay-target">{targetSession}</span>
        </div>
        {error && (
          <div className="tmux-underlay-row">
            <span className="tmux-underlay-label">Error</span>
            <span className="tmux-underlay-error">{error}</span>
          </div>
        )}
        <div className="tmux-underlay-actions">
          <button
            className="btn btn--primary"
            onClick={() => onConnect(targetSession)}
            disabled={isConnected || isConnecting}
          >
            Connect
          </button>
          <button
            className="btn btn--secondary"
            onClick={onDisconnect}
            disabled={!isConnected && status !== "connecting"}
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
