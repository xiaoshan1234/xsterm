# RFC 0003 (Revised): 配置保留 JSON 格式（tauri-plugin-store）

| 字段 | 值 |
|---|---|
| 状态 | Accepted（override RFC 0003） |
| 日期 | 2026-09-29 |
| 作者 | dev（基于用户决策）|
| 影响阶段 | M0（启动即生效，无迁移） |
| 决策 D-γ | revised |
| 关联 ADR | RFC 0003（superseded） |

---

## 1. 背景

RFC 0003（2026-09-11 pdm 拍板）建议：
- 迁移 store JSON → toml（Rust 端权威配置源）
- `%APPDATA%\xsterm\config.toml` 为权威配置文件
- 一次性迁移旧 store.json → config.toml + 30 天 .bak 回退

理由：
- Rust 端配置读写统一
- 支持复杂结构（嵌套 profile / ssh config / mcp settings）
- 注释友好
- 与 dev-handoff §技术栈锁定（serde + toml）一致

但 RFC 0003 没考虑到：

1. **frontend 直存是核心场景**——PRD §2 M9 描述：用户通过前端 settings UI 改配置；配置文件**用户不直接编辑**
2. **tauri-plugin-store 的 frontend 集成**远比 toml 简单——`@tauri-apps/plugin-store` 的 `Store.load()` 直接暴露 `get/set/save/has/delete` API
3. **注释友好是 toml 的优势，但 frontend UI 才是用户操作面**—— toml 注释用户看不到
4. **xsterm 现状已经是 tauri-plugin-store JSON**（`commands/persistence.rs` 用 `app.store("sessions.json")`）—— 切到 toml 是 backward 破坏性变更
5. **JSON Schema 校验**仍然可用（前端 zod / valibot），不依赖 toml

## 2. 决策

**MVP 阶段保留 `tauri-plugin-store` JSON 格式**，不迁移到 toml。

- ✅ 配置存储：`@tauri-apps/plugin-store`（现有，已在用）
- ✅ 配置文件：`%APPDATA%\xsterm\store.json`（多 key，单文件）
- ✅ 写操作：通过 Tauri IPC 镜像（frontend 不直接调 store）
- ❌ toml 迁移：不进行
- ❌ 30 天 .bak 回退窗口：不适用（store.json 一直就是权威）

### 2.1 配置文件

```
%APPDATA%\xsterm\
├── store.json                    # 主配置（settings / sessions / groups / attached_tmux）
├── ssh\known_hosts               # SSH known_hosts（已有）
├── cache\                        # 主题/字体缓存（已有）
└── logs\                         # 应用日志（已有）
```

**单一 store 文件**，多 key：
```json
{
  "settings": {
    "theme": "dark",
    "terminalFontSize": 14,
    "terminalFontFamily": "Cascadia Code",
    "logLevel": "info",
    "sidebarWidth": 240,
    "showSidebar": true,
    ...
  },
  "sessions": [...],
  "groups": [...],
  "attachedTmux": [...],
  "log_config": {...}
}
```

### 2.2 schema

```rust
// models/config.rs —— 简化
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font_size")]
    pub terminal_font_size: u16,
    #[serde(default = "default_font_family")]
    pub terminal_font_family: String,
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    #[serde(default = "default_show_sidebar")]
    pub show_sidebar: bool,
    // ... 其他 UI 设置
    pub keybindings: HashMap<String, String>,  // "newTab" -> "Ctrl+T"
    pub mcp: McpSettings,
    pub ssh: SshSettings,
}

// 嵌套（每个子设置独立 struct，JSON 中嵌套）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub http_enabled: bool,
    #[serde(default = "default_mcp_port")]
    pub http_port: u16,
    #[serde(default)]
    pub http_token: Option<String>,
    #[serde(default = "default_destructive_policy")]
    pub destructive_keys_policy: String,  // "deny" | "ask" | "allow"
    #[serde(default = "default_idle_timeout_secs")]
    pub idle_timeout_seconds: u64,
    #[serde(default = "default_rate_limit_rps")]
    pub rate_limit_rps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshSettings {
    #[serde(default = "default_host_key_verify")]
    pub host_key_verify: String,  // "ask" | "no" | "yes"
    #[serde(default)]
    pub keepalive_interval_secs: u32,
    #[serde(default)]
    pub connect_timeout_secs: u32,
}
```

