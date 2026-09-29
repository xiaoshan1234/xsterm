# Service · Persistence — 职责

> **位置**：`src/service/persistence/`
> **类型**：⭐ 横切 domain（**frontend-only 持久化主入口**——v4 起承担 saved sessions/groups 直存）
> **被订阅方**：`app/settings`、`app/workspace`、`app/session`、`ui/settings`

## 1. 这个 domain 负责什么

persistence service 是 **frontend 直存 `tauri-plugin-store` 的 wrapper**——承担 frontend-only 配置持久化。

承担 4 类职责：

1. **frontend-only store 直存**——`sessions.json` / `groups.json` / `theme.json`（UI 主题选择缓存）
2. **Store 句柄管理**——lazy 加载、缓存、句柄复用
3. **CRUD 包装**——`get(key) / set(key, value) / delete(key) / list(prefix)`
4. **schema migration**——store 文件版本升级时迁移老数据

**v4 → v5 关键变化**：
- v3 时期 frontend persistence 调 backend IPC（`save_sessions` / `load_sessions` / `save_groups` / `load_groups`）——v4 砍掉
- **v4 起** frontend 直接调 `infra/store`（`@tauri-apps/plugin-store`）
- **backend 只持久化 backend-only 状态**（attached_tmux + log_config + **config.toml——详见 §3 v5.1 改写**）

## 2. 这个 domain **不**负责什么

- **不调 backend IPC**——frontend 直存不走 IPC（**例外**：settings 配置走 `invoke('write_config', ...)` IPC，详见 §3 v5.1 改写）
- **不存 backend-only 状态**（attached_tmux / log_config / **config.toml**）——backend 自己持有
- **不解析具体业务数据格式**——只搬运 JSON value；业务 schema 由各自的 service（session / workspace / settings）管理
- **不渲染 UI**——持久化设置归 settings module

## 3. v5.1 改写后：settings.json 已砍，所有 settings 走 backend config.toml

P0-5 决策落地后，frontend 不再直存 `settings.json`。所有 settings（keybindings / theme / font_size / log / sidebar / terminal_preferences 等）由 backend `infra/config_watcher/` 持有（路径 `%APPDATA%\xsterm\config.toml`），详见 [`../../../backend/infra/config_watcher/RESPONSIBILITY.md`](../../../backend/infra/config_watcher/RESPONSIBILITY.md)。

**frontend service/persistence 只剩 2 个 store file 直存**：

| store file | 内容 | 写入触发 |
|---|---|---|
| `sessions.json` | saved session configs | `app/session/saveConfig.ts` |
| `groups.json` | saved group store | `app/workspace/saveGroups.ts` |
| `theme.json` | UI 主题选择缓存（用户最近选择的 theme，不是 PRD §2 M9 settings 字段） | `ui/settings/themeSelector.ts` |

> **theme.json 跟 config.toml 的关系**：`theme.json` 是**用户最近选择的 theme 名**（"我刚刚选了 dark"），是 UI 偏好；`config.toml.theme.name` 是**长期配置**（"默认用 dark"）。两者**不同步**——前端可在 UI 里快速切换 theme 不写 config.toml，关 app 时写 theme.json；下次启动从 config.toml 读默认 theme，从 theme.json 读最近选择 → 两者差异是 UX 细节，非架构问题。

**frontend 改 settings 的唯一通道**：

```typescript
// app/settings/usecases/updateSetting.ts
export async function updateSetting<K extends keyof AppConfig>(
  key: K,
  value: AppConfig[K],
): Promise<AppConfig> {
  const partial: PartialAppConfig = { [key]: value } as any;
  const newConfig = await invoke<AppConfig>("write_config", { partial });
  // ↑ backend merge + validate + atomic write + emit config-reloaded
  
  // 监听 config-reloaded 事件会自动同步本地 store —— 这里不需要手动 setState
  return newConfig;
}
```

**frontend 读 settings 的通道**：

```typescript
// service/persistence/config.ts
export async function readConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("read_config");
  // ↑ backend state 持有当前 AppConfig
}

// 监听 reload
listen<ConfigReloadedEvent>("config-reloaded", (event) => {
  configStore.setState(event.payload.config);
});
```

