import { FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Switch, TextField } from "@mui/material";
import { SessionDisplayConfig } from "../../types/session";

interface DisplayConfigFormProps {
  config?: SessionDisplayConfig;
  onChange: (config: SessionDisplayConfig | undefined) => void;
}

const CURSOR_STYLES = [
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

const FONT_FAMILIES = [
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Default (Menlo)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, monospace", label: "Consolas" },
];

export function DisplayConfigForm({ config = {}, onChange }: DisplayConfigFormProps) {
  const update = (patch: Partial<SessionDisplayConfig>) => onChange({ ...config, ...patch });

  return (
    <Stack spacing={2}>
      <TextField fullWidth type="number" label="Font Size" placeholder="14" value={config.fontSize ?? ""} onChange={(e) => { const v = e.target.value; update({ fontSize: v ? parseFloat(v) : undefined }); }} />

      <FormControl fullWidth>
        <InputLabel id="font-family-label">Font Family</InputLabel>
        <Select labelId="font-family-label" label="Font Family" value={config.fontFamily || ""} onChange={(e) => update({ fontFamily: e.target.value || undefined })}>
          <MenuItem value="">(use global default)</MenuItem>
          {FONT_FAMILIES.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
        </Select>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel id="cursor-style-label">Cursor Style</InputLabel>
        <Select labelId="cursor-style-label" label="Cursor Style" value={config.cursorStyle || ""} onChange={(e) => update({ cursorStyle: e.target.value === "" ? undefined : (e.target.value as "block" | "underline" | "bar") })}>
          <MenuItem value="">(use global default)</MenuItem>
          {CURSOR_STYLES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
        </Select>
      </FormControl>

      <FormControlLabel control={<Switch checked={config.cursorBlink ?? false} onChange={(e) => update({ cursorBlink: e.target.checked })} />} label="Cursor Blink" />

      <TextField fullWidth type="number" label="Scrollback Lines" placeholder="(default)" value={config.scrollback ?? ""} onChange={(e) => { const v = e.target.value; update({ scrollback: v ? parseInt(v) : undefined }); }} />
      <TextField fullWidth type="number" label="Line Height" placeholder="(default)" inputProps={{ step: 0.1 }} value={config.lineHeight ?? ""} onChange={(e) => { const v = e.target.value; update({ lineHeight: v ? parseFloat(v) : undefined }); }} />
      <TextField fullWidth type="number" label="Letter Spacing" placeholder="(default)" inputProps={{ step: 0.1 }} value={config.letterSpacing ?? ""} onChange={(e) => { const v = e.target.value; update({ letterSpacing: v ? parseFloat(v) : undefined }); }} />
      <TextField fullWidth type="number" label="Cursor Width" placeholder="(default)" value={config.cursorWidth ?? ""} onChange={(e) => { const v = e.target.value; update({ cursorWidth: v ? parseInt(v) : undefined }); }} />
    </Stack>
  );
}