**关键**：
- `#[serde(default)]` 在**每个字段**——新增字段向前兼容（老 store.json 缺字段用 default）
- **不需要 `deny_unknown_fields`**——JSON 容忍未知字段（前端可能加新字段，backend 不报错）
- **不需要 JsonSchema 派生**——schema 校验由 frontend zod / valibot 承担
- **不需要 toml**——serde_json 已够

### 2.3 现有 `commands/persistence.rs` 扩展 + `commands/config.rs` 删除

**扩展**（`commands/persistence.rs`）：
- 现有 `save_sessions / load_sessions / save_groups / load_groups / save_attached_tmux_servers / load_attached_tmux_servers` 保留
- 新增 `save_settings / load_settings`（接 frontend `usePersistenceService().config.read()` / `.write()`）

**删除**（`commands/config.rs`）：
- ❌ 原设计 `get_config / set_config`（白名单写入）**不实现**——JSON 直存不需要白名单
- frontend 直存走 `save_settings` / `load_settings`（无中间层）

## 3. 为什么 override RFC 0003

| 维度 | RFC 0003（toml） | RFC 0003-revised（JSON 保留） |
|---|---|---|
| **frontend 集成** | 需要 serde + schemars 镜像 | ✅ `@tauri-apps/plugin-store` 直接 get/set/save |
| **配置文件** | `%APPDATA%\xsterm\config.toml` | `%APPDATA%\xsterm\store.json`（已有） |
| **schema 校验** | serde + toml::from_str | serde_json::from_str + frontend zod / valibot |
| **写操作白名单** | 必填（防 frontend 误改敏感字段） | ❌ 不需要（JSON 直存，frontend UI 是受信的） |
| **热更新（notify 监听）** | notify crate 监听 `config.toml` | ❌ 不需要（store API 自身支持 reactivity） |
| **migration** | 30 天 .bak 回退窗口 | ❌ 不需要（无格式变化） |
| **Cargo 依赖** | +toml +notify +notify-debouncer-full +schemars | -（仅 serde_json，已在） |
| **PRD §2 M9 验收** | 通过 | 通过（JSON 也是配置文件） |
| **dev-handoff §技术栈锁定** | toml | ❌ 移除 toml 锁定（dev-handoff 同步更新） |

### 3.1 关键 trade-off：注释友好

**RFC 0003** 假设 toml 注释让用户能手动编辑。但实际：
- frontend UI 是 xsterm 的**唯一**配置入口（M5/M9 都强调）
- 用户手动改配置文件是边缘场景（高级用户 / debug）
- JSON 也允许手编辑（vscode 折叠 + 颜色提示够用）

**结论**：保留 JSON 是 net positive——少 4 个 crate 依赖 + 少 migration 复杂度 + frontend 直存更简单。

### 3.2 关键 trade-off：白名单写入

**RFC 0003** 设白名单是为了防 frontend 误改 `ssh.hostKeyVerify=false`（安全降级）。但实际：
- frontend UI 是受信的（settings 抽屉只能改 UI 暴露字段）
- backend `SessionManager::ssh_backend` 启动时读 `ssh.hostKeyVerify`——如果 frontend 改了，重连行为变化是**符合预期的**
- 真要防，应该在 frontend UI 层做（不暴露该字段），不在 backend IPC 层做

**结论**：白名单是过度防御。JSON 直存 + frontend UI 控制暴露字段就够了。

### 3.3 关键 trade-off：热更新

**RFC 0003** 用 notify 监听 config.toml 改动。JSON 直存场景下：
- `tauri-plugin-store` 自身有 reactive API（subscribe change 事件）
- frontend UI 通过 store 订阅（已有 zustand pattern）—— 不需要 backend notify 监听
- backend 内部联动（attach idle_timeout / log level）通过 `applyToSubsystems` 在写时触发——不需要外部监听

