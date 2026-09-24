# Model · Settings — 对下依赖接口

> **位置**：`src/model/settings/`

## 1. 依赖图

```
model/settings/
├── types.ts                    ──►  ./terminal/types (TerminalTheme)
├── repository.ts               ──►  ./types
├── events.ts                   ──►  ./types
├── accessor.ts                 ──►  ./types + ./terminal (getThemeById)
├── rules.ts                    ──►  ./types + ./constants (DEFAULT_SETTINGS)
│
├── terminal/
│   ├── types.ts                ──►  (无)
│   ├── themes.ts               ──►  ./types
│   ├── palettes/*.ts           ──►  ./types
│   └── index.ts                ──►  ./types + ./themes + ./palettes/*
│
└── *.test.ts
```

**关键**：settings model 内部依赖 `./terminal/`（子目录），不依赖 `model/terminal/`（不存在——已并入 settings）。

## 2. 内部依赖：terminal/ 子目录

settings model 内部包含 terminal 子域：

- `terminal/types.ts` —— TerminalTheme / TerminalPreferences
- `terminal/themes.ts` —— 5 个 ANSI preset 元数据
- `terminal/palettes/<name>.ts` —— 5 个调色板颜色

这些都是 settings 的**内部依赖**，不是跨 domain 依赖。

## 3. model/common

```typescript
// model/settings/rules.ts
import { MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_FONT_SIZE } from "@/model/common/constants";

export function isValidFontSize(size: number): boolean {
  return size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE;
}
```

**settings 依赖 common 的常量**——常量是跨 domain 共享的。

## 4. 不允许的依赖

- ❌ `model/settings/` → `app/` `ui/` `service/` `infra/`
- ❌ `model/settings/` → `@tauri-apps/api` 或 `react`
- ❌ `model/settings/` → `model/session` / `model/workspace` / `model/tmux`

## 5. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/settings/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\)' src/model/settings/ --include='*.ts'
# 必须为空

# 但允许依赖 common
grep -rn 'from\s*"\.\./common' src/model/settings/ --include='*.ts'
# 应当出现
```

## 6. settings/terminal 子目录的边界

```typescript
// ❌ 错误：直接暴露 terminal types 让外部依赖
export * from "./terminal/types";   // ❌ 不在 settings/index.ts 里

// ✅ 正确：通过 settings barrel 暴露
// model/settings/index.ts
export * from "./types";            // Settings / Theme / LogLevel
export * from "./terminal";          // TerminalTheme / TerminalPreferences + 5 调色板
```

调用方通过 `import { Settings, TerminalTheme, darkTheme } from "@/model/settings"` 一站获取。

## 7. settings 字段变更的级联更新

settings 字段变更会影响多个层：

```
model/settings/types.ts (新增 field)
    ↓
service/settings/store.ts (schema 升级)
    ↓
service/persistence (迁移老数据)
    ↓
service/settings/defaults (DEFAULT_SETTINGS 更新)
    ↓
app/* useCases (读 / 写新字段)
    ↓
ui/settings (render 新字段)
```

新增 settings 字段必须**完整**经过这些步骤——跳过任何一步都会引入 bug。

## 8. ANSI preset 变更的级联更新

```
model/settings/terminal/themes.ts (新增 preset id)
    ↓
model/settings/terminal/palettes/<name>.ts (新增调色板)
    ↓
model/settings/terminal/index.ts (注册到 TERMINAL_THEMES)
    ↓
ui/settings (SettingsView 加新选项)
```
