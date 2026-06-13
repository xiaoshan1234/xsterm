import { useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { PRESET_THEMES } from "../../types/theme";

const SHORTCUTS = [
  { label: "New session", keys: "Ctrl+Shift+N" },
  { label: "Next tab", keys: "Ctrl+Tab" },
  { label: "Previous tab", keys: "Ctrl+Shift+Tab" },
  { label: "Close current tab", keys: "Ctrl+W" },
  { label: "Open settings", keys: "Ctrl+," },
];

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { currentTheme, currentThemeKey, setTheme, themeKeys } = useTheme();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const toggle = (item: string) => {
    setExpandedItem(expandedItem === item ? null : item);
  };

  return (
    <div className="sidebar-submenu">
      <div className="submenu-header">Settings</div>
      <div className="submenu-item-with-submenu">
        <button className="submenu-item" onClick={() => toggle("appearance")}>
          Appearance
          <span className="submenu-item-arrow">{expandedItem === "appearance" ? "▲" : "▼"}</span>
        </button>
        {expandedItem === "appearance" && (
          <div className="submenu-nested">
            {themeKeys.map((key) => (
              <button
                key={key}
                className={`submenu-item ${currentThemeKey === key ? "active" : ""}`}
                onClick={() => {
                  setTheme(key);
                  onClose();
                }}
              >
                <span
                  className="theme-color-preview"
                  style={{
                    backgroundColor: currentTheme.background,
                    border: `1px solid ${currentTheme.foreground}`,
                  }}
                />
                {PRESET_THEMES[key].name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="submenu-item-with-submenu">
        <button className="submenu-item" onClick={() => toggle("shortcuts")}>
          Shortcuts
          <span className="submenu-item-arrow">{expandedItem === "shortcuts" ? "▲" : "▼"}</span>
        </button>
        {expandedItem === "shortcuts" && (
          <div className="submenu-nested shortcuts-list">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.label} className="shortcut-item">
                <span className="shortcut-label">{shortcut.label}</span>
                <span className="shortcut-keys">{shortcut.keys}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="submenu-item" onClick={onClose}>
        About
      </button>
    </div>
  );
}
