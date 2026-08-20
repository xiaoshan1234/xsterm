import { type ReactNode, useState } from "react";
import { CloseIcon } from "../icons/Icon";
import "./Dialog.css";

export interface DialogTab {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  content: ReactNode;
}

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "small" | "medium";
  tabs?: DialogTab[];
  initialTab?: string;
  onTabChange?: (id: string) => void;
  className?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "medium",
  tabs,
  initialTab,
  onTabChange,
  className,
}: DialogProps) {
  const [activeTabId, setActiveTabId] = useState<string | undefined>(initialTab ?? tabs?.[0]?.id);

  if (!isOpen) return null;

  const hasTabs = !!tabs && tabs.length > 0;
  const activeTab = hasTabs ? (tabs.find((t) => t.id === activeTabId) ?? tabs[0]) : null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className={`dialog dialog--${size}${hasTabs ? " dialog--with-sidebar" : ""}${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        {hasTabs ? (
          <div className="dialog-body">
            <nav className="dialog-sidebar" aria-label="Dialog sections">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    className={`dialog-sidebar-item${
                      isActive ? " dialog-sidebar-item--active" : ""
                    }`}
                    onClick={() => {
                      setActiveTabId(tab.id);
                      onTabChange?.(tab.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveTabId(tab.id);
                        onTabChange?.(tab.id);
                      }
                    }}
                  >
                    {tab.icon !== undefined && tab.icon !== null && (
                      <span className="dialog-sidebar-item-icon">{tab.icon}</span>
                    )}
                    <span className="dialog-sidebar-item-label">{tab.label}</span>
                  </div>
                );
              })}
            </nav>
            <div className="dialog-panel">{activeTab?.content}</div>
          </div>
        ) : (
          <div className="dialog-content">{children}</div>
        )}
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
