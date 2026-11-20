import { useTheme } from "../../../shared/theme/ThemeContext";
import { FormCheckboxField } from "../../../shared/ui/FormCheckboxField";
import { FormSelectField } from "../../../shared/ui/FormSelectField";
import { useSessionPreferences } from "../state/SessionPreferencesContext";
import { KeybindingsPanel } from "./KeybindingsPanel";
import "./SettingsPanel.css";

export function SettingsPanel() {
  const { currentThemeKey, setTheme, themeKeys } = useTheme();
  const { globalLocalEcho, setGlobalLocalEcho } = useSessionPreferences();

  return (
    <div className="settings-panel">
      <div className="settings-panel-scroll">
        <section className="settings-section">
          <h2 className="settings-section-title">Appearance</h2>
          <div className="settings-section-body">
            <FormSelectField
              label="Theme"
              value={currentThemeKey}
              options={themeKeys.map((key) => ({ value: key, label: key }))}
              onChange={setTheme}
            />
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Terminal</h2>
          <div className="settings-section-body">
            <FormCheckboxField
              label="Global local echo"
              checked={globalLocalEcho}
              onChange={setGlobalLocalEcho}
            />
            <p className="settings-section-hint">
              Echo typed input locally instead of waiting for the shell to send it back.
            </p>
          </div>
        </section>

        <KeybindingsPanel />
      </div>
    </div>
  );
}
