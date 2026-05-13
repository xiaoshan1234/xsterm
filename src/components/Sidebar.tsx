import { ReactNode } from "react";

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function SidebarItem({ icon, label, isActive, onClick }: SidebarItemProps) {
  return (
    <button
      className={`sidebar-btn ${isActive ? "active" : ""}`}
      onClick={onClick}
      title={label}
    >
      {icon}
    </button>
  );
}

interface SubMenuItemProps {
  label: string;
  onClick?: () => void;
}

function SubMenuItem({ label, onClick }: SubMenuItemProps) {
  return (
    <button className="submenu-item" onClick={onClick}>
      {label}
    </button>
  );
}

interface SidebarProps {
  activeMenu: string | null;
  onMenuClick: (menu: string | null) => void;
}

export default function Sidebar({ activeMenu, onMenuClick }: SidebarProps) {
  const ChatIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );

  const SettingsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );

  const ExpandIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  const CollapseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );

  const renderSubMenu = () => {
    if (activeMenu === "chat") {
      return (
        <>
          <div className="submenu-header">Conversation Manager</div>
          <SubMenuItem label="New Chat" />
          <SubMenuItem label="Chat History" />
          <SubMenuItem label="Search Chats" />
          <SubMenuItem label="Export Chat" />
        </>
      );
    }
    if (activeMenu === "settings") {
      return (
        <>
          <div className="submenu-header">Settings</div>
          <SubMenuItem label="Appearance" />
          <SubMenuItem label="Terminal" />
          <SubMenuItem label="Shortcuts" />
          <SubMenuItem label="About" />
        </>
      );
    }
    return null;
  };

  return (
    <div className={`sidebar ${activeMenu ? "expanded" : ""}`}>
      <div className="sidebar-toolbar">
        <div className="sidebar-section">
          <SidebarItem
            icon={<ChatIcon />}
            label="Conversation Manager"
            isActive={activeMenu === "chat"}
            onClick={() => onMenuClick(activeMenu === "chat" ? null : "chat")}
          />
          <SidebarItem
            icon={<SettingsIcon />}
            label="Settings"
            isActive={activeMenu === "settings"}
            onClick={() => onMenuClick(activeMenu === "settings" ? null : "settings")}
          />
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section sidebar-bottom">
          <SidebarItem
            icon={activeMenu ? <CollapseIcon /> : <ExpandIcon />}
            label={activeMenu ? "Collapse Menu" : "Expand Menu"}
            isActive={false}
            onClick={() => onMenuClick(null)}
          />
        </div>
      </div>

      {activeMenu && <div className="sidebar-submenu">{renderSubMenu()}</div>}
    </div>
  );
}