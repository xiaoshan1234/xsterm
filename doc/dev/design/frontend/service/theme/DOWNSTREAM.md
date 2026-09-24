# Service · Theme — 对下依赖接口

> **位置**：`src/service/theme/`

## 1. 依赖图

```
service/theme/
├── api.ts        ────►  @/model/settings/types        (Settings.theme)
├── api.ts        ────►  @/model/terminal/types        (TerminalTheme)
├── store.ts      ────►  @/model/theme/types           (Theme / ThemeMode)
├── bridge.ts     ────►  @/infra/tauri/events/systemTheme (auto 模式监听 OS)
└── palettes.ts   ────►  (无——纯数据)
```

## 2. model

| 调用 | 来源 |
|---|---|
| `Theme` / `ThemeMode` | `model/theme/types` |
| `UiTheme` 类型（"dark" | "light" | "auto"） | `model/theme/types` |
| `TerminalTheme` 类型 | `model/terminal/types` |
| `Settings.theme` 字段引用 | `model/settings/types` |

## 3. infra（OS theme 监听）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('get_system_theme', ...)` | `infra/tauri/commands/system` | 启动时检查初始 OS theme |
| `listen('system-theme-changed', ...)` | `infra/tauri/events/systemTheme` | auto 模式下监听 OS theme 变化 |

**注意**：如果未来 backend 不支持 system theme 监听，bridge 自动降级——只在 setUiTheme 时主动应用，不监听。

## 4. 不允许的依赖

- ❌ `service/theme/` → `app/`、`ui/`、`@tauri-apps/api` 直接
- ❌ `service/theme/` → `service/terminal/api`（虽然都跟 terminal 有关，但 terminal service 自己监听 theme）

## 5. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"@tauri-apps' src/service/theme/ --include='*.ts' | grep -v 'listen\|invoke' | head
# 不应出现 import { listen / invoke } from "@tauri-apps/api"
# 但 listen / invoke 是允许的（封装在 bridge 内）

grep -rn 'from\s*"\.\./\(app\|ui\|service/session\|service/workspace\|service/output\|service/logger\|service/persistence\|service/settings\)' src/service/theme/ --include='*.ts'
# 必须为空
```

## 6. 设计意图：theme 跟 terminal 的边界

theme 和 terminal 都跟"视觉"相关，但职责不同：

- **theme service** — 持有 theme 值（dark/light/auto + xtermThemeId），emit 变化事件
- **terminal service** — 持有 xterm 实例，订阅 theme 变化应用到实例

theme service **不知道** xterm 实例存在；terminal service **不知道** theme 是怎么存的。两者通过"theme 变化 → terminal.applyTheme"耦合——这个耦合由 **terminal service 自己**订阅 theme service 完成（不允许反过来）。
