import {
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
  forwardRef,
  useImperativeHandle,
} from "react";
import "./ContextMenu.css";

export interface ContextMenuItem {
  id?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface ContextMenuRef {
  open: (x: number, y: number) => void;
  close: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: ReactNode;
  onOpen?: () => void;
}

export const ContextMenu = forwardRef<ContextMenuRef, ContextMenuProps>(function ContextMenu(
  { items, children, onOpen },
  ref
) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback(
    (x: number, y: number) => {
      const safeX = Math.min(Math.max(x, 0), window.innerWidth - 180);
      const safeY = Math.min(Math.max(y, 0), window.innerHeight - items.length * 36 - 16);
      setPosition({ x: safeX, y: safeY });
      setIsOpen(true);
      onOpen?.();
    },
    [items.length, onOpen]
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open: openMenu,
      close: closeMenu,
    }),
    [openMenu, closeMenu]
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY);
  };

  const handleItemClick = (item: ContextMenuItem) => {
    item.onClick();
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <div onContextMenu={handleContextMenu}>{children}</div>
      {isOpen && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: position.x, top: position.y }}
        >
          {items.map((item, index) => (
            <button
              key={item.id ?? item.label ?? index}
              className={`context-menu-item ${item.danger ? "context-menu-item--danger" : ""}`}
              onClick={() => handleItemClick(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
});
