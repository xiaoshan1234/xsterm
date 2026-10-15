import { usePaneTreeContext } from "../hooks/paneTreeContext";
import "./TabBar.css";

export default function TabBar() {
  const { tabs, activeTabId, activateTab, createTab, closeTab } = usePaneTreeContext();

  return (
    <div className="tabBar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`tab${isActive ? " tabActive" : ""}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => activateTab(tab.id)}
          >
            <span>{tab.title}</span>
            <button
              className="tabClose"
              type="button"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="tabNew" type="button" aria-label="New tab" onClick={createTab}>
        +
      </button>
    </div>
  );
}
