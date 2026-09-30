# Services · Lifecycle · SSH — 职责

> **位置**：`src-tauri/src/services/lifecycle/ssh.rs`
> **状态**：⭐ backend IPC layer
> **核心**：SSH session 生命周期（russh 连接 + read_loop + close）

## 1. 这个 module 负责什么

SSH session 生命周期（russh 连接 + read_loop + close）

承担 4 类职责：

1. **类型契约**：每个公开 API 严格对应 frontend TS interface（serde derive 双向同步）
2. **错误处理**：统一 `Result<T, String>`（Tauri IPC 标准）+ 内部 enum（如 SessionError / McpError）
3. **状态注入**：所有状态读 `State<'_, Arc<...>>`，不持有可变全局状态
4. **事件广播**：通过 `app.emit(...)` 通知 frontend（详见 emit 事件列表）

## 2. 这个 module **不**负责什么

- ❌ 业务编排（归 services/）
- ❌ 平台 API 封装（归 infrastructure/）
- ❌ 跨 IPC 调用其他命令（共享走 services/）
- ❌ tokio::spawn 长跑任务（调 services/）

## 3. 公开 API 边界

**公开 API 摘要**：

| 函数 | 入参 | 返回 |
|---|---|---|
| `create` | `(config, ring)` | `Result<Box<SshSession>>` |
| `close` | `session_id` | `Result<()>` |
| `upload_file_via_ssh` | `(session_id, path, data)` | `Result<()>` |


**调用下游**：

- `infrastructure/ssh`
- `services/output/ring`
- `services/registry/session_manager`


**emit 事件**：

- `session-output`
- `session-closed`


## 4. 内部实现约束

**每个 `#[tauri::command]` 函数固定结构**：

```rust
#[tauri::command]
pub async fn <name>(
    <入参>: <Type>,
    state: State<'_, Arc<...>>,
    app: AppHandle,
) -> Result<<返回 Type>, String> {
    // 1. 调 services/<module>::<fn>
    // 2. 错误转 String（Tauri IPC 标准）
    // 3. 返回 Result<T, String>
}
```

**禁止**：
- ❌ 命令内 `tokio::spawn` 长跑任务
- ❌ 命令持有 `Arc<Mutex/RwLock>`（走 `State`）
- ❌ 命令跨 IPC 调用其他命令
- ❌ 命令直跳 `infrastructure/pty/ssh/tmux`（穿过 services 抽象）

## 5. frontend 镜像

| backend | frontend |
|---|---|
| Rust struct | TS interface（serde 派生） |
| `#[tauri::command]` | `invoke<T>(name, args)` |
| `app.emit(name, payload)` | `listen<T>(name, cb)` |

**关键约束**：每次改 backend API / event 名 / payload 类型，必须同步 frontend `infra/tauri/commands/*` / `infra/tauri/events/*` / `model/<domain>/types.ts`。

## 6. 关键设计决策

### 6.1 为什么 frontend ↔ backend 镜像

frontend `app/<module>` ↔ backend `commands/<module>` 一对一映射——frontend 改一处 backend 改一处：

- `app/session` ↔ `commands/session` ✅
- `app/workspace` ↔ `commands/workspace` ⭐ NEW（RFC 0007）
- `app/terminal` ↔ `commands/terminal` ⭐ NEW（RFC 0007）
- `app/terminal` ↔ `commands/tmux` ⭐ NEW（RFC 0007，tmux 子模块独立）
- `app/settings` ↔ `commands/settings` ⭐ NEW（RFC 0007）
- `app/mcp` ↔ `commands/mcp`（仅 attach 透传）
- `service/persistence` ↔ `commands/persistence`（settings 扩展）
- `infra/logger` ↔ `commands/logging`

### 6.2 RFC 历史

- RFC 0002-revised：12 个 MCP 工具移到 frontend；backend commands/mcp 只透传 attach 状态
- RFC 0003-revised：settings.json 直存，无 toml/migration/whitelist
- RFC 0006：capture 算法下沉到 models/capture；commands/session 新增 capture_text / capture_ansi / capture_screenshot
- RFC 0007：module 重新划分，commands 按 frontend app module 镜像切 9 个

## 7. 文档

- [`README.md`](README.md) — 本文档（职责）
- [`INTERFACE.md`](INTERFACE.md) — 公开 API + 类型契约
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图 + 强约束

## 8. 验收


**关键约束**：
- host_key_verify 默认 ask（修复 AGENTS.md 已知 gap）


- 每个命令 happy path + 错误分支测试 ✅
- frontend `infra/tauri/commands/<module>` 同步 ✅
- 类型契约与 TS 一致（前端 zod 校验通过）✅
