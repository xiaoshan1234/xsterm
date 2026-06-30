import { useState, useCallback } from "react";
import { SidebarToolbar, SidebarMenu } from "./SidebarToolbar";
import { SessionManager } from "./SessionManager";
import { PaneLayout } from "../../types/session";
import "./Sidebar.css";

const TOOLBAR_WIDTH = 48;
const MIN_SUBMENU_WIDTH = 140;
const MAX_SUBMENU_WIDTH = 400;
const DEFAULT_SUBMENU_WIDTH = 200;

type SettingsCategory = "appearance" | "shortcuts" | "about";

interface SidebarProps {
  onCreateSession: () => void;
  onCreateSessionWithGroup: (groupId: number) => void;
  onToggleLogs: () => void;
  sidebarPanel: SidebarMenu | null;
  onSidebarPanelChange: (panel: SidebarMenu | null) => void;
  activeSettingsCategory?: SettingsCategory;
  onSelectSettingsCategory?: (category: SettingsCategory) => void;
  paneLayout: PaneLayout;
  onPaneLayoutChange: (layout: PaneLayout) => void;
}

const SETTINGS_CATEGORIES: { key: SettingsCategory; label: string }[] = [
  { key: "appearance", label: "Appearance" },
  { key: "shortcuts", label: "Shortcuts" },
  { key: "about", label: "About" },
];

const LAYOUTS: { value: PaneLayout; label: string }[] = [
  { value: "1", label: "1" },
  { value: "2-v", label: "1 | 2" },
  { value: "2-h", label: "1 / 2" },
  { value: "3-left-big", label: "big left" },
  { value: "3-right-big", label: "big right" },
  { value: "3-top-big", label: "big top" },
  { value: "3-bottom-big", label: "big bottom" },
  { value: "4", label: "2×2" },
];

function LayoutPreview({ layout }: { layout: PaneLayout }) {
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  switch (layout) {
    case "1":
      boxes.push({ x: 2, y: 2, w: 20, h: 20 });
      break;
    case "2-v":
      boxes.push({ x: 2, y: 2, w: 9, h: 20 });
      boxes.push({ x: 13, y: 2, w: 9, h: 20 });
      break;
    case "2-h":
      boxes.push({ x: 2, y: 2, w: 20, h: 9 });
      boxes.push({ x: 2, y: 13, w: 20, h: 9 });
      break;
    case "3-left-big":
      boxes.push({ x: 2, y: 2, w: 9, h: 20 });
      boxes.push({ x: 13, y: 2, w: 9, h: 9 });
      boxes.push({ x: 13, y: 13, w: 9, h: 9 });
      break;
    case "3-right-big":
      boxes.push({ x: 2, y: 2, w: 9, h: 9 });
      boxes.push({ x: 2, y: 13, w: 9, h: 9 });
      boxes.push({ x: 13, y: 2, w: 9, h: 20 });
      break;
    case "3-top-big":
      boxes.push({ x: 2, y: 2, w: 20, h: 9 });
      boxes.push({ x: 2, y: 13, w: 9, h: 9 });
      boxes.push({ x: 13, y: 13, w: 9, h: 9 });
      break;
    case "3-bottom-big":
      boxes.push({ x: 2, y: 2, w: 9, h: 9 });
      boxes.push({ x: 13, y: 2, w: 9, h: 9 });
      boxes.push({ x: 2, y: 13, w: 20, h: 9 });
      break;
    case "4":
      boxes.push({ x: 2, y: 2, w: 9, h: 9 });
      boxes.push({ x: 13, y: 2, w: 9, h: 9 });
      boxes.push({ x: 2, y: 13, w: 9, h: 9 });
      boxes.push({ x: 13, y: 13, w: 9, h: 9 });
      break;
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="layout-preview">
      {boxes.map((box, i) => (
        <rect key={i} x={box.x} y={box.y} width={box.w} height={box.h} rx="1" ry="1" />
      ))}
    </svg>
  );
}

export default function Sidebar({
  onCreateSession,
  onCreateSessionWithGroup,
  onToggleLogs,
  sidebarPanel,
  onSidebarPanelChange,
  activeSettingsCategory = "appearance",
  onSelectSettingsCategory,
  paneLayout,
  onPaneLayoutChange,
}: SidebarProps) {
  const [submenuWidth, setSubmenuWidth] = useState(DEFAULT_SUBMENU_WIDTH);
  const [layoutPopoverOpen, setLayoutPopoverOpen] = useState(false);

  const handleMenuClick = (menu: SidebarMenu) => {
    onSidebarPanelChange(sidebarPanel === menu ? null : menu);
  };

  const handleLayoutClick = () => {
    setLayoutPopoverOpen((prev) => !prev);
  };

  const handleSelectLayout = (layout: PaneLayout) => {
    onPaneLayoutChange(layout);
    setLayoutPopoverOpen(false);
  };

  const handleResize = useCallback((newWidth: number) => {
    setSubmenuWidth(Math.max(MIN_SUBMENU_WIDTH, Math.min(MAX_SUBMENU_WIDTH, newWidth)));
  }, []);

  const sidebarWidth = sidebarPanel ? TOOLBAR_WIDTH + submenuWidth : TOOLBAR_WIDTH;

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <SidebarToolbar
        activeMenu={sidebarPanel}
        onMenuClick={handleMenuClick}
        onToggleLogs={onToggleLogs}
        layoutActive={layoutPopoverOpen}
        onLayoutClick={handleLayoutClick}
      />

      {sidebarPanel === "chat" && (
        <SessionManager
          width={submenuWidth}
          onCreateSession={onCreateSession}
          onCreateSessionWithGroup={onCreateSessionWithGroup}
        />
      )}

      {sidebarPanel === "settings" && (
        <div className="sidebar-submenu" style={{ width: submenuWidth }}>
          <div className="submenu-header">Settings</div>
          {SETTINGS_CATEGORIES.map((category) => (
            <button
              key={category.key}
              className={`submenu-item ${activeSettingsCategory === category.key ? "active" : ""}`}
              onClick={() => onSelectSettingsCategory?.(category.key)}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}

      {layoutPopoverOpen && (
        <div className="layout-popover">
          <div className="layout-popover-title">Layout</div>
          <div className="layout-options">
            {LAYOUTS.map((layout) => (
              <button
                key={layout.value}
                className={`layout-option ${paneLayout === layout.value ? "active" : ""}`}
                onClick={() => handleSelectLayout(layout.value)}
                title={layout.label}
              >
                <LayoutPreview layout={layout.value} />
                <span className="layout-option-label">{layout.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sidebarPanel && (
        <div
          className="sidebar-resize-handle"
          onMouseDown={(e) => {
            e.preventDefault();
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const startX = e.clientX;
            const startWidth = submenuWidth;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientX - startX;
              handleResize(startWidth + delta);
            };

            const handleMouseUp = () => {
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        />
      )}
    </div>
  );
}
