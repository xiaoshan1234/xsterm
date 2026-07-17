import { TerminalConfig } from "../../types/session";
import { FormField } from "../ui/FormField";
import "./TerminalConfigForm.css";

interface TerminalConfigFormProps {
  value: TerminalConfig;
  onChange: (value: TerminalConfig) => void;
  disabled?: boolean;
}

const DEFAULT_SCROLLBACK = 5000;
const MAX_SCROLLBACK = 100000;

function parseScrollback(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_SCROLLBACK;
  }
  return parsed;
}

export function TerminalConfigForm({ value, onChange, disabled }: TerminalConfigFormProps) {
  return (
    <div className="terminal-config-form">
      <FormField label="Scrollback Lines">
        <input
          type="number"
          min={0}
          max={MAX_SCROLLBACK}
          value={value.scrollbackLines}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              scrollbackLines: parseScrollback(e.target.value),
            })
          }
        />
      </FormField>
      <FormField label="Auto-Log Path">
        <input
          type="text"
          placeholder="Log file path (empty to disable)"
          value={value.autoLogPath}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              autoLogPath: e.target.value,
            })
          }
        />
      </FormField>
      <FormField label="Highlight Keywords">
        <input
          type="text"
          placeholder="comma-separated keywords"
          value={value.highlightKeywords}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              highlightKeywords: e.target.value,
            })
          }
        />
      </FormField>
    </div>
  );
}
