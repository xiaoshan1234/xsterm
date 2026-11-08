import { useEffect, useRef, useState } from "react";
import { ChevronIcon, WorkspaceIcon } from "../../shared/icons/Icon";

interface BottomBarProps {
  workspaceName: string;
  workspaces: readonly string[];
  isTextSenderOpen: boolean;
  onToggleTextSender: () => void;
  onSelectWorkspace: (workspaceName: string) => void;
}

export function BottomBar({
  workspaceName,
  workspaces,
  isTextSenderOpen,
  onToggleTextSender,
  onSelectWorkspace,
}: BottomBarProps) {
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isWorkspaceMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsWorkspaceMenuOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isWorkspaceMenuOpen]);

  return (
    <footer className="shell-bottom-bar">
      <div className="shell-bottom-workspace" ref={menuRef}>
        <button
          type="button"
          className="shell-bottom-button"
          aria-haspopup="menu"
          aria-expanded={isWorkspaceMenuOpen}
          onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
        >
          <WorkspaceIcon size={14} />
          <span>{workspaceName}</span>
          <ChevronIcon size={12} />
        </button>
        {isWorkspaceMenuOpen && (
          <div className="shell-workspace-menu" role="menu">
            <div className="shell-menu-label">Switch workspace</div>
            {workspaces.map((workspace) => (
              <button
                key={workspace}
                type="button"
                role="menuitem"
                className={`shell-workspace-menu-item ${
                  workspace === workspaceName ? "shell-workspace-menu-item--active" : ""
                }`}
                onClick={() => {
                  onSelectWorkspace(workspace);
                  setIsWorkspaceMenuOpen(false);
                }}
              >
                <span>{workspace}</span>
                {workspace === workspaceName && <span aria-hidden="true">Current</span>}
              </button>
            ))}
            <div className="shell-menu-separator" />
            <button type="button" role="menuitem" className="shell-workspace-menu-item">
              Manage workspaces
            </button>
          </div>
        )}
      </div>
      <div className="shell-bottom-spacer" />
      <button
        type="button"
        className={`shell-bottom-button ${isTextSenderOpen ? "shell-bottom-button--active" : ""}`}
        aria-pressed={isTextSenderOpen}
        onClick={onToggleTextSender}
      >
        Text Sender
      </button>
    </footer>
  );
}
