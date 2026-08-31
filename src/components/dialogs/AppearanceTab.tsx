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
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Default (Menlo)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, monospace", label: "Consolas" },
];

const CURSOR_STYLES = [
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
            value={config.fontFamily ?? FONT_FAMILIES[0].value}
            onChange={(fontFamily) => update({ fontFamily })}
            options={FONT_FAMILIES}
          />
        </div>
        <div className="appearance-tab__row">
          <FormNumberField
            label="Line Height"
            placeholder="1"
            step={0.1}
            float
            value={config.lineHeight}
            onChange={(lineHeight) => update({ lineHeight })}
          />
          <FormNumberField
            label="Letter Spacing"
            placeholder="0"
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
            value={config.cursorStyle ?? CURSOR_STYLES[0].value}
            onChange={(v) => update({ cursorStyle: v as SessionDisplayConfig["cursorStyle"] })}
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
          placeholder="1"
          value={config.cursorWidth}
          onChange={(cursorWidth) => update({ cursorWidth })}
        />
      </div>

    </div>
  );
}
