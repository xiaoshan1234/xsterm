import { SessionTypeKind } from "../../types/session";
import "./ProtocolTabs.css";

interface TabDef {
  label: string;
  value: SessionTypeKind;
  implemented: boolean;
}

const TABS: TabDef[] = [
  { label: "Shell", value: "local", implemented: true },
  { label: "SSH", value: "ssh", implemented: true },
  { label: "Telnet", value: "telnet", implemented: false },
  { label: "Tcp", value: "tcp", implemented: false },
  { label: "Serial", value: "serial", implemented: false },
];

interface ProtocolTabsProps {
  value: SessionTypeKind;
  onChange: (type: SessionTypeKind) => void;
  disabled?: boolean;
}

export function ProtocolTabs({ value, onChange, disabled }: ProtocolTabsProps) {
  return (
    <div
      className={`protocol-tabs ${disabled ? "protocol-tabs--disabled" : ""}`}
      role="tablist"
      aria-label="Session protocol"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === value;
        const isDisabled = disabled || !tab.implemented;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            className={`protocol-tab ${isActive ? "protocol-tab--active" : ""}`}
            disabled={isDisabled}
            title={!tab.implemented ? "Not implemented" : undefined}
            onClick={() => onChange(tab.value)}
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
