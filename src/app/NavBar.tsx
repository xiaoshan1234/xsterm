import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from "../shared/icons/Icon";
import { type HelpDialogId } from "./shell/HelpDialog";
import "./NavBar.css";
import logo from "../assets/logo.svg";

const NAV_MENU_ITEMS = ["View"] as const;

export interface NavBarTerminalItem {
  configId: string;
  name: string;
}

export interface NavBarViewProps {
  terminalItems: readonly NavBarTerminalItem[];
  workspaces: readonly string[];
  workspaceName: string;
  isTextSenderOpen: boolean;
  isMaximized: boolean;
  onMenuAction?: (menu: string) => void;
  onMaximize: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onSelectWorkspace: (workspaceName: string) => void;
  onCloseWorkspace: (workspaceName: string) => void;
  onToggleTextSender: () => void;
  onHelpAction: (dialog: HelpDialogId) => void;
  onOpenTerminal: (configId: string) => void;
}

type OpenMenu = "terminal" | "view" | "workspace" | "help" | null;

export function NavBarView({
  terminalItems,
  workspaces,
  workspaceName,
  isTextSenderOpen,
  isMaximized,
  onMenuAction,
  onMaximize,
  onMinimize,
  onClose,
  onSelectWorkspace,
  onCloseWorkspace,
  onToggleTextSender,
  onHelpAction,
  onOpenTerminal,
}: NavBarViewProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const navigationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!navigationRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  const closeMenus = () => {
    setOpenMenu(null);
  };

  const toggleViewMenu = () => {
    setOpenMenu((current) => (current === "view" ? null : "view"));
    onMenuAction?.("View");
  };

  const toggleTerminalMenu = () => {
    setOpenMenu((current) => (current === "terminal" ? null : "terminal"));
  };

  const toggleWorkspaceMenu = () => {
    setOpenMenu((current) => (current === "workspace" ? null : "workspace"));
  };

  const toggleHelpMenu = () => {
    setOpenMenu((current) => (current === "help" ? null : "help"));
  };

  return (
    <div className="navbar" data-tauri-drag-region>
      <div className="navbar-logo" title="XSTerm">
        <img className="navbar-logo-img" src={logo} alt="XSTerm" />
      </div>
      <div className="navbar-menu" ref={navigationRef}>
        <div className="navbar-menu-root">
          <button
            type="button"
            className={`navbar-item ${openMenu === "terminal" ? "navbar-item--open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "terminal"}
            onClick={toggleTerminalMenu}
          >
            <span className="navbar-primary-label">Terminal</span>
          </button>
          {openMenu === "terminal" && (
            <div
              className="navbar-popover navbar-popover--terminal"
              role="menu"
              aria-label="Terminal"
            >
              {terminalItems.length === 0 ? (
                <div className="navbar-menu-empty">No terminals in default group</div>
              ) : (
                terminalItems.map((terminal) => (
                  <button
                    key={terminal.configId}
                    type="button"
                    className="navbar-menu-item"
                    role="menuitem"
                    onClick={() => {
                      onOpenTerminal(terminal.configId);
                      closeMenus();
                    }}
                  >
                    {terminal.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {NAV_MENU_ITEMS.map((item) => {
          if (item === "View") {
            const isViewOpen = openMenu === "view";
            return (
              <div className="navbar-menu-root" key={item}>
                <button
                  type="button"
                  className={`navbar-item ${isViewOpen ? "navbar-item--open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={isViewOpen}
                  onClick={toggleViewMenu}
                >
                  <span className="navbar-primary-label">{item}</span>
                </button>
                {isViewOpen && (
                  <div
                    className="navbar-popover navbar-popover--view"
                    role="menu"
                    aria-label="View"
                  >
                    <button
                      type="button"
                      className="navbar-menu-item"
                      role="menuitemcheckbox"
                      aria-checked={isTextSenderOpen}
                      onClick={() => {
                        onToggleTextSender();
                        closeMenus();
                      }}
                    >
                      <span className="navbar-menu-check" aria-hidden="true">
                        {isTextSenderOpen ? "✓" : ""}
                      </span>
                      <span>Sender</span>
                    </button>
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              type="button"
              key={item}
              className="navbar-item"
              onClick={() => {
                closeMenus();
                onMenuAction?.(item);
              }}
            >
              {item}
            </button>
          );
        })}
        <div className="navbar-menu-root">
          <button
            type="button"
            className={`navbar-item ${openMenu === "workspace" ? "navbar-item--open" : ""}`}
            aria-label={`Switch workspace: ${workspaceName}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "workspace"}
            onClick={toggleWorkspaceMenu}
          >
            <span className="navbar-primary-label">Workspace</span>
          </button>
          {openMenu === "workspace" && (
            <div
              className="navbar-popover navbar-popover--workspace"
              role="menu"
              aria-label="Switch workspace"
            >
              <div className="navbar-menu-group">
                {workspaces.map((workspace) => {
                  const isCurrent = workspace === workspaceName;
                  const canClose = workspace.toLowerCase() !== "default";
                  return (
                    <div
                      key={workspace}
                      className={`navbar-workspace-row ${
                        isCurrent ? "navbar-workspace-row--active" : ""
                      }`}
                      role="none"
                    >
                      <button
                        type="button"
                        role="menuitemradio"
                        className="navbar-menu-item navbar-menu-item--workspace"
                        aria-checked={isCurrent}
                        onClick={() => {
                          onSelectWorkspace(workspace);
                          closeMenus();
                        }}
                      >
                        <span className="navbar-workspace-item-name">{workspace}</span>
                      </button>
                      {canClose && (
                        <button
                          type="button"
                          className="navbar-workspace-close"
                          aria-label={`Close workspace ${workspace}`}
                          title={`Close ${workspace}`}
                          onClick={() => {
                            onCloseWorkspace(workspace);
                            closeMenus();
                          }}
                        >
                          Close
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="navbar-menu-root">
          <button
            type="button"
            className={`navbar-item ${openMenu === "help" ? "navbar-item--open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "help"}
            onClick={toggleHelpMenu}
          >
            <span className="navbar-primary-label">Help</span>
          </button>
          {openMenu === "help" && (
            <div className="navbar-popover navbar-popover--help" role="menu" aria-label="Help">
              {(
                [
                  ["version", "Version"],
                  ["update", "Update"],
                  ["license", "License"],
                ] as const
              ).map(([dialogId, label]) => (
                <button
                  key={dialogId}
                  type="button"
                  className="navbar-menu-item"
                  role="menuitem"
                  onClick={() => {
                    onHelpAction(dialogId);
                    closeMenus();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="navbar-drag-region" data-tauri-drag-region />
      <div className="navbar-window-controls">
        <button
          className="window-control window-control--minimize"
          onClick={onMinimize}
          title="Minimize"
        >
          <MinimizeIcon size={14} />
        </button>
        <button
          className="window-control window-control--maximize"
          onClick={onMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>
        <button className="window-control window-control--close" onClick={onClose} title="Close">
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}

export default function NavBar(
  props: Omit<NavBarViewProps, "isMaximized" | "onMaximize" | "onMinimize" | "onClose">,
) {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const updateState = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
      } catch {
        // Ignore when running outside Tauri.
      }
    };
    void updateState();

    let unlisten: (() => void) | undefined;
    appWindow
      .onResized(() => updateState())
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Ignore when running outside Tauri.
      });

    return () => {
      unlisten?.();
    };
  }, [appWindow]);

  return (
    <NavBarView
      {...props}
      isMaximized={isMaximized}
      onMinimize={() => {
        void appWindow.minimize();
      }}
      onMaximize={() => {
        void (isMaximized ? appWindow.unmaximize() : appWindow.maximize());
      }}
      onClose={() => {
        void appWindow.close();
      }}
    />
  );
}
