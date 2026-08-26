import { type SessionDisplayConfig, type SessionLoggingConfig } from "../../types/session";
import { FormCheckboxField } from "./FormCheckboxField";
import { FormNumberField } from "./FormNumberField";
import { FormTextField } from "./FormTextField";
import "./LoggingTab.css";

interface LoggingTabProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig) => void;
}

export default function LoggingTab({ config = {}, onChange }: LoggingTabProps) {
  const logging: SessionLoggingConfig = config.logging ?? {};

  const updateLogging = (patch: Partial<SessionLoggingConfig>) => {
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
    </div>
  );
}
