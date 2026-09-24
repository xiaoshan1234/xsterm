# Model · Settings — 职责

> **位置**：`src/model/settings/`
> **数据**：应用配置 + 视觉配置（terminal theme / 调色板）
> **被使用方**：`service/settings`、`app/settings`、`app/terminal`、`ui/settings`、`ui/workspace`、`ui/terminal`

## 1. 这个 domain 负责什么

settings model 定义 frontend 的"应用配置"——所有可配置的字段都在这里。

它同时承担两个子域：

1. **业务配置**——Settings / SettingsCategory / LogLevel / Theme（dark/light/auto）
2. **视觉配置**——TerminalTheme / TerminalPreferences / 5 个 ANSI 调色板

这两个子域都在 settings 里，因为：

- `Settings.terminalThemeId` 引用 TerminalTheme
- `Settings.terminalFontSize` 等是 TerminalPreferences 字段
- theme 是 settings 的视觉子集，没有独立概念

承担 5 类职责：

1. **数据形状**——Settings / SettingsCategory / LogLevel / Theme / TerminalTheme / TerminalPreferences
2. **Repository 接口**——SettingsRepository
3. **事件契约**——SettingsChangedEvent（泛型）
4. **派生计算**（accessor）——getEffectiveTheme / isValidSettings / getThemeById
5. **算法**（rules）——applyPatch / mergeDefaults / resetToDefaults

## 2. 这个 domain **不**负责什么

- **不持有运行时状态**——纯类型 + 纯函数
- **不直接持久化**——持久化归 `service/persistence`
- **不渲染 UI**——UI 在 `ui/settings`
- **不调 IPC**——所有 IPC 走 service 或 infra

## 3. 子结构

```
model/settings/
├── types.ts                # Settings / SettingsCategory / LogLevel / Theme
├── repository.ts           # SettingsRepository 接口
├── events.ts               # SettingsChangedEvent<K extends keyof Settings>
├── accessor.ts             # getEffectiveTheme / isValidSettings / getThemeById
├── rules.ts                # applyPatch / mergeDefaults / resetToDefaults
│
├── terminal/
│   ├── types.ts            # TerminalTheme / TerminalPreferences
│   ├── themes.ts           # 5 个 ANSI preset 的元数据
│   └── palettes/           # 5 个调色板（dark / light / solarized-dark / solarized-light / monokai）
│                           # 每个调色板一个文件，16 色 + bg/fg/cursor/selection
└── *.test.ts
```

**关键决策**：terminal 子域是 settings 的**子目录**——`model/settings/terminal/`，不是 `model/terminal/`。

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望不可变更新 settings → `applyPatch(settings, { terminalFontSize: 14 })`
- **作为开发者**，我希望解析 auto theme → `getEffectiveTheme(settings)` 返回 "dark" | "light"
- **作为开发者**，我希望 5 个 ANSI 调色板 → `palettes.dark.ts` / `palettes.light.ts` / 等

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `model/common` | Settings 默认值用 `constants.ts`（DEFAULT_PORT 等） |
| `model/session` | Session 默认值（defaultShell / defaultSshUser）从 settings 读 |
| `model/workspace` | sidebar 宽度等布局配置从 settings 读 |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 model/settings |
|---|---|
| `service/settings` | store schema 用 Settings 类型；mutation 调用 `applyPatch` |
| `app/settings` | useCase 读 / 写 settings；apply 函数把 settings 字段应用到其他 service |
| `ui/settings` | 渲染时显示当前值 + 修改触发 `set(key, value)` |

## 7. 这个 domain 的"产品语言"术语

- **settings** — 应用配置
- **field** — 单个设置字段
- **patch** — `Partial<Settings>` 用于批量更新
- **effective theme** — 解析 auto 后的实际 theme（"dark" 或 "light"）
- **ANSI preset** — xterm 的 5 个内置主题

## 8. 关键设计：Settings 是 discriminated-like union of 5 categories

```typescript
interface Settings {
  // appearance
  theme: Theme;
  uiScale: number;
  showSidebar: boolean;

  // input
  keymap: "default" | "vim" | "emacs";
  scrollbackLines: number;
  pasteWarnThreshold: number;

  // session defaults
  defaultShell: string;
  defaultSshUser: string;
  defaultTmuxSessionName: string;

  // terminal
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalThemeId: string;
  cursorBlink: boolean;

  // logging
  logLevel: LogLevel;
  logMaxFileSizeMB: number;
  logRetentionDays: number;
}
```

5 个 category 各自成组，字段名按 category 前缀（避免命名冲突）。

## 9. TerminalTheme 的 5 个 ANSI preset

5 个 preset 各自一个文件：

```
palettes/
├── dark.ts                # 默认 dark 主题
├── light.ts               # 默认 light 主题
├── solarized-dark.ts      # Solarized Dark
├── solarized-light.ts     # Solarized Light
└── monokai.ts             # Monokai
```

每个文件导出 `TerminalTheme` 对象（16 色 ANSI + bg/fg/cursor/selection）。
