import { useState, useCallback, ReactNode, forwardRef, useImperativeHandle } from "react";
import { Menu, MenuItem } from "@mui/material";

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
  className?: string;
}

export const ContextMenu = forwardRef<ContextMenuRef, ContextMenuProps>(function ContextMenu(
  { items, children, onOpen, className },
  ref
) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const openMenu = useCallback(
    (x: number, y: number) => {
      setPos({ x, y });
      setAnchorEl(document.body);
      onOpen?.();
    },
    [onOpen]
  );

  const closeMenu = useCallback(() => {
    setAnchorEl(null);
    setPos(null);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ open: openMenu, close: closeMenu }),
    [openMenu, closeMenu]
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY);
  };

  const handleClose = () => {
    closeMenu();
  };

  const handleItemClick = (item: ContextMenuItem) => {
    item.onClick();
    closeMenu();
  };

  return (
    <>
      <div onContextMenu={handleContextMenu} className={className}>{children}</div>
      <Menu
        open={Boolean(anchorEl) && pos !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={pos ? { top: pos.y, left: pos.x } : undefined}
      >
        {items.map((item, index) => (
          <MenuItem
            key={item.id ?? item.label ?? index}
            onClick={() => handleItemClick(item)}
            sx={item.danger ? { color: "error.main" } : undefined}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
});
