import { useTheme } from "../../contexts/ThemeContext";
import { PRESET_THEMES } from "../../types/theme";
import "./SettingsView.css";

const SHORTCUTS = [
  { label: "New session", keys: "Ctrl+Shift+N" },
  { label: "Next tab", keys: "Ctrl+Tab" },
  { label: "Previous tab", keys: "Ctrl+Shift+Tab" },
  { label: "Close current tab", keys: "Ctrl+W" },
  { label: "Open settings", keys: "Ctrl+," },
];

export type SettingsCategory = "appearance" | "shortcuts" | "about";

interface SettingsViewProps {
  activeCategory?: SettingsCategory;
}

export function SettingsView({ activeCategory = "appearance" }: SettingsViewProps) {
  const { currentTheme, currentThemeKey, setTheme, themeKeys } = useTheme();

  return (
    <div className="settings-view">
      <div className="settings-content">
        {activeCategory === "appearance" && (
          <div className="settings-section">
            <h2 className="settings-section-title">Appearance</h2>
            <div className="settings-theme-field">
              <label className="settings-theme-label" htmlFor="theme-select">Theme</label>
              <div className="settings-theme-select-wrapper">
                <span
                  className="theme-color-preview"
                  style={{
                    backgroundColor: currentTheme.background,
                    border: `1px solid ${currentTheme.foreground}`,
                  }}
                />
                <select
                  id="theme-select"
                  className="settings-theme-select"
                  value={currentThemeKey}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  {themeKeys.map((key) => (
                    <option key={key} value={key}>
                      {PRESET_THEMES[key].name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {activeCategory === "shortcuts" && (
          <div className="settings-section">
            <h2 className="settings-section-title">Shortcuts</h2>
            <div className="shortcuts-list">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.label} className="shortcut-item">
                  <span className="shortcut-label">{shortcut.label}</span>
                  <span className="shortcut-keys">{shortcut.keys}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeCategory === "about" && (
          <div className="settings-section">
            <h2 className="settings-section-title">About</h2>
            <div className="settings-about">
              <p className="settings-about-name">XSTerm</p>
              <p className="settings-about-version">v0.1.1</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
