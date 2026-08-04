import {
  Box,
  Typography,
  FormControl,
  FormControlLabel,
  RadioGroup,
  Radio,
  Switch,
  Select,
  MenuItem,
  Chip,
} from "@mui/material";
import { useTheme } from "../../contexts/ThemeContext";
import { useSession } from "../../contexts/SessionContext";
import { useAppTheme, ThemeMode } from "../../hooks/useAppTheme";
import { PRESET_THEMES } from "../../types/theme";

const SHORTCUTS = [
  { label: "New session", keys: "Ctrl+Shift+N" },
  { label: "Next tab", keys: "Ctrl+Tab" },
  { label: "Previous tab", keys: "Ctrl+Shift+Tab" },
  { label: "Close current tab", keys: "Ctrl+W" },
  { label: "Open settings", keys: "Ctrl+," },
];

const CHROME_THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Follow System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export type SettingsCategory = "appearance" | "shortcuts" | "about";

interface SettingsViewProps {
  activeCategory?: SettingsCategory;
}

export function SettingsView({ activeCategory = "appearance" }: SettingsViewProps) {
  const { currentTheme, currentThemeKey, setTheme, themeKeys } = useTheme();
  const { globalLocalEcho, setGlobalLocalEcho } = useSession();
  const { mode, setMode } = useAppTheme();
  return (
    <Box
      sx={{
        flex: 1,
        height: "100%",
        minHeight: 0,
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          height: "100%",
          overflowY: "auto",
          p: 3,
        }}
      >
        {activeCategory === "appearance" && (
          <Box sx={{ maxWidth: 600, mb: 4 }}>
            <Typography
              variant="h5"
              sx={{ color: "text.primary", mb: 2 }}
            >
              Appearance
            </Typography>

            {/* Chrome theme override */}
            <FormControl sx={{ mb: 3 }}>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", mb: 1, fontWeight: 500 }}
              >
                Chrome theme
              </Typography>
              <RadioGroup
                row
                value={mode}
                onChange={(e) => setMode(e.target.value as ThemeMode)}
              >
                {CHROME_THEME_OPTIONS.map((opt) => (
                  <FormControlLabel
                    key={opt.value}
                    value={opt.value}
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="body2">{opt.label}</Typography>
                    }
                    sx={{
                      mr: 2,
                      "& .MuiFormControlLabel-label": { fontSize: "0.8125rem" },
                    }}
                  />
                ))}
              </RadioGroup>
            </FormControl>

            {/* Xterm theme selector */}
            <FormControl sx={{ mb: 3, maxWidth: 320 }}>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", mb: 1, fontWeight: 500 }}
              >
                Terminal theme
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  px: 1.5,
                  py: 1,
                  bgcolor: "background.paper",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    flexShrink: 0,
                    bgcolor: currentTheme.background,
                    border: "1px solid",
                    borderColor: currentTheme.foreground,
                  }}
                />
                <Select
                  value={currentThemeKey}
                  onChange={(e) => setTheme(e.target.value as string)}
                  variant="standard"
                  disableUnderline
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "0.8125rem",
                    color: "text.primary",
                    "& .MuiSelect-select": { py: 0 },
                  }}
                >
                  {themeKeys.map((key) => (
                    <MenuItem key={key} value={key}>
                      {PRESET_THEMES[key].name}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            </FormControl>

            {/* Local echo toggle */}
            <Box sx={{ mt: 3 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={globalLocalEcho}
                    onChange={(e) => setGlobalLocalEcho(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Typography variant="body2">Global local echo</Typography>
                }
              />
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  pl: 6.5,
                  color: "text.disabled",
                  lineHeight: 1.4,
                }}
              >
                Show typed characters locally before the remote echo arrives.
                Per-session overrides will take priority.
              </Typography>
            </Box>
          </Box>
        )}

        {activeCategory === "shortcuts" && (
          <Box sx={{ maxWidth: 600, mb: 4 }}>
            <Typography
              variant="h5"
              sx={{ color: "text.primary", mb: 2 }}
            >
              Shortcuts
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {SHORTCUTS.map((shortcut) => (
                <Box
                  key={shortcut.label}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    py: 0.75,
                  }}
                >
                  <Typography variant="body2" sx={{ color: "text.primary" }}>
                    {shortcut.label}
                  </Typography>
                  <Chip
                    label={shortcut.keys}
                    size="small"
                    sx={{
                      fontFamily: (theme) => theme.typography.fontFamily,
                      fontSize: "0.75rem",
                      bgcolor: "action.hover",
                      color: "text.secondary",
                      height: 24,
                    }}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {activeCategory === "about" && (
          <Box sx={{ maxWidth: 600, mb: 4 }}>
            <Typography
              variant="h5"
              sx={{ color: "text.primary", mb: 2 }}
            >
              About
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography
                sx={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "text.primary",
                }}
              >
                XSTerm
              </Typography>
              <Typography variant="body2" sx={{ color: "text.disabled" }}>
                v0.1.1
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
