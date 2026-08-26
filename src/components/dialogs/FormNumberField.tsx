import { type ChangeEvent } from "react";
import { FormField } from "../ui/FormField";
import { parseOptionalInt, parseOptionalFloat } from "./formParsers";

interface FormNumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** When true, parse input as float instead of int. */
  float?: boolean;
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
  float,
}: FormNumberFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(float ? parseOptionalFloat(e.target.value) : parseOptionalInt(e.target.value));
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
