import { ReactNode } from "react";

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  isOpen: boolean;
  onClick: () => void;
  children?: ReactNode;
}

function SidebarItem({ icon, label, isOpen, onClick, children }: SidebarItemProps) {
  return (
    <div className="sidebar-item">
      <button className="sidebar-btn" onClick={onClick} title={label}>
        {icon}
      </button>
      {isOpen && children && (
        <div className="sidebar-submenu">
          {children}
        </div>
      )}
    </div>
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

  return (
    <div className="sidebar">
      <div className="sidebar-toolbar">
        <SidebarItem
          icon={<ChatIcon />}
          label="Conversation Manager"
          isOpen={activeMenu === "chat"}
          onClick={() => onMenuClick(activeMenu === "chat" ? null : "chat")}
        >
          <SubMenuItem label="New Chat" />
          <SubMenuItem label="Chat History" />
          <SubMenuItem label="Search Chats" />
          <SubMenuItem label="Export Chat" />
        </SidebarItem>

        <SidebarItem
          icon={<SettingsIcon />}
          label="Settings"
          isOpen={activeMenu === "settings"}
          onClick={() => onMenuClick(activeMenu === "settings" ? null : "settings")}
        >
          <SubMenuItem label="Appearance" />
          <SubMenuItem label="Terminal" />
          <SubMenuItem label="Shortcuts" />
          <SubMenuItem label="About" />
        </SidebarItem>
      </div>
    </div>
  );
}