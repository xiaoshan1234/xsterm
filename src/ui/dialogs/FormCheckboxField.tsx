import { type ChangeEvent } from "react";
import { FormField } from "../primitives/FormField";

interface FormCheckboxFieldProps {
  label: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  disabled?: boolean;
}

export function FormCheckboxField({
  label,
  isChecked,
  onChange,
  disabled,
}: FormCheckboxFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };
  return (
    <FormField label={label}>
      <input type="checkbox" checked={isChecked} onChange={handleChange} disabled={disabled} />
    </FormField>
  );
}
