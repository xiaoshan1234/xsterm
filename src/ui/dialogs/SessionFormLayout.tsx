import { type ReactNode } from "react";
import "./SessionFormLayout.css";

export interface SessionFormTab {
  id: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export interface SessionFormSidebarItem {
  id: string;
  label: ReactNode;
  icon: ReactNode;
  isActive: boolean;
  onClick: () => void;
}

interface SessionFormLayoutProps {
  topTabs?: SessionFormTab[];
  sidebarItems: SessionFormSidebarItem[];
  children: ReactNode;
}

export function SessionFormLayout({ topTabs, sidebarItems, children }: SessionFormLayoutProps) {
  const hasTopTabs = !!topTabs && topTabs.length > 0;
  return (
    <div className="session-form-layout">
      {hasTopTabs && (
        <div className="dialog-tabs">
          {topTabs!.map((tab) => (
            <button
              key={tab.id}
              className={`dialog-tab ${tab.isActive ? "isActive" : ""}`}
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
              aria-pressed={item.isActive}
              className={`dialog-sidebar-item${item.isActive ? " dialog-sidebar-item--isActive" : ""}`}
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
