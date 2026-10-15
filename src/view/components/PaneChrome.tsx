import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "../../adapter/xterm/xterm";
import TerminalView from "../../adapter/xterm/TerminalView";
import { useContainerFit } from "../../adapter/xterm/useContainerFit";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { usePaneTreeContext } from "../hooks/paneTreeContext";
import { ContextMenuOverlay, useContextMenu, type ContextMenuItem } from "./primitives/ContextMenu";
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

async function copySelection(xterm: Terminal | null): Promise<void> {
  if (!xterm) return;
  const selection = xterm.getSelection();
  if (!selection) return;
  try {
    await navigator.clipboard.writeText(selection);
  } catch (err) {
    console.error("clipboard write failed:", err);
  }
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
  const { state, open, close } = useContextMenu();

  const handleTermReady = useCallback((term: Terminal) => {
    setXterm(term);
  }, []);

  const handleExit = useCallback(() => {
    markDead(tabId, leaf.sessionId);
  }, [markDead, tabId, leaf.sessionId]);

  useTerminalSession({
    sessionId: leaf.sessionId,
    xterm,
    onExit: handleExit,
  });

  useContainerFit(xterm, wrapperRef);

  useEffect(() => {
    if (xterm && focused) {
      xterm.focus();
    }
  }, [xterm, focused]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY);
    },
    [open],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
      { label: "Split Horizontal", onClick: () => onSplitH() },
      { label: "Split Vertical", onClick: () => onSplitV() },
      { separator: true },
      {
        label: "Copy",
        onClick: () => void copySelection(xterm),
        disabled: !xterm,
      },
      {
        label: "Clear Pane",
        onClick: () => xterm?.clear(),
        disabled: !xterm,
      },
    ];
    if (leaf.status === "dead") {
      items.push({
        label: "Reconnect",
        onClick: () => void reconnectLeaf(tabId, leaf.sessionId),
      });
    }
    items.push({ separator: true });
    items.push({ label: "Close Pane", onClick: onClose, danger: true });
    return items;
  }, [xterm, leaf.status, leaf.sessionId, onSplitH, onSplitV, onClose, reconnectLeaf, tabId]);

  const className = focused ? "paneChrome paneChromeFocused" : "paneChrome";

  return (
    <>
      <div
        ref={wrapperRef}
        className={className}
        onMouseDown={onFocus}
        onContextMenu={handleContextMenu}
      >
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
      </div>
      <ContextMenuOverlay state={state} close={close} items={menuItems} containerRef={wrapperRef} />
    </>
  );
}
