import { SessionTypeKind } from "../../types/session";
import { FormField } from "../ui/FormField";
import "./SessionTypeSelector.css";

interface SessionTypeSelectorProps {
  value: SessionTypeKind;
  onChange: (value: SessionTypeKind) => void;
  disabled?: boolean;
  mode?: "create" | "edit";
}

export const ALL_SESSION_TYPES: SessionTypeKind[] = ["local", "ssh", "tcp", "serial", "telnet"];

export const IMPLEMENTED_TYPES = ["local", "ssh"] as const;

export function isImplementedType(type: SessionTypeKind): boolean {
  return (IMPLEMENTED_TYPES as readonly string[]).includes(type);
}

export function SessionTypeSelector({ value, onChange, disabled }: SessionTypeSelectorProps) {
  return (
    <div className="session-type-selector">
      <FormField label="Session Type">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as SessionTypeKind)}
        >
          {ALL_SESSION_TYPES.map((type) => (
            <option key={type} value={type} disabled={!isImplementedType(type)}>
              {formatSessionType(type)}
            </option>
          ))}
        </select>
      </FormField>
      {!isImplementedType(value) && (
        <span className="session-type-selector__hint">{formatHint(value)}</span>
      )}
    </div>
  );
}

function formatSessionType(type: SessionTypeKind): string {
  switch (type) {
    case "local":
      return "Local Shell";
    case "ssh":
      return "SSH";
    case "tcp":
      return "TCP";
    case "serial":
      return "Serial";
    case "telnet":
      return "Telnet";
  }
}

function formatHint(type: SessionTypeKind): string {
  return `${formatSessionType(type)} is not implemented yet.`;
}
