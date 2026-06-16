import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseIcon, MinimizeIcon, MaximizeIcon, RestoreIcon } from "./icons/Icon";
import "./NavBar.css";
import logo from "../assets/logo.svg";

interface NavBarProps {
  onMenuAction?: (menu: string) => void;
}

const MENU_ITEMS = ["File", "Edit", "View", "Terminal", "Help"];

export default function NavBar({ onMenuAction }: NavBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const updateState = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
      } catch {
        // ignore when running outside Tauri
      }
    };
    updateState();

    let unlisten: (() => void) | undefined;
    appWindow.onResized?.(() => updateState()).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [appWindow]);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => {
    if (isMaximized) {
      appWindow.unmaximize();
    } else {
      appWindow.maximize();
    }
  };
  const handleClose = () => appWindow.close();

  return (
    <div className="navbar" data-tauri-drag-region>
      <div className="navbar-logo" title="XSTerm">
        <img className="navbar-logo-img" src={logo} alt="XSTerm" />
      </div>
      <div className="navbar-menu">
        {MENU_ITEMS.map((item) => (
          <button
            key={item}
            className="navbar-item"
            onClick={() => onMenuAction?.(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="navbar-drag-region" data-tauri-drag-region />
      <div className="navbar-window-controls">
        <button
          className="window-control window-control--minimize"
          onClick={handleMinimize}
          title="最小化"
        >
          <MinimizeIcon size={14} />
        </button>
        <button
          className="window-control window-control--maximize"
          onClick={handleMaximize}
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>
        <button
          className="window-control window-control--close"
          onClick={handleClose}
          title="关闭"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
