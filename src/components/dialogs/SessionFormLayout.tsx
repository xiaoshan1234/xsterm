import { ReactNode } from "react";
import "./SessionFormLayout.css";

export interface SessionFormTab {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export interface SessionFormSidebarItem {
  id: string;
  label: ReactNode;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

interface SessionFormLayoutProps {
  topTabs?: SessionFormTab[];
  sidebarItems: SessionFormSidebarItem[];
  children: ReactNode;
}

export function SessionFormLayout({
  topTabs,
  sidebarItems,
  children,
}: SessionFormLayoutProps) {
  const hasTopTabs = !!topTabs && topTabs.length > 0;
  return (
    <div className="session-form-layout">
      {hasTopTabs && (
        <div className="dialog-tabs">
          {topTabs!.map((tab) => (
            <button
              key={tab.id}
              className={`dialog-tab ${tab.active ? "active" : ""}`}
              onClick={tab.onClick}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="dialog-body">
        <nav className="dialog-sidebar" aria-label="Section">
          {sidebarItems.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-pressed={item.active}
              className={`dialog-sidebar-item${
                item.active ? " dialog-sidebar-item--active" : ""
              }`}
              onClick={item.onClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  item.onClick();
                }
              }}
            >
              <span className="dialog-sidebar-item-icon">{item.icon}</span>
              <span className="dialog-sidebar-item-label">{item.label}</span>
            </div>
          ))}
        </nav>
        <div className="dialog-panel">{children}</div>
      </div>
    </div>
  );
}