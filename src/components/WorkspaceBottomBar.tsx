import { useEffect, useRef, useState, MouseEvent as ReactMouseEvent } from "react";
import { Workspace } from "../types/session";
import { CloseIcon } from "./icons/Icon";
import "./WorkspaceBottomBar.css";

export interface WorkspaceBottomBarProps {
  workspaceName: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: (workspaceId: string) => void;
  commandPanelOpen: boolean;
  onToggleCommandPanel: () => void;
}

export function WorkspaceBottomBar({
  workspaceName,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCloseWorkspace,
  onToggleCommandPanel,
  commandPanelOpen,
}: WorkspaceBottomBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleToggle = () => {
    setMenuOpen((prev) => !prev);
  };

  const handleSelect = (id: string) => {
    onSelectWorkspace(id);
    setMenuOpen(false);
  };

  const handleClose = (e: ReactMouseEvent<HTMLSpanElement>, id: string) => {
    e.stopPropagation();
    onCloseWorkspace(id);
  };

  return (
    <div className="workspace-bottom-bar">
      <div className="workspace-bottom-bar-start">
        <button
          className="workspace-bottom-bar-button"
          type="button"
          onClick={onToggleCommandPanel}
          title={commandPanelOpen ? "Hide emit panel" : "Show emit panel"}
        >
          <span>Emit</span>
        </button>
      </div>
      <div className="workspace-bottom-bar-end">
        <div className="workspace-switcher">
          <button
            ref={triggerRef}
            className="workspace-switcher-trigger"
            type="button"
            onClick={handleToggle}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Switch workspace"
          >
            <span className="workspace-bottom-bar-label">Workspace:</span>
            <span className="workspace-bottom-bar-name">{workspaceName}</span>
          </button>
          {menuOpen && (
            <div ref={menuRef} className="workspace-switcher-menu" role="menu">
              {workspaces.map((w) => {
                const isActive = w.id === activeWorkspaceId;
                const isDefault = w.name === "default";
                return (
                  <button
                    key={w.id}
                    className={`workspace-switcher-item ${isActive ? "active" : ""}`}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(w.id)}
                  >
                    <span className="workspace-switcher-item-left">
                      {isActive && <span className="workspace-switcher-check" aria-hidden="true">●</span>}
                      <span className="workspace-switcher-item-name">{w.name}</span>
                    </span>
                    <span className="workspace-switcher-item-actions">
                      {!isDefault && (
                        <span
                          className="workspace-switcher-item-close"
                          onClick={(e) => handleClose(e, w.id)}
                          title="Close workspace"
                          role="button"
                          aria-label={`Close workspace ${w.name}`}
                        >
                          <CloseIcon size={12} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
