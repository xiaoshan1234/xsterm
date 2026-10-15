import { useState, useEffect, useRef, useCallback, type RefObject } from "react";
import "./ContextMenu.css";

export interface ContextMenuEntry {
  id?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuItem = ContextMenuEntry | ContextMenuSeparator;

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
}

export function useContextMenu(): {
  state: ContextMenuState;
  open: (x: number, y: number) => void;
  close: () => void;
} {
  const [state, setState] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
  });

  const open = useCallback((x: number, y: number) => {
    setState({ isOpen: true, position: { x, y } });
  }, []);

  const close = useCallback(() => {
    setState((cur) => (cur.isOpen ? { isOpen: false, position: cur.position } : cur));
  }, []);

  return { state, open, close };
}

interface ContextMenuOverlayProps {
  state: ContextMenuState;
  close: () => void;
  items: ContextMenuItem[];
  containerRef: RefObject<HTMLElement | null>;
}

export function ContextMenuOverlay({ state, close, items, containerRef }: ContextMenuOverlayProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const menu = menuRef.current;
      const container = containerRef.current;
      const target = e.target as Node;
      if (menu && menu.contains(target)) return;
      if (container && container.contains(target)) return;
      close();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.isOpen, close, containerRef]);

  if (!state.isOpen) return null;

  const handleItemClick = (item: ContextMenuEntry) => {
    if (item.disabled) return;
    item.onClick();
    close();
  };

  return (
    <div
      ref={menuRef}
      className="contextMenu"
      style={{ left: state.position.x, top: state.position.y }}
      role="menu"
    >
      {items.map((item, index) => {
        if ("separator" in item) {
          return <div key={`sep-${index}`} className="contextMenuSeparator" role="separator" />;
        }
        return (
          <button
            key={item.id ?? item.label ?? index}
            type="button"
            className={`contextMenuItem${item.danger ? " contextMenuItem--danger" : ""}`}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            role="menuitem"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
