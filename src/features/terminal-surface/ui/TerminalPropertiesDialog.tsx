import type { ReactNode } from "react";
import type { TerminalProperties } from "../../../models";
import { Dialog, type DialogTab } from "../../../shared/ui/Dialog";
import { FormCheckboxField } from "../../../shared/ui/FormCheckboxField";
import { FormNumberField } from "../../../shared/ui/FormNumberField";
import { FormRadioGroup } from "../../../shared/ui/FormRadioGroup";
import { FormSelectField } from "../../../shared/ui/FormSelectField";
import { AppearanceIcon, TerminalIcon } from "../../../shared/icons/Icon";
import "./TerminalPropertiesDialog.css";

interface TerminalPropertiesDialogProps {
  isOpen: boolean;
  terminalName: string;
  properties: TerminalProperties;
  onChange: (patch: Partial<TerminalProperties>) => void;
  onClose: () => void;
}

const FONT_FAMILIES = [
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Default (Menlo)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, monospace", label: "Consolas" },
];

const CURSOR_STYLES = [
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

const SIZING_MODES = [
  { value: "auto", label: "Auto (fit to pane)" },
  { value: "fixed", label: "Fixed (lock size)" },
] as const;

function PropertyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="terminal-properties__group">
      <h3 className="terminal-properties__group-title">{title}</h3>
      {children}
    </section>
  );
}

export function TerminalPropertiesDialog({
  isOpen,
  terminalName,
  properties,
  onChange,
  onClose,
}: TerminalPropertiesDialogProps) {
  const update = (patch: Partial<TerminalProperties>) => onChange(patch);
  const isFixed = (properties.sizingMode ?? "auto") === "fixed";

  const appearance = (
    <div className="terminal-properties">
      <p className="terminal-properties__hint">
        Changes apply to this terminal immediately and do not modify its launch configuration.
      </p>
      <PropertyGroup title="Typography">
        <div className="terminal-properties__row">
          <FormNumberField
            label="Font Size"
            placeholder="14"
            value={properties.fontSize}
            min={6}
            max={72}
            onChange={(fontSize) => update({ fontSize })}
          />
          <FormSelectField
            label="Font Family"
            value={properties.fontFamily ?? FONT_FAMILIES[0].value}
            onChange={(fontFamily) => update({ fontFamily })}
            options={FONT_FAMILIES}
          />
        </div>
        <div className="terminal-properties__row">
          <FormNumberField
            label="Line Height"
            placeholder="1"
            step={0.1}
            float
            value={properties.lineHeight}
            onChange={(lineHeight) => update({ lineHeight })}
          />
          <FormNumberField
            label="Letter Spacing"
            placeholder="0"
            step={0.1}
            float
            value={properties.letterSpacing}
            onChange={(letterSpacing) => update({ letterSpacing })}
          />
        </div>
      </PropertyGroup>

      <PropertyGroup title="Cursor">
        <div className="terminal-properties__row">
          <FormSelectField
            label="Cursor Style"
            value={properties.cursorStyle ?? CURSOR_STYLES[0].value}
            onChange={(cursorStyle) =>
              update({ cursorStyle: cursorStyle as TerminalProperties["cursorStyle"] })
            }
            options={CURSOR_STYLES}
          />
          <FormCheckboxField
            label="Cursor Blink"
            checked={properties.cursorBlink ?? true}
            onChange={(cursorBlink) => update({ cursorBlink })}
          />
        </div>
        <FormNumberField
          label="Cursor Width"
          placeholder="1"
          value={properties.cursorWidth}
          min={1}
          max={8}
          onChange={(cursorWidth) => update({ cursorWidth })}
        />
      </PropertyGroup>
    </div>
  );

  const terminal = (
    <div className="terminal-properties">
      <p className="terminal-properties__hint">
        Changes apply to this terminal immediately and do not modify its launch configuration.
      </p>
      <PropertyGroup title="Display">
        <FormCheckboxField
          label="Show Gutter"
          checked={properties.gutterEnabled ?? true}
          onChange={(gutterEnabled) => update({ gutterEnabled })}
        />
        <FormNumberField
          label="Scrollback Lines"
          placeholder="20000"
          value={properties.scrollback}
          min={0}
          max={1000000}
          onChange={(scrollback) => update({ scrollback })}
        />
      </PropertyGroup>

      <PropertyGroup title="Size">
        <FormRadioGroup
          label="Sizing Mode"
          value={properties.sizingMode ?? "auto"}
          onChange={(sizingMode) =>
            update({
              sizingMode,
              ...(sizingMode === "fixed"
                ? {
                    cols: properties.cols ?? 80,
                    rows: properties.rows ?? 24,
                  }
                : {}),
            })
          }
          options={SIZING_MODES}
        />
        <div className="terminal-properties__row">
          <FormNumberField
            label="Columns"
            placeholder="auto-fit"
            value={isFixed ? properties.cols : undefined}
            disabled={!isFixed}
            min={1}
            max={500}
            onChange={(cols) => update({ cols })}
          />
          <FormNumberField
            label="Rows"
            placeholder="auto-fit"
            value={isFixed ? properties.rows : undefined}
            disabled={!isFixed}
            min={1}
            max={200}
            onChange={(rows) => update({ rows })}
          />
        </div>
      </PropertyGroup>
    </div>
  );

  const tabs: DialogTab[] = [
    {
      id: "appearance",
      label: "Appearance",
      icon: <AppearanceIcon size={16} />,
      content: appearance,
    },
    { id: "terminal", label: "Terminal", icon: <TerminalIcon size={16} />, content: terminal },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Terminal Properties — ${terminalName}`}
      className="terminal-properties-dialog"
      tabs={tabs}
      footer={
        <div className="dialog-footer-buttons">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    />
  );
}
