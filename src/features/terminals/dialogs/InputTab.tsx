import { type TerminalDisplayConfig } from "../../../types/terminal";
import { FormCheckboxField } from "../../../shared/ui/FormCheckboxField";
import { FormRadioGroup } from "../../../shared/ui/FormRadioGroup";
import "./InputTab.css";

interface InputTabProps {
  displayConfig?: TerminalDisplayConfig;
  onDisplayChange: (config: TerminalDisplayConfig) => void;
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

export default function InputTab({ displayConfig = {}, onDisplayChange }: InputTabProps) {
  const updateDisplay = (patch: Partial<TerminalDisplayConfig>) => {
    onDisplayChange({ ...displayConfig, ...patch });
  };

  return (
    <div className="input-tab">
      <div className="input-tab__section">
        <h3 className="input-tab__section-title">Keyboard</h3>
        <div className="input-tab__section-content">
          {/* Backspace + Delete — full-width radio rows, stacked.
           * Each row uses the same --space-base gap (16px) that other rows
           * in this section get from .input-tab__section-content. */}
          <FormRadioGroup
            label="Backspace Sends"
            value={displayConfig.backspaceSends ?? "auto"}
            onChange={(v) =>
              updateDisplay({ backspaceSends: v as TerminalDisplayConfig["backspaceSends"] })
            }
            options={KEY_ACTION_OPTIONS}
          />
          <FormRadioGroup
            label="Delete Sends"
            value={displayConfig.deleteSends ?? "auto"}
            onChange={(v) =>
              updateDisplay({ deleteSends: v as TerminalDisplayConfig["deleteSends"] })
            }
            options={KEY_ACTION_OPTIONS}
          />

          <FormRadioGroup
            label="Cursor Key Mode"
            value={displayConfig.cursorKeyMode ?? "normal"}
            onChange={(v) =>
              updateDisplay({ cursorKeyMode: v as TerminalDisplayConfig["cursorKeyMode"] })
            }
            options={CURSOR_KEY_OPTIONS}
          />
          <FormRadioGroup
            label="Keypad Mode"
            value={displayConfig.keypadMode ?? "normal"}
            onChange={(v) =>
              updateDisplay({ keypadMode: v as TerminalDisplayConfig["keypadMode"] })
            }
            options={KEYPAD_OPTIONS}
          />

          <FormCheckboxField
            label="Alt Sends Escape"
            checked={displayConfig.altSendsEscape ?? true}
            onChange={(altSendsEscape) => updateDisplay({ altSendsEscape })}
          />
        </div>
      </div>

      <div className="input-tab__section">
        <h3 className="input-tab__section-title">Clipboard</h3>
        <div className="input-tab__section-content">
          <FormRadioGroup
            label="Clipboard Read"
            value={displayConfig.clipboardRead ?? "ask"}
            onChange={(v) =>
              updateDisplay({ clipboardRead: v as TerminalDisplayConfig["clipboardRead"] })
            }
            options={CLIPBOARD_OPTIONS}
          />
          <FormRadioGroup
            label="Clipboard Write"
            value={displayConfig.clipboardWrite ?? "ask"}
            onChange={(v) =>
              updateDisplay({ clipboardWrite: v as TerminalDisplayConfig["clipboardWrite"] })
            }
            options={CLIPBOARD_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
}
