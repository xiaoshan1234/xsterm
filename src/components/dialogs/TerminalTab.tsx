import { type LocalSessionConfig, type SSHSessionConfig, type SessionDisplayConfig } from "../../types/session";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormCheckboxField } from "./FormCheckboxField";
import "./TerminalTab.css";

interface TerminalTabProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig) => void;
  connectionType: "local" | "ssh";
  localConfig: LocalSessionConfig;
  onLocalConfigChange: (config: LocalSessionConfig) => void;
  sshConfig: SSHSessionConfig;
  onSshConfigChange: (config: SSHSessionConfig) => void;
}



const TERMINAL_TYPES = [
  { value: "xterm-256color", label: "xterm-256color" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

const CHARSETS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK" },
];

export default function TerminalTab({
  config = {},
  onChange,
  connectionType,
  localConfig,
  onLocalConfigChange,
  sshConfig,
  onSshConfigChange,
}: TerminalTabProps) {
  const update = (patch: Partial<SessionDisplayConfig>) => {
    onChange({ ...config, ...patch });
  };

  const terminalSize = connectionType === "ssh"
    ? { cols: sshConfig.initialCols, rows: sshConfig.initialRows }
    : { cols: localConfig.initialCols, rows: localConfig.initialRows };

  const handleTerminalSizeChange = (cols: number | undefined, rows: number | undefined) => {
    if (connectionType === "ssh") {
      onSshConfigChange({ ...sshConfig, initialCols: cols, initialRows: rows });
    } else {
      onLocalConfigChange({ ...localConfig, initialCols: cols, initialRows: rows });
    }
  };

  return (
    <div className="terminal-tab">
      <div className="terminal-tab__group">
        <span className="terminal-tab__group-title">Terminal</span>
        <FormCheckboxField
          label="Show Line Numbers"
          checked={config.lineNumberEnabled ?? true}
          onChange={(lineNumberEnabled) => update({ lineNumberEnabled })}
        />
        <div className="terminal-tab__row">
          <FormNumberField
            label="Columns"
            placeholder="80"
            value={terminalSize.cols}
            onChange={(cols) => handleTerminalSizeChange(cols, terminalSize.rows)}
          />
          <FormNumberField
            label="Rows"
            placeholder="24"
            value={terminalSize.rows}
            onChange={(rows) => handleTerminalSizeChange(terminalSize.cols, rows)}
          />
        </div>
        <div className="terminal-tab__row">
          <FormNumberField
            label="Scrollback Lines"
            placeholder="(default)"
            value={config.scrollback}
            onChange={(scrollback) => update({ scrollback })}
          />
          <FormSelectField
            label="Terminal Type"
            value={config.terminalType ?? "xterm-256color"}
            onChange={(terminalType) => update({ terminalType })}
            options={TERMINAL_TYPES}
          />
        </div>
        <FormSelectField
          label="Charset"
          value={config.charset ?? "utf-8"}
          onChange={(charset) => update({ charset })}
          options={CHARSETS}
        />
      </div>
    </div>
  );
}
