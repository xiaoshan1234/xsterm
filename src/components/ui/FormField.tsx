import { ReactNode } from "react";
import { FormControl, InputLabel, Box } from "@mui/material";

interface FormFieldProps {
  label: string;
  children: ReactNode;
}

export function FormField({ label, children }: FormFieldProps) {
  return (
    <FormControl fullWidth sx={{ mb: 2 }}>
      <InputLabel shrink sx={{ position: "relative", transform: "none", mb: 0.5, fontSize: "0.875rem", fontWeight: 500 }}>
        {label}
      </InputLabel>
      <Box>{children}</Box>
    </FormControl>
  );
}
