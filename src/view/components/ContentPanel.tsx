import type { ReactNode } from "react";
import { usePaneTreeContext } from "../hooks/paneTreeContext";
import "./ContentPanel.css";

export interface SidebarPanelDef {
  id: string;
  label: string;
  icon: ReactNode;
}

interface ContentPanelProps {
  panel: SidebarPanelDef;
  onClose: () => void;
}

function SessionsList() {
  const { tabs, activeTabId, activateTab, closeTab } = usePaneTreeContext();
  if (tabs.length === 0) {
    return <div className="sessionItemEmpty">No sessions yet</div>;
  }
  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            className={`sessionItem${isActive ? " sessionItemActive" : ""}`}
            onClick={() => activateTab(tab.id)}
            aria-current={isActive ? "true" : undefined}
          >
            <span className="sessionItemDot" aria-hidden="true" />
            <span className="sessionItemTitle">{tab.title}</span>
            <span
              className="sessionItemClose"
              role="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </span>
          </button>
        );
      })}
    </>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="contentPanelPlaceholder">
      <div className="contentPanelPlaceholderTitle">{title}</div>
      <div>{body}</div>
    </div>
  );
}

export default function ContentPanel({ panel, onClose }: ContentPanelProps) {
  return (
    <aside className="contentPanel" aria-label={panel.label}>
      <header className="contentPanelHeader">
        <span className="contentPanelIcon" aria-hidden="true">
          {panel.icon}
        </span>
        <h2 className="contentPanelTitle">{panel.label}</h2>
        <button
          className="contentPanelClose"
          type="button"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="contentPanelBody">
        {panel.id === "sessions" ? (
          <SessionsList />
        ) : panel.id === "settings" ? (
          <Placeholder title="Settings" body="Theme, fonts, shell — coming in M5." />
        ) : panel.id === "shortcuts" ? (
          <Placeholder title="Keyboard shortcuts" body="Tab/close/split bindings — coming in M5." />
        ) : (
          <Placeholder title="xsterm" body="Windows terminal emulator · v0.1.0" />
        )}
      </div>
    </aside>
  );
}
