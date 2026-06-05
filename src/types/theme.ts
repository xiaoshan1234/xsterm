export interface TerminalTheme {
  name: string;
  foreground: string;
  background: string;
  cursor: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const PRESET_THEMES: Record<string, TerminalTheme> = {
  dark: {
    name: "Dark (VSCode-like)",
    foreground: "#D4D4D4",
    background: "#1E1E1E",
    cursor: "#FFFFFF",
    black: "#000000",
    red: "#CD3131",
    green: "#0DBC79",
    yellow: "#E5E510",
    blue: "#2472C8",
    magenta: "#BC3FBC",
    cyan: "#11A8CD",
    white: "#E5E5E5",
    brightBlack: "#666666",
    brightRed: "#F14C4C",
    brightGreen: "#23FF58",
    brightYellow: "#F5F543",
    brightBlue: "#3B8EEA",
    brightMagenta: "#D670D6",
    brightCyan: "#00B4CC",
    brightWhite: "#FFFFFF",
  },
  light: {
    name: "Light (Solarized)",
    foreground: "#657B83",
    background: "#FDF6E3",
    cursor: "#657B83",
    black: "#073642",
    red: "#DC322F",
    green: "#859900",
    yellow: "#B58900",
    blue: "#268BD2",
    magenta: "#D33682",
    cyan: "#2AA198",
    white: "#EEE8D5",
    brightBlack: "#002B36",
    brightRed: "#CB4B16",
    brightGreen: "#586E75",
    brightYellow: "#657B83",
    brightBlue: "#839496",
    brightMagenta: "#6C71C4",
    brightCyan: "#93A1A1",
    brightWhite: "#FDF6E3",
  },
  monokai: {
    name: "Monokai",
    foreground: "#F8F8F2",
    background: "#272822",
    cursor: "#F8F8F0",
    black: "#272822",
    red: "#F92672",
    green: "#A6E22E",
    yellow: "#F4BF75",
    blue: "#66D9EF",
    magenta: "#AE81FF",
    cyan: "#A1EFE4",
    white: "#F8F8F2",
    brightBlack: "#75715E",
    brightRed: "#F92672",
    brightGreen: "#A6E22E",
    brightYellow: "#F4BF75",
    brightBlue: "#66D9EF",
    brightMagenta: "#AE81FF",
    brightCyan: "#A1EFE4",
    brightWhite: "#F9F8F5",
  },
  oneDark: {
    name: "One Dark",
    foreground: "#ABB2BF",
    background: "#282C34",
    cursor: "#528BFF",
    black: "#282C34",
    red: "#E06C75",
    green: "#98C379",
    yellow: "#E5C07B",
    blue: "#61AFEF",
    magenta: "#C678DD",
    cyan: "#56B6C2",
    white: "#ABB2BF",
    brightBlack: "#5C6370",
    brightRed: "#E06C75",
    brightGreen: "#98C379",
    brightYellow: "#E5C07B",
    brightBlue: "#61AFEF",
    brightMagenta: "#C678DD",
    brightCyan: "#56B6C2",
    brightWhite: "#FFFFFF",
  },
  dracula: {
    name: "Dracula",
    foreground: "#F8F8F2",
    background: "#282A36",
    cursor: "#F8F8F2",
    black: "#282A36",
    red: "#FF5555",
    green: "#50FA7B",
    yellow: "#F1FA8C",
    blue: "#BD93F9",
    magenta: "#FF79C6",
    cyan: "#8BE9FD",
    white: "#F8F8F2",
    brightBlack: "#6272A4",
    brightRed: "#FF6E6E",
    brightGreen: "#69FF94",
    brightYellow: "#FFFFA5",
    brightBlue: "#D6ACFF",
    brightMagenta: "#FF92DF",
    brightCyan: "#A4FFFF",
    brightWhite: "#FFFFFF",
  },
};

export const THEME_KEYS = Object.keys(PRESET_THEMES);