**本 module INTERFACE 接口契约见 [`INTERFACE.md §1`](./INTERFACE.md)**；v5.1 后 `config` 子模块为 settings 改写唯一通道——所有 `write_config` / `read_config` IPC 都通过 `persistence.config.read() / .write() / .onReloaded()`，旧 `persistence.set<Settings>("settings")` 与 `registerMigration({ storeKey: "settings" })` 已砍（迁移由 backend `infra/config_watcher/migration` 承担，RFC 0003）。

## 4. 子结构

```
src/service/persistence/
├── api.ts                ⭐ usePersistenceService hook（v4 起的 frontend 直存主入口）
├── store.ts              Store 句柄缓存（key → Store 实例）
├── migrations.ts         schema migration 函数注册表
├── types.ts              MigrationContext / StoreKey / ConfigReloadedEvent
├── sessions.ts           saved session configs 直存入口（sessions.json）
├── groups.ts             saved group store 直存入口（groups.json）
├── theme.ts              UI 主题选择缓存入口（theme.json）
├── config.ts             ⭐ v5.1 新增——config IPC 包装 (read_config / write_config)
│                          + config-reloaded 事件订阅 → 本地 store 同步
└── *.test.ts
```

## 5. 用户故事

- **作为开发者**，我希望 saved session 持久化不关心 IO → `persistence.sessions.save(config)`
- **作为开发者**，我希望 saved group 持久化不关心 IO → `persistence.groups.save(store)`
- **作为开发者**，我希望 store 升级时自动迁移 → migration 注册表启动时执行
- **作为开发者**，我希望 store 损坏时 fallback 默认值 → 错误捕获 + 返回 default
- **作为开发者**，我希望 settings 改完立刻生效 → 调 `invoke('write_config', ...)` + 监听 config-reloaded 事件
- **作为开发者**，我希望高级用户手编 config.toml 后下次启动生效 → backend watcher 监听 → emit reload

## 6. 跟 app/ui 的关系

| 调用方 | 怎么用 |
|---|---|
| `app/settings` | UI 表单提交 → 调 `usePersistenceService().config.write(partial)` → `invoke('write_config', ...)` |
| `app/workspace` | `usePersistenceService().groups.save(store)` / `.groups.load()` |
| `app/session` | `usePersistenceService().sessions.save(config)` / `.sessions.load()` |
| `ui/settings` | 通过 `app/settings/api.ts` 间接调 persistence（不直调） |
| `ui/settings/themeSelector.ts` | `usePersistenceService().theme.save(name)` / `.theme.load()`（UI 主题选择缓存，跟 config.toml 不同步） |

## 7. v4 直存的 store 文件清单（v5.1 后）

| store file | 内容 | 直存代码 | sync 跟 config.toml？ |
|---|---|---|---|
| `sessions.json` | saved session configs | `service/persistence/sessions.ts::save` | ❌ 独立（saved config 不在 AppConfig 里） |
| `groups.json` | saved group store | `service/persistence/groups.ts::save` | ❌ 独立（workspace 不在 AppConfig 里） |
| `theme.json` | UI 主题选择缓存 | `service/persistence/theme.ts::save` | ❌ 不同步（见 §3） |
| `settings.json` | ~~app 全局 settings~~ | ❌ **已砍**——所有 settings 走 backend config.toml | n/a |

**backend 持久化清单**（不在 service/persistence 范围内）：

| 文件 | 内容 | 归 backend 子模块 |
|---|---|---|
| `config.toml` | user settings (PRD §2 M9) | `infra/config_watcher` |
| `xsterm-schema.json` | JSON Schema for VS Code | `infra/config_watcher/schema` |
| `log_config.json` | log runtime config | `commands/shell/log_config` |
| `attached_tmux.json` | attached tmux servers | `domain/terminal/attached_tmux` |
| `store.json` | ~~旧版 store migration 源~~ | `infra/config_watcher/migration` (RFC 0003) |

## 8. 这个 domain 的"产品语言"术语

- **store** — tauri-plugin-store 的一个文件（如 `sessions.json` `groups.json` `theme.json`）
- **store key** — 文件内的字段名
- **migration** — schema 升级时的数据转换函数
- **config** — v5.1 新增——AppConfig IPC 包装（read_config / write_config）+ reload 事件订阅
- **config-reloaded event** — backend notify watcher 触发，Tauri event bus 推送；frontend 订阅同步本地 store
- **frontend 直存** — frontend-only store (sessions/groups/theme)；不写 backend 持久化状态
- **config sync** — settings UI 调 IPC 让 backend 写 → emit reload → frontend 订阅同步
