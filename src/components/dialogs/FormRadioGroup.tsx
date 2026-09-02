import { type ChangeEvent, useId } from "react";
import { FormField } from "../ui/FormField";
import { narrowToLiteral } from "./formParsers";
import "./FormRadioGroup.css";

export interface FormRadioOption<T extends string> {
  value: T;
  label: string;
}

interface FormRadioGroupProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<FormRadioOption<T>>;
  disabled?: boolean;
  /** Optional name override; defaults to a stable id from useId(). */
  name?: string;
}

export function FormRadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
  name,
}: FormRadioGroupProps<T>) {
  const generatedId = useId();
  const groupName = name ?? generatedId;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(narrowToLiteral(e.target.value, options));
  };

  return (
    <FormField label={label}>
      <div className="form-radio-group__options" role="radiogroup" aria-label={label}>
        {options.map((opt) => {
          const id = `${groupName}-${opt.value}`;
          return (
            <label key={opt.value} className="form-radio-group__option" htmlFor={id}>
              <input
                id={id}
                type="radio"
                name={groupName}
                value={opt.value}
                checked={value === opt.value}
                onChange={handleChange}
                disabled={disabled}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </FormField>
  );
}