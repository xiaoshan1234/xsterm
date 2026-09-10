import { type ChangeEvent } from "react";
import { FormField } from "../ui/FormField";

interface FormTextFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  type?: "text" | "password";
  disabled?: boolean;
  autoComplete?: string;
  /** Forward the native `required` HTML attribute (UX cue + form validation). */
  required?: boolean;
  /** Optional muted helper text rendered below the input (e.g. "Required."). */
  helperText?: string;
}

export function FormTextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  autoComplete,
  required,
  helperText,
}: FormTextFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value || undefined);
  };
  return (
    <FormField label={label}>
      <input
        type={type}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={handleChange}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
      />
      {helperText && <span className="form-field__helper">{helperText}</span>}
    </FormField>
  );
}
