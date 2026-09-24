# Service · Theme — 职责

> **位置**：`src/service/theme/`
> **类型**：横切 domain
> **被订阅方**：ui/shell、ui/terminal、ui/settings、app/settings

## 1. 这个 domain 负责什么

theme service 持有**当前 UI theme + xterm theme id**——theme 是 xsterm 的视觉开关。

承担 3 类职责：

1. **theme store**——当前 UI theme（dark / light / auto）+ xterm theme id
2. **theme 应用**——theme 变化时通知 UI 重新渲染（通过 CSS variables + xterm.options.theme）
3. **system theme 监听**——auto 模式下监听 OS theme 变化

## 2. 这个 domain **不**负责什么

- **不存 settings 全字段**——theme 只是 settings 的一部分，归 `service/settings`
- **不直接渲染**——UI 通过 CSS variables 应用 theme
- **不持久化**——持久化归 `service/persistence`

## 3. 子结构

```
service/theme/
├── api.ts            ⭐ useThemeService hook
├── store.ts          { uiTheme: "dark" | "light" | "auto"; xtermThemeId: string }
├── bridge.ts         listen OS theme 变化（auto 模式）
├── palettes.ts       xterm theme 调色板定义（5 个 ANSI preset）
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望切到 dark mode 立即生效 → theme.set("dark") → CSS vars 更新 → 全 app re-render
- **作为用户**，我希望选 auto 模式跟随系统 → theme.set("auto") + bridge 监听 OS
- **作为用户**，我希望切 xterm theme（5 个 ANSI preset）→ theme.setXterm(id) → 应用到所有 xterm 实例

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/settings` | settings.Theme 字段 → theme 初始化；theme 变化反向写回 settings |
| `service/terminal` | xtermThemeId 变化时调 terminal.applyTheme |
| `infra/tauri` | bridge 监听 OS theme |

## 6. 跟 app/ui 的关系

| module | 怎么用 service/theme |
|---|---|
| app/settings | `useThemeService().applyTheme(theme)` (settings 触发) |
| ui/shell | `useThemeService().useTheme()` 应用 CSS variables |
| ui/terminal | 通过 `service/terminal` 应用（不直接用 theme service）|
| ui/settings | `useThemeService().set(theme)` 触发用户切换 |

## 7. 这个 domain 的"产品语言"术语

- **UI theme** — dark / light / auto（决定 CSS variables）
- **xterm theme** — 5 个 ANSI preset（决定 xterm 调色板）
- **system theme** — OS 报告的 theme（auto 模式下用）
