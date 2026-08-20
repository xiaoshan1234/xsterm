import { type ChangeEvent } from "react";
import { FormField } from "../ui/FormField";

interface FormCheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function FormCheckboxField({ label, checked, onChange, disabled }: FormCheckboxFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };
  return (
    <FormField label={label}>
      <input type="checkbox" checked={checked} onChange={handleChange} disabled={disabled} />
    </FormField>
  );
}
