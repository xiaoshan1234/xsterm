import {
  SessionDisplayConfig,
  SessionLoggingConfig,
} from "../../types/session";
import { FormField } from "../ui/FormField";
import "./CommonSettingsForm.css";

interface CommonSettingsFormProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig) => void;
}

// --- Enum option lists (display labels + value literals) ---

const KEY_ACTION_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "backspace", label: "Backspace (^H)" },
  { value: "delete", label: "Delete (^?)" },
];

const CURSOR_KEY_OPTIONS = [
  { value: "normal", label: "Normal (ANSI cursor keys)" },
  { value: "application", label: "Application (DECCKM)" },
];

const KEYPAD_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "application", label: "Application (DECNKM)" },
];

const MODIFY_OTHER_KEYS_OPTIONS = [
  { value: "xterm", label: "xterm (CSI u)" },
  { value: "fixterm", label: "fixterm (CSI ? u)" },
];

const CLIPBOARD_OPTIONS = [
  { value: "ask", label: "Ask each time" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

export function CommonSettingsForm({ config = {}, onChange }: CommonSettingsFormProps) {
  const update = (patch: Partial<SessionDisplayConfig>) => {
    onChange({ ...config, ...patch });
  };

  const logging: SessionLoggingConfig = config.logging ?? {};
  const updateLogging = (patch: Partial<SessionLoggingConfig>) => {
    update({ logging: { ...logging, ...patch } });
  };

  return (
    <div className="common-settings-form">
      {/* --- Display ------------------------------------------------------- */}
      <details className="common-settings-group" open>
        <summary className="common-settings-group__title">Display</summary>
        <div className="common-settings-group__content">
          <FormField label="Line Timestamp">
            <input
              type="checkbox"
              checked={config.lineTimestamp ?? false}
              onChange={(e) => update({ lineTimestamp: e.target.checked })}
            />
          </FormField>
          <FormField label="Time Format">
            <input
              type="text"
              placeholder="[HH:mm:ss]"
              value={config.timeFormat ?? ""}
              onChange={(e) => update({ timeFormat: e.target.value || undefined })}
            />
          </FormField>
          <FormField label="Date-Time Format">
            <input
              type="text"
              placeholder="yyyy-MM-dd HH:mm:ss"
              value={config.dateTimeFormat ?? ""}
              onChange={(e) =>
                update({ dateTimeFormat: e.target.value || undefined })
              }
            />
          </FormField>
          <FormField label="Auto Wrap">
            <input
              type="checkbox"
              checked={config.autoWrap ?? true}
              onChange={(e) => update({ autoWrap: e.target.checked })}
            />
          </FormField>
          <FormField label="Reverse Video">
            <input
              type="checkbox"
              checked={config.reverseVideo ?? false}
              onChange={(e) => update({ reverseVideo: e.target.checked })}
            />
          </FormField>
          <FormField label="Mouse Wheel Scroll Lines">
            <input
              type="number"
              placeholder="1"
              value={config.mouseWheelScrollLines ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                update({
                  mouseWheelScrollLines: v ? parseInt(v, 10) : undefined,
                });
              }}
            />
          </FormField>
          <FormField label="Fit On Resize">
            <input
              type="checkbox"
              checked={config.fitOnResize ?? true}
              onChange={(e) => update({ fitOnResize: e.target.checked })}
            />
          </FormField>
          <FormField label="Sync Remote Title">
            <input
              type="checkbox"
              checked={config.syncRemoteTitle ?? true}
              onChange={(e) => update({ syncRemoteTitle: e.target.checked })}
            />
          </FormField>
        </div>
      </details>

      {/* --- Keyboard ------------------------------------------------------ */}
      <details className="common-settings-group" open>
        <summary className="common-settings-group__title">Keyboard</summary>
        <div className="common-settings-group__content">
          <FormField label="Backspace Sends">
            <select
              value={config.backspaceSends ?? "auto"}
              onChange={(e) =>
                update({
                  backspaceSends: e.target.value as
                    | "auto"
                    | "backspace"
                    | "delete",
                })
              }
            >
              {KEY_ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Delete Sends">
            <select
              value={config.deleteSends ?? "auto"}
              onChange={(e) =>
                update({
                  deleteSends: e.target.value as "auto" | "backspace" | "delete",
                })
              }
            >
              {KEY_ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Line Feed Mode">
            <input
              type="checkbox"
              checked={config.lineFeedMode ?? false}
              onChange={(e) => update({ lineFeedMode: e.target.checked })}
            />
          </FormField>
          <FormField label="Cursor Key Mode">
            <select
              value={config.cursorKeyMode ?? "normal"}
              onChange={(e) =>
                update({
                  cursorKeyMode: e.target.value as "normal" | "application",
                })
              }
            >
              {CURSOR_KEY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Keypad Mode">
            <select
              value={config.keypadMode ?? "normal"}
              onChange={(e) =>
                update({
                  keypadMode: e.target.value as "normal" | "application",
                })
              }
            >
              {KEYPAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Modify Other Keys Format">
            <select
              value={config.modifyOtherKeysFormat ?? "xterm"}
              onChange={(e) =>
                update({
                  modifyOtherKeysFormat: e.target.value as "xterm" | "fixterm",
                })
              }
            >
              {MODIFY_OTHER_KEYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Alt Sends Escape">
            <input
              type="checkbox"
              checked={config.altSendsEscape ?? true}
              onChange={(e) => update({ altSendsEscape: e.target.checked })}
            />
          </FormField>
        </div>
      </details>

      {/* --- Security ------------------------------------------------------ */}
      <details className="common-settings-group" open>
        <summary className="common-settings-group__title">Security</summary>
        <div className="common-settings-group__content">
          <FormField label="Clipboard Read">
            <select
              value={config.clipboardRead ?? "ask"}
              onChange={(e) =>
                update({
                  clipboardRead: e.target.value as "ask" | "allow" | "deny",
                })
              }
            >
              {CLIPBOARD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Clipboard Write">
            <select
              value={config.clipboardWrite ?? "ask"}
              onChange={(e) =>
                update({
                  clipboardWrite: e.target.value as "ask" | "allow" | "deny",
                })
              }
            >
              {CLIPBOARD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </details>

      {/* --- Logging ------------------------------------------------------- */}
      <details className="common-settings-group" open>
        <summary className="common-settings-group__title">Logging</summary>
        <div className="common-settings-group__content">
          <FormField label="Enabled">
            <input
              type="checkbox"
              checked={logging.enabled ?? false}
              onChange={(e) => updateLogging({ enabled: e.target.checked })}
            />
          </FormField>
          <FormField label="Append (vs Overwrite)">
            <input
              type="checkbox"
              checked={logging.append ?? true}
              onChange={(e) => updateLogging({ append: e.target.checked })}
            />
          </FormField>
          <FormField label="File Name Template">
            <input
              type="text"
              placeholder="%n_%Y-%m-%d_%H-%M-%S.log"
              value={logging.fileNameTemplate ?? ""}
              onChange={(e) =>
                updateLogging({
                  fileNameTemplate: e.target.value || undefined,
                })
              }
            />
          </FormField>
          <FormField label="Max Size (MB)">
            <input
              type="number"
              placeholder="10"
              value={logging.maxSizeMb ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                updateLogging({ maxSizeMb: v ? parseInt(v, 10) : undefined });
              }}
            />
          </FormField>
          <FormField label="Line Format">
            <input
              type="text"
              placeholder="[%Y-%m-%d %H:%M:%S] %v"
              value={logging.lineFormat ?? ""}
              onChange={(e) =>
                updateLogging({ lineFormat: e.target.value || undefined })
              }
            />
          </FormField>
        </div>
      </details>
    </div>
  );
}