**结论**：JSON + tauri-plugin-store 自带 reactivity，notify crate 是过度设计。

## 4. 架构示意

```
┌────────────────────────────────────────────────────────────────┐
│  xsterm.exe (Tauri 主进程)                                        │
│  ┌────────────────────────┐  tokio mpsc  ┌────────────────────┐  │
│  │ pty/ssh/tmux 后端      │ ──────────►  │ SessionManager      │  │
│  └────────────────────────┘              └────────────────────┘  │
│           ▲                                       ▲              │
│           │                                       │              │
│  ┌────────┴───────────────────────────────────────┴──────┐      │
│  │  attach_registry + OutputRing + capture + tunnel       │      │
│  └────────────────────────────────────────────────────────┘      │
│           ▲                                       ▲              │
│           │ invoke()                              │ tauri-plugin-store
│  ┌────────┴───────────────────────────────────────┴──────┐      │
│  │  WebView2 (UI)                                         │      │
│  │  ┌────────────────────────────────────────────────┐   │      │
│  │  │  React + xterm.js                               │   │      │
│  │  │  service/persistence/api.ts ←─ tauri-plugin-store│   │      │
│  │  │  app/settings/usecases/load.ts ─┐                │   │      │
│  │  │  app/mcp/server.ts ────────────┤                │   │      │
│  │  │  ui/settings/view/SettingsView.tsx ─┐          │   │      │
│  │  └────────────────────────────────────────────────┘   │      │
│  └────────────────────────────────────────────────────────┘      │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  %APPDATA%\xsterm\store.json                            │      │
│  │    { settings, sessions, groups, attachedTmux, ... }    │      │
│  └────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────┘
```

**关键**：
- store.json 是单一权威文件
- frontend `service/persistence` 通过 tauri-plugin-store 读写
- backend `commands/persistence` 提供 IPC 镜像（save_settings / load_settings 等）
- backend `services/config` 包装 store + 联动更新子系统（attach idle_timeout / log level / ssh）

## 5. backend 设计调整

### 5.1 删除

- `services/config/migration.rs`（30 天 .bak 迁移不需要）
- `services/config/watcher.rs`（notify 监听 toml 不需要）
- `services/config/whitelist.rs`（JSON 直存不需要白名单）
- `services/config/loader.rs` 中 toml 相关
- `commands/config.rs`（`get_config / set_config` 白名单 IPC 不需要）
- `commands/mcp` 中 `get_config / set_config` 工具（V1.0 不做，见 RFC 0002-revised）
- `Cargo.toml` 依赖：`toml` / `notify` / `notify-debouncer-full` / `schemars`

### 5.2 保留

- `services/config/` 模块存在，但内容简化：
  - `ConfigStore` 包装 `tauri-plugin-store` 实例
  - `AppConfig` 仍存在（serde derive，**无** JsonSchema / **无** deny_unknown_fields）
  - `applyToSubsystems()` 联动更新（attach idle_timeout / log level / ssh host_key_verify）
- `commands/persistence.rs` 扩展：新增 `save_settings / load_settings`
- `commands/mcp.rs` 仍保留 attach / detach / mcp_status（与 RFC 0002-revised 一致）

### 5.3 frontend 调整

- `app/settings/usecases/load.ts` —— 调 `invoke('load_settings')`
- `app/settings/usecases/updateSetting.ts` —— 调 `invoke('save_settings', { patch })`（不再走 config 子模块白名单）
- `service/persistence/api.ts` 的 `config` 子模块**删除**（无需专门走白名单，直接 `get<Settings>('settings')`）
- frontend design doc `service/persistence/INTERFACE.md §1` 的 `config.read() / config.write() / config.onReloaded()` 删除，回归到 `get<T>(key) / set<T>(key, value)`

## 6. Cargo.toml 变更

```toml
# ❌ 删除
-toml = "0.8"
-notify = "6"
-notify-debouncer-full = "0.3"
-schemars = "0.8"

# ✅ 新增
-tauri-plugin-store = "2"  # 已存在（现有 commands/persistence.rs 在用）
```

