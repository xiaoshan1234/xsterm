import { type ChangeEvent } from "react";
import { FormField } from "../ui/FormField";
import { parseOptionalInt } from "./formParsers";

interface FormNumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export function FormNumberField({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  disabled,
}: FormNumberFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(parseOptionalInt(e.target.value));
  };
  return (
    <FormField label={label}>
      <input
        type="number"
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={handleChange}
        disabled={disabled}
      />
    </FormField>
  );
}
