import { type LocalSessionConfig, type SSHSessionConfig, type SessionDisplayConfig } from "../../types/session";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormCheckboxField } from "./FormCheckboxField";
import "./AppearanceTab.css";

interface AppearanceTabProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig) => void;
  connectionType: "local" | "ssh";
  localConfig: LocalSessionConfig;
  onLocalConfigChange: (config: LocalSessionConfig) => void;
  sshConfig: SSHSessionConfig;
  onSshConfigChange: (config: SSHSessionConfig) => void;
}

const FONT_FAMILIES = [
  { value: "", label: "(use global default)" },
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Default (Menlo)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, monospace", label: "Consolas" },
];

const CURSOR_STYLES = [
  { value: "", label: "(use global default)" },
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

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

export default function AppearanceTab({
  config = {},
  onChange,
  connectionType,
  localConfig,
  onLocalConfigChange,
  sshConfig,
  onSshConfigChange,
}: AppearanceTabProps) {
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
    <div className="appearance-tab">
      <div className="appearance-tab__group">
        <span className="appearance-tab__group-title">Typography</span>
        <div className="appearance-tab__row">
          <FormNumberField
            label="Font Size"
            placeholder="14"
            value={config.fontSize}
            onChange={(fontSize) => update({ fontSize })}
          />
          <FormSelectField
            label="Font Family"
            value={config.fontFamily ?? ""}
            onChange={(fontFamily) => update({ fontFamily: fontFamily || undefined })}
            options={FONT_FAMILIES}
          />
        </div>
        <div className="appearance-tab__row">
          <FormNumberField
            label="Line Height"
            placeholder="(default)"
            step={0.1}
            float
            value={config.lineHeight}
            onChange={(lineHeight) => update({ lineHeight })}
          />
          <FormNumberField
            label="Letter Spacing"
            placeholder="(default)"
            step={0.1}
            float
            value={config.letterSpacing}
            onChange={(letterSpacing) => update({ letterSpacing })}
          />
        </div>
      </div>

      <div className="appearance-tab__group">
        <span className="appearance-tab__group-title">Cursor</span>
        <div className="appearance-tab__row">
          <FormSelectField
            label="Cursor Style"
            value={config.cursorStyle ?? ""}
            onChange={(v) =>
              update({ cursorStyle: (v || undefined) as SessionDisplayConfig["cursorStyle"] })
            }
            options={CURSOR_STYLES}
          />
          <FormCheckboxField
            label="Cursor Blink"
            checked={config.cursorBlink ?? false}
            onChange={(cursorBlink) => update({ cursorBlink })}
          />
        </div>
        <FormNumberField
          label="Cursor Width"
          placeholder="(default)"
          value={config.cursorWidth}
          onChange={(cursorWidth) => update({ cursorWidth })}
        />
      </div>

      <div className="appearance-tab__group">
        <span className="appearance-tab__group-title">Terminal</span>
        <div className="appearance-tab__row">
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
        <div className="appearance-tab__row">
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