净减少 4 个 crate 依赖，build time 加快 ~5%。

## 7. 影响

### 7.1 删除

- `src-tauri/src/services/config/migration.rs`
- `src-tauri/src/services/config/watcher.rs`
- `src-tauri/src/services/config/whitelist.rs`
- `src-tauri/src/commands/config.rs`
- `src-tauri/src/commands/mcp.rs` 中 get_config / set_config 部分
- `Cargo.toml` 4 个依赖

### 7.2 简化

- `services/config/loader.rs` —— 删除 toml parser，改为 serde_json from_str
- `services/config/store.rs` —— ConfigStore 包装 tauri-plugin-store，不再自管 toml
- `models/config.rs` —— 删除 `deny_unknown_fields` / JsonSchema 派生
- `services/config/mod.rs` —— 公开 API 不变（get / get_field / on_reloaded），write 不需要白名单

### 7.3 新增

- `commands/persistence.rs` 加 `save_settings / load_settings`（接 frontend service/persistence.ts 的 get/set）
- `models/config.rs` 加 `Settings` 结构（带默认值）

### 7.4 文档调整

- 归档 `doc/dev/adr/0003-config-toml-migration.md` → `doc/dev/history/config-toml-rfc-0003/`
- 重写 `doc/dev/design/backend/services/config/{README,INTERFACE,DOWNSTREAM}.md`
- 更新 `doc/dev/design/backend/models/README.md`（删除 JsonSchema 派生说明）
- 更新 `doc/dev/design/backend/README.md`（删除 §3.3 toml 迁移表 + §12 依赖列表）
- 更新 `doc/dev/design/backend/commands/README.md`（删除 commands/config 章节）
- 更新 `doc/dev/roadmap/target-architecture.md` §3.2/§3.3（删除 toml schema + 迁移路径）
- 更新 `doc/dev/design/frontend/service/persistence/INTERFACE.md`（删除 config 子模块）

## 8. 演进路径

### 8.1 短期（M0）—— 当前

- JSON 直存，tauri-plugin-store
- 无 migration / 无白名单 / 无 notify 监听

### 8.2 中期（v1.0）—— 加 keybindings 可配

- frontend `service/settings` 提供 keybindings 字段
- `keybindings: HashMap<String, String>` 持久化到 store.json
- 后端启动时读 keybindings 推给 frontend capture 阶段

### 8.3 长期（v2+）—— 可选 toml

- 如果用户社区强烈要求 toml（手动编辑 / 注释 / 高级 debug 场景）：
  - 加 `services/config/toml_export.rs` —— 从 store.json 导出为 config.toml
  - 加 `services/config/toml_import.rs` —— 从 config.toml 导入到 store.json
  - 不影响 frontend 主路径（仍然 store.json 直存）
- 现实情况：xsterm 当前不是这类工具的目标用户（程序员 / AI agent），v2 评估

## 9. 验收

- store.json schema 100% 测试覆盖 ✅
- 所有新增 Settings 字段都有 `#[serde(default)]` 默认值，向前兼容 ✅
- frontend `service/persistence` 不再走 `config` 子模块，直接 `get<Settings>(key)` ✅
- backend `services/config` 联动更新正常（attach idle_timeout / log level / ssh host_key_verify）✅
- Cargo build time -5%（少了 4 个 crate）✅
- PRD §2 M9 验收标准通过 ✅

## 10. 关联文档

- **superseded**：[`doc/dev/adr/0003-config-toml-migration.md`](../../adr/0003-config-toml-migration.md)（RFC 0003 原版 toml 迁移）
- **backend 设计**：[`doc/dev/design/backend/services/config/`](../../design/backend/services/config/)（重写中）
- **frontend 设计**：[`doc/dev/design/frontend/service/persistence/INTERFACE.md`](../../design/frontend/service/persistence/INTERFACE.md)（删 config 子模块）
- **dev-handoff**：[`doc/pdm/dev-handoff.md`](../../../pdm/dev-handoff.md)（同步移除 toml 锁定）

签字：
- [x] dev — 2026-09-29（基于用户决策）
- [ ] tm
- [ ] pdm