# Model · Settings — 对外接口

> **位置**：`src/model/settings/`
> **使用方式**：`import { ... } from "@/model/settings/types"` 等

## 1. types.ts

```typescript
// 5 个分类的枚举
export type SettingsCategory = "appearance" | "input" | "session" | "terminal" | "logging";

// Theme
export type Theme = "dark" | "light" | "auto";

// LogLevel
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

// Settings 完整结构
export interface Settings {
  // appearance
  theme: Theme;
  uiScale: number;                          // 0.8 - 1.5
  showSidebar: boolean;

  // input
  keymap: "default" | "vim" | "emacs";
  scrollbackLines: number;                  // 1000 - 100000
  pasteWarnThreshold: number;               // 字符数

  // session defaults
  defaultShell: string;
  defaultSshUser: string;
  defaultTmuxSessionName: string;

  // terminal
  terminalFontFamily: string;
  terminalFontSize: number;                 // 8 - 32
  terminalThemeId: string;                  // 引用 TerminalTheme id
  cursorBlink: boolean;

  // logging
  logLevel: LogLevel;
  logMaxFileSizeMB: number;
  logRetentionDays: number;
}

// 默认值（运行时由 service 初始化）
export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  uiScale: 1.0,
  showSidebar: true,
  keymap: "default",
  scrollbackLines: 1000,
  pasteWarnThreshold: 1000,
  defaultShell: "/bin/bash",
  defaultSshUser: "",
  defaultTmuxSessionName: "main",
  terminalFontFamily: "JetBrains Mono, Menlo, monospace",
  terminalFontSize: 14,
  terminalThemeId: "dark",
  cursorBlink: true,
  logLevel: "info",
  logMaxFileSizeMB: 10,
  logRetentionDays: 7,
};
```

## 2. terminal/

### terminal/types.ts

```typescript
// TerminalTheme（16 色 ANSI + bg/fg/cursor/selection）
export interface TerminalTheme {
  id: string;
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
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

// TerminalPreferences
export interface TerminalPreferences {
  fontFamily: string;
  fontSize: number;
  cursorBlink: boolean;
  scrollback: number;
}
```

### terminal/themes.ts

```typescript
// 5 个 ANSI preset 的元数据
export const THEME_IDS = ["dark", "light", "solarized-dark", "solarized-light", "monokai"] as const;
export type ThemeId = typeof THEME_IDS[number];

export const THEME_METADATA: Record<ThemeId, { name: string; description: string }> = {
  "dark": { name: "Dark", description: "Default dark theme" },
  "light": { name: "Light", description: "Default light theme" },
  "solarized-dark": { name: "Solarized Dark", description: "Popular low-contrast dark theme" },
  "solarized-light": { name: "Solarized Light", description: "Popular low-contrast light theme" },
  "monokai": { name: "Monokai", description: "Classic vibrant dark theme" },
};
```

### terminal/palettes/

```
palettes/
├── dark.ts              # 默认 dark 调色板
├── light.ts             # 默认 light 调色板
├── solarized-dark.ts    # Solarized Dark
├── solarized-light.ts   # Solarized Light
└── monokai.ts           # Monokai
```

每个文件：

```typescript
// palettes/dark.ts
import type { TerminalTheme } from "../types";

export const darkTheme: TerminalTheme = {
  id: "dark",
  name: "Dark",
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  cursorAccent: "#1e1e1e",
  selection: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};
```

### terminal/index.ts（barrel）

```typescript
export * from "./types";
export * from "./themes";
export { darkTheme } from "./palettes/dark";
export { lightTheme } from "./palettes/light";
export { solarizedDarkTheme } from "./palettes/solarized-dark";
export { solarizedLightTheme } from "./palettes/solarized-light";
export { monokaiTheme } from "./palettes/monokai";

import type { ThemeId } from "./themes";

export const TERMINAL_THEMES: Record<ThemeId, TerminalTheme> = {
  "dark": darkTheme,
  "light": lightTheme,
  "solarized-dark": solarizedDarkTheme,
  "solarized-light": solarizedLightTheme,
  "monokai": monokaiTheme,
};
```

## 3. repository.ts

```typescript
export interface SettingsRepository {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  reset(): Promise<void>;
}
```

## 4. events.ts

```typescript
export interface SettingsChangedEvent<K extends keyof Settings = keyof Settings> {
  field: K;
  oldValue: Settings[K];
  newValue: Settings[K];
}

export const SettingsEvents = {
  Changed: "settings-changed",
} as const;
```

## 5. accessor.ts

```typescript
export function getEffectiveTheme(settings: Settings): "dark" | "light" {
  // 解析 auto
  if (settings.theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return settings.theme;
}

export function isValidSettings(settings: unknown): settings is Settings {
  // 运行时校验——返回 true 如果所有字段类型正确
  // （也可以用 zod schema，但 model 层不强制）
  return typeof settings === "object" && settings !== null;
  // ... 完整校验省略
}

export function getThemeById(themeId: string): TerminalTheme | undefined {
  return TERMINAL_THEMES[themeId as ThemeId];
}
```

## 6. rules.ts

```typescript
export function applyPatch(settings: Settings, patch: Partial<Settings>): Settings {
  return { ...settings, ...patch };
}

export function mergeDefaults(settings: Partial<Settings>, defaults: Settings): Settings {
  // 合并默认值——已存在的字段保留，部分字段用 defaults
  return { ...defaults, ...settings };
}

export function resetToDefaults(): Settings {
  return { ...DEFAULT_SETTINGS };
}
```

## 7. api.ts 变更流程

1. **新增 settings 字段** → 加 types.ts + DEFAULT_SETTINGS
2. **新增 ANSI preset** → 加 palettes/<name>.ts + themes.ts 元数据
3. **修改字段类型** → 同步更新 §1
