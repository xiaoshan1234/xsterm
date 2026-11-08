import { useEffect, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useSession } from "../sessions";
import { PRESET_THEMES } from "../../types/theme";
import {
  getLogConfig,
  getLogDir,
  setLogConfig,
  type LogConfig,
} from "../../services/loggerService";
import "./SettingsView.css";

const SHORTCUTS = [
  { label: "New terminal", keys: "Ctrl+Shift+N" },
  { label: "Next tab", keys: "Ctrl+Tab" },
  { label: "Previous tab", keys: "Ctrl+Shift+Tab" },
  { label: "Close current tab", keys: "Ctrl+W" },
  { label: "Open settings", keys: "Ctrl+," },
];

export type SettingsCategory = "appearance" | "shortcuts" | "logging" | "about";

interface SettingsViewProps {
  activeCategory?: SettingsCategory;
}

function LoggingSettingsSection() {
  const [config, setConfig] = useState<LogConfig | null>(null);
  const [logDir, setLogDir] = useState("");

  useEffect(() => {
    let cancelled = false;

    getLogConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((error) => {
        console.error("[xsterm] Failed to load log config:", error);
      });

    getLogDir()
      .then((dir) => {
        if (!cancelled) setLogDir(dir);
      })
      .catch((error) => {
        console.error("[xsterm] Failed to load log dir:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLevelChange = (logLevel: string) => {
    if (!config) return;
    const nextConfig = { ...config, logLevel };
    setConfig(nextConfig);
    setLogConfig(nextConfig).catch((error) => {
      console.error("[xsterm] Failed to save log config:", error);
    });
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Logging</h2>
      <div className="settings-select-field">
        <label className="settings-select-label" htmlFor="log-level">
          Log level
        </label>
        <div className="settings-select-wrapper">
          <select
            id="log-level"
            className="settings-select"
            value={config?.logLevel ?? "warn"}
            onChange={(e) => handleLevelChange(e.target.value)}
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>
      <p className="settings-select-hint">
        Controls how much detail the software (debug) log keeps. Terminal output logging is
        configured per terminal.
      </p>
      <div className="settings-path-field">
        <span className="settings-path-label">Log directory</span>
        <code className="settings-path-value">{logDir || "..."}</code>
      </div>
    </div>
  );
}

export function SettingsView({ activeCategory = "appearance" }: SettingsViewProps) {
  const { currentTheme, currentThemeKey, setTheme, themeKeys } = useTheme();
  const { globalLocalEcho, setGlobalLocalEcho } = useSession();

  return (
    <div className="settings-view">
      <div className="settings-content">
        {activeCategory === "appearance" && (
          <div className="settings-section">
            <h2 className="settings-section-title">Appearance</h2>
            <div className="settings-theme-field">
              <label className="settings-theme-label" htmlFor="theme-select">
                Theme
              </label>
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
            <div className="settings-toggle-field">
              <label className="settings-toggle" htmlFor="global-local-echo">
                <input
                  id="global-local-echo"
                  type="checkbox"
                  checked={globalLocalEcho}
                  onChange={(e) => setGlobalLocalEcho(e.target.checked)}
                />
                <span className="settings-toggle-label">Global local echo</span>
              </label>
              <p className="settings-toggle-hint">
                Show typed characters locally before the remote echo arrives. Per-terminal overrides
                will take priority.
              </p>
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

        {activeCategory === "logging" && <LoggingSettingsSection />}
      </div>
    </div>
  );
}
