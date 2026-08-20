import { type ChangeEvent } from "react";
import { FormField } from "../ui/FormField";
import { narrowToLiteral } from "./formParsers";

export interface FormSelectOption {
  value: string;
  label: string;
}

interface FormSelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<FormSelectOption>;
  disabled?: boolean;
}

export function FormSelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: FormSelectFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onChange(narrowToLiteral(e.target.value, options));
  };
  return (
    <FormField label={label}>
      <select value={value} onChange={handleChange} disabled={disabled}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
