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
}

export function FormTextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  autoComplete,
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
      />
    </FormField>
  );
}
