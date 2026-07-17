import type { SystemConfig, SystemProfile } from "../../types/session";
import {
  CUSTOM_PROFILE_LABEL,
  SYSTEM_PROFILES,
  detectProfileFromSystemConfig,
  getDefaultSystemConfig,
  isCustomProfile,
} from "../../constants/systemProfiles";
import { FormField } from "../ui/FormField";
import "./SystemConfigForm.css";

interface SystemConfigFormProps {
  value: SystemConfig;
  onChange: (value: SystemConfig, profile: SystemProfile | "Custom") => void;
  disabled?: boolean;
}

const PROFILE_ORDER = Object.keys(SYSTEM_PROFILES) as SystemProfile[];

const FIELD_KEYS: (keyof SystemConfig)[] = [
  "newline",
  "terminalType",
  "charset",
  "backspace",
  "delete",
  "mouseScroll",
  "signalKey",
];

const fieldLabels: Record<keyof SystemConfig, string> = {
  newline: "Newline",
  terminalType: "Terminal Type",
  charset: "Charset",
  backspace: "Backspace",
  delete: "Delete",
  mouseScroll: "Mouse Scroll",
  signalKey: "Signal Key",
};

function formatProfileLabel(profile: SystemProfile): string {
  return profile.charAt(0).toUpperCase() + profile.slice(1);
}

export function SystemConfigForm({ value, onChange, disabled }: SystemConfigFormProps) {
  const selectedProfile = detectProfileFromSystemConfig(value);

  const handleProfileChange = (profile: SystemProfile) => {
    onChange(getDefaultSystemConfig(profile), profile);
  };

  const handleFieldChange = (key: keyof SystemConfig, fieldValue: string) => {
    const next: SystemConfig = { ...value, [key]: fieldValue };

    if (selectedProfile !== "Custom" && !isCustomProfile(next, selectedProfile)) {
      onChange(next, selectedProfile);
      return;
    }

    const matched = detectProfileFromSystemConfig(next);
    onChange(next, matched);
  };

  return (
    <div className="system-config-form">
      <FormField label="System Profile">
        <select
          value={selectedProfile}
          disabled={disabled}
          onChange={(e) => handleProfileChange(e.target.value as SystemProfile)}
        >
          <option value="Custom" disabled>
            {CUSTOM_PROFILE_LABEL}
          </option>
          {PROFILE_ORDER.map((profile) => (
            <option key={profile} value={profile}>
              {formatProfileLabel(profile)}
            </option>
          ))}
        </select>
      </FormField>

      {FIELD_KEYS.map((key) => (
        <FormField key={key} label={fieldLabels[key]}>
          <input
            type="text"
            value={value[key]}
            disabled={disabled}
            onChange={(e) => handleFieldChange(key, e.target.value)}
          />
        </FormField>
      ))}
    </div>
  );
}
