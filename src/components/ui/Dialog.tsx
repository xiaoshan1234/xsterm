import { ReactNode } from "react";
import {
  Dialog as MuiDialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Box,
} from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "small" | "medium";
}

export function Dialog({ isOpen, onClose, title, children, footer, size = "medium" }: DialogProps) {
  const maxWidth = size === "small" ? "xs" : "sm";

  return (
    <MuiDialog
      open={isOpen}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      slotProps={{ paper: { sx: { boxShadow: 24 } } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1 }}>
        <Box component="span" sx={{ fontSize: "1.15rem", fontWeight: 600 }}>{title}</Box>
        <IconButton onClick={onClose} aria-label="Close" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      {footer && <DialogActions sx={{ px: 3, py: 2 }}>{footer}</DialogActions>}
    </MuiDialog>
  );
}
