export interface TerminalTheme {
  background: string;
  foreground: string;
  black: string;
  brightBlack: string;
  red: string;
  brightRed: string;
  green: string;
  brightGreen: string;
  yellow: string;
  brightYellow: string;
  blue: string;
  brightBlue: string;
  magenta: string;
  brightMagenta: string;
  cyan: string;
  brightCyan: string;
  white: string;
  brightWhite: string;
}

export interface AppTheme {
  name: string;
  terminal: TerminalTheme;
}

export const PRESET_THEMES: AppTheme[] = [
  {
    name: "VS Code Dark",
    terminal: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      black: "#1e1e1e",
      brightBlack: "#3a3a3a",
      red: "#ce9178",
      brightRed: "#f14c4c",
      green: "#6a9955",
      brightGreen: "#4ec9b0",
      yellow: "#dcdcaa",
      brightYellow: "#d7ba7d",
      blue: "#569cd6",
      brightBlue: "#9cdcfe",
      magenta: "#c586c0",
      brightMagenta: "#c586c0",
      cyan: "#4fc1ff",
      brightCyan: "#2bc4e2",
      white: "#d4d4d4",
      brightWhite: "#ffffff",
    },
  },
  {
    name: "Monokai",
    terminal: {
      background: "#272822",
      foreground: "#f8f8f2",
      black: "#272822",
      brightBlack: "#75715e",
      red: "#f92672",
      brightRed: "#f92672",
      green: "#a6e22e",
      brightGreen: "#a6e22e",
      yellow: "#f4bf75",
      brightYellow: "#f4bf75",
      blue: "#66d9ef",
      brightBlue: "#66d9ef",
      magenta: "#ae81ff",
      brightMagenta: "#ae81ff",
      cyan: "#a1efe4",
      brightCyan: "#a1efe4",
      white: "#f8f8f2",
      brightWhite: "#f9f8f5",
    },
  },
  {
    name: "Dracula",
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      black: "#282a36",
      brightBlack: "#6272a4",
      red: "#ff5555",
      brightRed: "#ff6e6e",
      green: "#50fa7b",
      brightGreen: "#69ff94",
      yellow: "#f1fa8c",
      brightYellow: "#ffffa5",
      blue: "#bd93f9",
      brightBlue: "#d6acff",
      magenta: "#ff79c6",
      brightMagenta: "#ff92df",
      cyan: "#8be9fd",
      brightCyan: "#a4ffff",
      white: "#f8f8f2",
      brightWhite: "#ffffff",
    },
  },
];
