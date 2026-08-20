import { type SessionDisplayConfig, type SessionLoggingConfig } from "../../types/session";
import { CollapsibleSection } from "./CollapsibleSection";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./CommonSettingsForm.css";

interface CommonSettingsFormProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig) => void;
  /**
   * When set, render only the matching group's content. When undefined,
   * render all 4 groups (backward-compatible default).
   *   - "display"  → lineTimestamp, timeFormat, dateTimeFormat, autoWrap,
   *                  reverseVideo, mouseWheelScrollLines, fitOnResize, syncRemoteTitle
   *   - "keyboard" → backspaceSends, deleteSends, lineFeedMode, cursorKeyMode,
   *                  keypadMode, modifyOtherKeysFormat, altSendsEscape
   *   - "security" → clipboardRead, clipboardWrite
   *   - "logging"  → logging.{enabled,append,fileNameTemplate,maxSizeMb,lineFormat}
   */
  section?: "display" | "keyboard" | "security" | "logging";
}

export type CommonSettingsSection = NonNullable<CommonSettingsFormProps["section"]>;

const KEY_ACTION_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "backspace", label: "Backspace (^H)" },
  { value: "delete", label: "Delete (^?)" },
] as const;

const CURSOR_KEY_OPTIONS = [
  { value: "normal", label: "Normal (ANSI cursor keys)" },
  { value: "application", label: "Application (DECCKM)" },
] as const;

const KEYPAD_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "application", label: "Application (DECNKM)" },
] as const;

const MODIFY_OTHER_KEYS_OPTIONS = [
  { value: "xterm", label: "xterm (CSI u)" },
  { value: "fixterm", label: "fixterm (CSI ? u)" },
] as const;

