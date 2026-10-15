import { useCallback, useRef, useState } from "react";
import type { Terminal } from "../../adapter/xterm/xterm";
import TerminalView from "../../adapter/xterm/TerminalView";
import { useContainerFit } from "../../adapter/xterm/useContainerFit";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { usePaneTreeContext } from "../hooks/paneTreeContext";
import type { PanePath } from "../../data/model/pane";
import type { SessionId } from "../../data/model/session";
import "./PaneChrome.css";

interface PaneChromeProps {
  tabId: number;
  path: PanePath;
  focused: boolean;
  leaf: { kind: "leaf"; sessionId: SessionId; shell: string; status: "alive" | "dead" };
  paneNumber: number;
  onFocus: () => void;
  onSplitH: () => void;
  onSplitV: () => void;
  onClose: () => void;
}

export default function PaneChrome({
  tabId,
  focused,
  leaf,
  paneNumber,
  onFocus,
  onSplitH,
  onSplitV,
  onClose,
}: PaneChromeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [xterm, setXterm] = useState<Terminal | null>(null);
  const { markDead, reconnectLeaf } = usePaneTreeContext();

  const handleTermReady = useCallback((term: Terminal) => {
    setXterm(term);
  }, []);

  const handleExit = useCallback(() => {
    markDead(tabId, leaf.sessionId);
  }, [markDead, tabId, leaf.sessionId]);

  useTerminalSession({
    sessionId: leaf.sessionId,
    onExit: handleExit,
  });

  useContainerFit(xterm, wrapperRef);

  const className = focused ? "paneChrome paneChromeFocused" : "paneChrome";

  return (
    <div ref={wrapperRef} className={className} onMouseDown={onFocus}>
      <div className="paneChromeBadge" aria-label={`Pane ${paneNumber}`}>
        {paneNumber}
      </div>
      {leaf.status === "dead" ? (
        <div className="paneChromeBanner">
          <span className="paneChromeBannerLabel">Process exited</span>
          <button
            className="paneChromeBtn paneChromeBtnAccent"
            type="button"
            onClick={() => void reconnectLeaf(tabId, leaf.sessionId)}
          >
            Reconnect
          </button>
          <button className="paneChromeBtn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
      <div className="paneChromeXterm">
        <TerminalView onTermReady={handleTermReady} />
      </div>
      <div className="paneChromeToolbar">
        <button className="paneChromeBtn" type="button" onClick={onSplitH}>
          Split H
        </button>
        <button className="paneChromeBtn" type="button" onClick={onSplitV}>
          Split V
        </button>
        <button className="paneChromeBtn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
