import { type TerminalDisplayConfig, type TerminalLoggingConfig } from "../../../types/terminal";
import { FormCheckboxField } from "../../../shared/ui/FormCheckboxField";
import { FormNumberField } from "../../../shared/ui/FormNumberField";
import { FormTextField } from "../../../shared/ui/FormTextField";
import "./LoggingTab.css";

interface LoggingTabProps {
  config?: TerminalDisplayConfig;
  onChange: (config: TerminalDisplayConfig) => void;
}

export default function LoggingTab({ config = {}, onChange }: LoggingTabProps) {
  const logging: TerminalLoggingConfig = config.logging ?? {};

  const updateLogging = (patch: Partial<TerminalLoggingConfig>) => {
    onChange({ ...config, logging: { ...logging, ...patch } });
  };

  return (
    <div className="logging-tab">
      <span className="logging-tab__group-title">Log Output</span>
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
        placeholder="{{name}}_{{ts:%Y-%m-%d_%H-%M-%S}}.log"
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
        placeholder="[{{ts}}] {{line}}"
        value={logging.lineFormat}
        onChange={(lineFormat) => updateLogging({ lineFormat })}
      />
    </div>
  );
}