const CLIPBOARD_OPTIONS = [
  { value: "ask", label: "Ask each time" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
] as const;

export function CommonSettingsForm({ config = {}, onChange, section }: CommonSettingsFormProps) {
  const update = (patch: Partial<SessionDisplayConfig>) => {
    onChange({ ...config, ...patch });
  };

  const logging: SessionLoggingConfig = config.logging ?? {};
  const updateLogging = (patch: Partial<SessionLoggingConfig>) => {
    update({ logging: { ...logging, ...patch } });
  };

  const showDisplay = !section || section === "display";
  const showKeyboard = !section || section === "keyboard";
  const showSecurity = !section || section === "security";
  const showLogging = !section || section === "logging";

  return (
    <div className="common-settings-form">
      {showDisplay && (
        <CollapsibleSection title="Display">
          <FormCheckboxField
            label="Line Timestamp"
            checked={config.lineTimestamp ?? false}
            onChange={(lineTimestamp) => update({ lineTimestamp })}
          />
          <FormTextField
            label="Time Format"
            placeholder="[HH:mm:ss]"
            value={config.timeFormat}
            onChange={(timeFormat) => update({ timeFormat })}
          />
          <FormTextField
            label="Date-Time Format"
            placeholder="yyyy-MM-dd HH:mm:ss"
            value={config.dateTimeFormat}
            onChange={(dateTimeFormat) => update({ dateTimeFormat })}
          />
          <FormCheckboxField
            label="Auto Wrap"
            checked={config.autoWrap ?? true}
            onChange={(autoWrap) => update({ autoWrap })}
          />
          <FormCheckboxField
            label="Reverse Video"
            checked={config.reverseVideo ?? false}
            onChange={(reverseVideo) => update({ reverseVideo })}
          />
          <FormNumberField
            label="Mouse Wheel Scroll Lines"
            placeholder="1"
            value={config.mouseWheelScrollLines}
            onChange={(mouseWheelScrollLines) => update({ mouseWheelScrollLines })}
          />
          <FormCheckboxField
            label="Fit On Resize"
            checked={config.fitOnResize ?? true}
            onChange={(fitOnResize) => update({ fitOnResize })}
          />
          <FormCheckboxField
            label="Sync Remote Title"
            checked={config.syncRemoteTitle ?? true}
            onChange={(syncRemoteTitle) => update({ syncRemoteTitle })}
          />
        </CollapsibleSection>
      )}

      {showKeyboard && (
        <CollapsibleSection title="Keyboard">
          <FormSelectField
            label="Backspace Sends"
            value={config.backspaceSends ?? "auto"}
            onChange={(v) =>
              update({ backspaceSends: v as SessionDisplayConfig["backspaceSends"] })
            }
            options={KEY_ACTION_OPTIONS}
          />
          <FormSelectField
            label="Delete Sends"
            value={config.deleteSends ?? "auto"}
            onChange={(v) => update({ deleteSends: v as SessionDisplayConfig["deleteSends"] })}
            options={KEY_ACTION_OPTIONS}
          />
          <FormCheckboxField
            label="Line Feed Mode"
            checked={config.lineFeedMode ?? false}
            onChange={(lineFeedMode) => update({ lineFeedMode })}
          />
          <FormSelectField
            label="Cursor Key Mode"
            value={config.cursorKeyMode ?? "normal"}
            onChange={(v) => update({ cursorKeyMode: v as SessionDisplayConfig["cursorKeyMode"] })}
            options={CURSOR_KEY_OPTIONS}
          />
          <FormSelectField
            label="Keypad Mode"
            value={config.keypadMode ?? "normal"}
            onChange={(v) => update({ keypadMode: v as SessionDisplayConfig["keypadMode"] })}
            options={KEYPAD_OPTIONS}
          />
          <FormSelectField
            label="Modify Other Keys Format"
            value={config.modifyOtherKeysFormat ?? "xterm"}
            onChange={(v) =>
              update({ modifyOtherKeysFormat: v as SessionDisplayConfig["modifyOtherKeysFormat"] })
            }
            options={MODIFY_OTHER_KEYS_OPTIONS}
          />
          <FormCheckboxField
            label="Alt Sends Escape"
            checked={config.altSendsEscape ?? true}
            onChange={(altSendsEscape) => update({ altSendsEscape })}
          />
        </CollapsibleSection>
      )}

      {showSecurity && (
        <CollapsibleSection title="Security">
          <FormSelectField
            label="Clipboard Read"
            value={config.clipboardRead ?? "ask"}
            onChange={(v) => update({ clipboardRead: v as SessionDisplayConfig["clipboardRead"] })}
            options={CLIPBOARD_OPTIONS}
          />
          <FormSelectField
            label="Clipboard Write"
            value={config.clipboardWrite ?? "ask"}
            onChange={(v) =>
              update({ clipboardWrite: v as SessionDisplayConfig["clipboardWrite"] })
            }
            options={CLIPBOARD_OPTIONS}
          />
        </CollapsibleSection>
      )}

      {showLogging && (
        <CollapsibleSection title="Logging">
          <FormCheckboxField
            label="Enabled"
            checked={logging.enabled ?? false}
            onChange={(enabled) => updateLogging({ enabled })}
          />
          <FormCheckboxField
            label="Append (vs Overwrite)"
            checked={logging.append ?? true}
            onChange={(append) => updateLogging({ append })}
          />
          <FormTextField
            label="File Name Template"
            placeholder="%n_%Y-%m-%d_%H-%M-%S.log"
            value={logging.fileNameTemplate}
            onChange={(fileNameTemplate) => updateLogging({ fileNameTemplate })}
          />
          <FormNumberField
            label="Max Size (MB)"
            placeholder="10"
            value={logging.maxSizeMb}
            onChange={(maxSizeMb) => updateLogging({ maxSizeMb })}
          />
          <FormTextField
            label="Line Format"
            placeholder="[%Y-%m-%d %H:%M:%S] %v"
            value={logging.lineFormat}
            onChange={(lineFormat) => updateLogging({ lineFormat })}
          />
        </CollapsibleSection>
      )}
    </div>
  );
}
