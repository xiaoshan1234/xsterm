import { type SessionDisplayConfig } from "../../types/session";
import { FormField } from "../ui/FormField";

interface DisplayConfigFormProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig | undefined) => void;
}

const CURSOR_STYLES = [
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

const FONT_FAMILIES = [
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Default (Menlo)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, monospace", label: "Consolas" },
];

export function DisplayConfigForm({ config = {}, onChange }: DisplayConfigFormProps) {
  const update = (patch: Partial<SessionDisplayConfig>) => {
    onChange({ ...config, ...patch });
  };

  return (
    <>
      <FormField label="Font Size">
        <input
          type="number"
          placeholder="14"
          value={config.fontSize ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ fontSize: v ? parseFloat(v) : undefined });
          }}
        />
      </FormField>
      <FormField label="Font Family">
        <select
          value={config.fontFamily || ""}
          onChange={(e) => update({ fontFamily: e.target.value || undefined })}
        >
          <option value="">(use global default)</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Cursor Style">
        <select
          value={config.cursorStyle || ""}
          onChange={(e) =>
            update({
              cursorStyle:
                e.target.value === ""
                  ? undefined
                  : (e.target.value as "block" | "underline" | "bar"),
            })
          }
        >
          <option value="">(use global default)</option>
          {CURSOR_STYLES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Cursor Blink">
        <input
          type="checkbox"
          checked={config.cursorBlink ?? false}
          onChange={(e) => update({ cursorBlink: e.target.checked })}
        />
      </FormField>
      <FormField label="Scrollback Lines">
        <input
          type="number"
          placeholder="(default)"
          value={config.scrollback ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ scrollback: v ? parseInt(v) : undefined });
          }}
        />
      </FormField>
      <FormField label="Line Height">
        <input
          type="number"
          step="0.1"
          placeholder="(default)"
          value={config.lineHeight ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ lineHeight: v ? parseFloat(v) : undefined });
          }}
        />
      </FormField>
      <FormField label="Letter Spacing">
        <input
          type="number"
          step="0.1"
          placeholder="(default)"
          value={config.letterSpacing ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ letterSpacing: v ? parseFloat(v) : undefined });
          }}
        />
      </FormField>
      <FormField label="Cursor Width">
        <input
          type="number"
          placeholder="(default)"
          value={config.cursorWidth ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ cursorWidth: v ? parseInt(v) : undefined });
          }}
        />
      </FormField>
    </>
  );
}
