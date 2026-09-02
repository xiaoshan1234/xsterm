import { type LocalSessionConfig, type SSHSessionConfig, type SessionDisplayConfig } from "../../types/session";
import { FormNumberField } from "./FormNumberField";
import { FormRadioGroup } from "./FormRadioGroup";
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

const SIZING_OPTIONS = [
  { value: "auto", label: "Auto (fit to window)" },
  { value: "fixed", label: "Fixed (lock size)" },
] as const;

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

  // PTY startup size still uses `initialCols/Rows` from Local/SSH config.
  // In auto mode the startup size is only a one-shot hint; in fixed mode the
  // runtime size comes from `config.cols`/`rows` (the new displayConfig
  // fields), not the startup sizes — so we leave both surfaces editable.
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

  // Terminal Type (TERM env var) and Charset (LC_ALL env var) are PTY-side
  // settings, not xterm-render settings. They live on LocalSessionConfig /
  // SSHSessionConfig (consumed by Rust's `cmd.env("TERM", ...)` and the SSH
  // env negotiation), not on SessionDisplayConfig. Dispatch to the right
  // connection-specific config based on `connectionType`.
  const currentTermType = connectionType === "ssh" ? sshConfig.termType : localConfig.termType;
  const currentCharset = connectionType === "ssh" ? sshConfig.charset : localConfig.charset;
  const handleTermTypeChange = (termType: string) => {
    if (connectionType === "ssh") {
      onSshConfigChange({ ...sshConfig, termType });
    } else {
      onLocalConfigChange({ ...localConfig, termType });
    }
  };
  const handleCharsetChange = (charset: string) => {
    if (connectionType === "ssh") {
      onSshConfigChange({ ...sshConfig, charset });
    } else {
      onLocalConfigChange({ ...localConfig, charset });
    }
  };

  const sizingModeValue = config.sizingMode ?? "auto";
  const isFixed = sizingModeValue === "fixed";

  return (
    <div className="terminal-tab">
      <div className="terminal-tab__group">
        <span className="terminal-tab__group-title">Terminal</span>
        <FormCheckboxField
          label="Show Line Numbers"
          checked={config.lineNumberEnabled ?? true}
          onChange={(lineNumberEnabled) => update({ lineNumberEnabled })}
        />
        <FormRadioGroup
          label="Sizing Mode"
          value={sizingModeValue}
          onChange={(sizingMode) => update({ sizingMode })}
          options={SIZING_OPTIONS}
        />
        <div className="terminal-tab__hint">
          {isFixed
            ? "Terminal stays at the size below regardless of window."
            : "Initial size — terminal auto-fits when the window resizes."}
        </div>
        <div className="terminal-tab__row">
          <FormNumberField
            label="Columns"
            placeholder={isFixed ? "80" : "auto-fit"}
            value={isFixed ? config.cols : terminalSize.cols}
            disabled={!isFixed}
            min={1}
            max={isFixed ? 500 : 9999}
            onChange={(cols) =>
              isFixed
                ? update({ cols })
                : handleTerminalSizeChange(cols, terminalSize.rows)
            }
          />
          <FormNumberField
            label="Rows"
            placeholder={isFixed ? "24" : "auto-fit"}
            value={isFixed ? config.rows : terminalSize.rows}
            disabled={!isFixed}
            min={1}
            max={isFixed ? 200 : 9999}
            onChange={(rows) =>
              isFixed
                ? update({ rows })
                : handleTerminalSizeChange(terminalSize.cols, rows)
            }
          />
        </div>
        <div className="terminal-tab__row">
          <FormNumberField
            label="Scrollback Lines"
            placeholder="20000"
            value={config.scrollback}
            onChange={(scrollback) => update({ scrollback })}
          />
          <FormSelectField
            label="Terminal Type"
            value={currentTermType ?? "xterm-256color"}
            onChange={handleTermTypeChange}
            options={TERMINAL_TYPES}
          />
        </div>
        <FormSelectField
          label="Charset"
          value={currentCharset ?? "utf-8"}
          onChange={handleCharsetChange}
          options={CHARSETS}
        />
      </div>
    </div>
  );
}
