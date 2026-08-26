import { type SessionDisplayConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormSelectField } from "./FormSelectField";
import "./TerminalTab.css";

interface TerminalTabProps {
  displayConfig?: SessionDisplayConfig;
  onDisplayChange: (config: SessionDisplayConfig) => void;
}

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

const CLIPBOARD_OPTIONS = [
  { value: "ask", label: "Ask each time" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
] as const;

export default function TerminalTab({
  displayConfig = {},
  onDisplayChange,
}: TerminalTabProps) {
  const updateDisplay = (patch: Partial<SessionDisplayConfig>) => {
    onDisplayChange({ ...displayConfig, ...patch });
  };

  return (
    <div className="terminal-tab">
      <div className="terminal-tab__section">
        <h3 className="terminal-tab__section-title">Keyboard</h3>
        <div className="terminal-tab__section-content">
          <div className="terminal-tab__two-col">
            <FormSelectField
              label="Backspace Sends"
              value={displayConfig.backspaceSends ?? "auto"}
              onChange={(v) =>
                updateDisplay({ backspaceSends: v as SessionDisplayConfig["backspaceSends"] })
              }
              options={KEY_ACTION_OPTIONS}
            />
            <FormSelectField
              label="Delete Sends"
              value={displayConfig.deleteSends ?? "auto"}
              onChange={(v) =>
                updateDisplay({ deleteSends: v as SessionDisplayConfig["deleteSends"] })
              }
              options={KEY_ACTION_OPTIONS}
            />
          </div>

          <div className="terminal-tab__two-col">
            <FormSelectField
              label="Cursor Key Mode"
              value={displayConfig.cursorKeyMode ?? "normal"}
              onChange={(v) =>
                updateDisplay({ cursorKeyMode: v as SessionDisplayConfig["cursorKeyMode"] })
              }
              options={CURSOR_KEY_OPTIONS}
            />
            <FormSelectField
              label="Keypad Mode"
              value={displayConfig.keypadMode ?? "normal"}
              onChange={(v) =>
                updateDisplay({ keypadMode: v as SessionDisplayConfig["keypadMode"] })
              }
              options={KEYPAD_OPTIONS}
            />
          </div>

          <FormCheckboxField
            label="Alt Sends Escape"
            checked={displayConfig.altSendsEscape ?? true}
            onChange={(altSendsEscape) => updateDisplay({ altSendsEscape })}
          />
        </div>
      </div>

      <div className="terminal-tab__section">
        <h3 className="terminal-tab__section-title">Clipboard</h3>
        <div className="terminal-tab__section-content">
          <div className="terminal-tab__two-col">
            <FormSelectField
              label="Clipboard Read"
              value={displayConfig.clipboardRead ?? "ask"}
              onChange={(v) =>
                updateDisplay({ clipboardRead: v as SessionDisplayConfig["clipboardRead"] })
              }
              options={CLIPBOARD_OPTIONS}
            />
            <FormSelectField
              label="Clipboard Write"
              value={displayConfig.clipboardWrite ?? "ask"}
              onChange={(v) =>
                updateDisplay({ clipboardWrite: v as SessionDisplayConfig["clipboardWrite"] })
              }
              options={CLIPBOARD_OPTIONS}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
