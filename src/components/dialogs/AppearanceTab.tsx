import { type SessionDisplayConfig } from "../../types/session";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormCheckboxField } from "./FormCheckboxField";
import "./AppearanceTab.css";

interface AppearanceTabProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig) => void;
}

const FONT_FAMILIES = [
  { value: "", label: "(use global default)" },
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Default (Menlo)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, monospace", label: "Consolas" },
];

const CURSOR_STYLES = [
  { value: "", label: "(use global default)" },
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

export default function AppearanceTab({
  config = {},
  onChange,
}: AppearanceTabProps) {
  const update = (patch: Partial<SessionDisplayConfig>) => {
    onChange({ ...config, ...patch });
  };

  return (
    <div className="appearance-tab">
      <div className="appearance-tab__group">
        <span className="appearance-tab__group-title">Typography</span>
        <div className="appearance-tab__row">
          <FormNumberField
            label="Font Size"
            placeholder="14"
            value={config.fontSize}
            onChange={(fontSize) => update({ fontSize })}
          />
          <FormSelectField
            label="Font Family"
            value={config.fontFamily ?? ""}
            onChange={(fontFamily) => update({ fontFamily: fontFamily || undefined })}
            options={FONT_FAMILIES}
          />
        </div>
        <div className="appearance-tab__row">
          <FormNumberField
            label="Line Height"
            placeholder="(default)"
            step={0.1}
            float
            value={config.lineHeight}
            onChange={(lineHeight) => update({ lineHeight })}
          />
          <FormNumberField
            label="Letter Spacing"
            placeholder="(default)"
            step={0.1}
            float
            value={config.letterSpacing}
            onChange={(letterSpacing) => update({ letterSpacing })}
          />
        </div>
      </div>

      <div className="appearance-tab__group">
        <span className="appearance-tab__group-title">Cursor</span>
        <div className="appearance-tab__row">
          <FormSelectField
            label="Cursor Style"
            value={config.cursorStyle ?? ""}
            onChange={(v) =>
              update({ cursorStyle: (v || undefined) as SessionDisplayConfig["cursorStyle"] })
            }
            options={CURSOR_STYLES}
          />
          <FormCheckboxField
            label="Cursor Blink"
            checked={config.cursorBlink ?? false}
            onChange={(cursorBlink) => update({ cursorBlink })}
          />
        </div>
        <FormNumberField
          label="Cursor Width"
          placeholder="(default)"
          value={config.cursorWidth}
          onChange={(cursorWidth) => update({ cursorWidth })}
        />
      </div>

    </div>
  );
}
