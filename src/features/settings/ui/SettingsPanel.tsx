import { useTheme } from "../../../shared/theme/ThemeContext";
import { FormCheckboxField } from "../../../shared/ui/FormCheckboxField";
import { FormSelectField } from "../../../shared/ui/FormSelectField";
import { useSessionPreferences } from "../../sessions";

export function SettingsPanel() {
  const { currentThemeKey, setTheme, themeKeys } = useTheme();
  const { globalLocalEcho, setGlobalLocalEcho } = useSessionPreferences();

  return (
    <div className="manager-panel-scroll">
      <FormSelectField
        label="Theme"
        value={currentThemeKey}
        options={themeKeys.map((key) => ({ value: key, label: key }))}
        onChange={setTheme}
      />
      <FormCheckboxField
        label="Global local echo"
        checked={globalLocalEcho}
        onChange={setGlobalLocalEcho}
      />
    </div>
  );
}
