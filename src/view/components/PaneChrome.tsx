import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Terminal } from "../../adapter/xterm/xterm";
import TerminalView from "../../adapter/xterm/TerminalView";
import { useContainerFit } from "../../adapter/xterm/useContainerFit";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { usePaneTreeContext } from "../hooks/paneTreeContext";
import { ContextMenuOverlay, useContextMenu, type ContextMenuItem } from "./primitives/ContextMenu";
import type { SessionId } from "../../data/model/session";
import "./PaneChrome.css";

interface PaneChromeProps {
  tabId: number;
  sessionId: SessionId;
  focused: boolean;
  paneNumber: number;
  style: CSSProperties;
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
  sessionId,
  focused,
  paneNumber,
  style,
}: PaneChromeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [xterm, setXterm] = useState<Terminal | null>(null);
  const { markDead, reconnectLeaf, splitActivePane, closeLeaf, focusLeaf } = usePaneTreeContext();
  const { state, open, close } = useContextMenu();

  const handleTermReady = useCallback((term: Terminal) => {
    setXterm(term);
  }, []);

  const handleExit = useCallback(() => {
    markDead(tabId, sessionId);
  }, [markDead, tabId, sessionId]);

  // 关键:把 PaneChrome 的 xterm 传给 hook,共享同一份引用
  useTerminalSession({
    sessionId,
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
      { label: "Split Horizontal", onClick: () => void splitActivePane(tabId, "h") },
      { label: "Split Vertical", onClick: () => void splitActivePane(tabId, "v") },
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
      {
        label: "Reconnect",
        onClick: () => void reconnectLeaf(tabId, sessionId),
      },
      { separator: true },
      {
        label: "Close Pane",
        onClick: () => void closeLeaf(tabId, sessionId),
        danger: true,
      },
    ];
    return items;
  }, [xterm, sessionId, splitActivePane, closeLeaf, reconnectLeaf, tabId]);

  return (
    <>
      <div
        ref={wrapperRef}
        className={`paneChrome${focused ? " paneChromeFocused" : ""}`}
        style={style}
        onMouseDown={() => focusLeaf(tabId, sessionId)}
        onContextMenu={handleContextMenu}
      >
        <div className="paneChromeBadge" aria-label={`Pane ${paneNumber}`}>
          {paneNumber}
        </div>
        <div className="paneChromeXterm">
          <TerminalView onTermReady={handleTermReady} />
        </div>
      </div>
      <ContextMenuOverlay state={state} close={close} items={menuItems} containerRef={wrapperRef} />
    </>
  );
}
