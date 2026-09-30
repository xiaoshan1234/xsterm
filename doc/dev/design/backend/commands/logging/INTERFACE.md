# Commands · Logging — 对外接口

> **位置**：`src-tauri/src/commands/logging.rs`
> **唯一入口**：`#[tauri::command]` 函数（每个命令 1 个）

## 1. 公开类型

**共享 types 集中在 `models/`**：

- 命令入参：`models/<domain>/types.rs`（如 LocalSessionConfig / SSHSessionConfig）
- 命令返回：`models/<domain>/types.rs`（如 SessionInfo / Settings）
- 错误：`Result<T, String>`（Tauri 2 IPC 标准）

**frontend 镜像**：
- Rust struct ↔ TS interface（`@tauri-apps/api/core` 类型）
- 类型字段一一对应（serde 派生 `rename_all = "camelCase"`）

## 2. 公开 API

### log_message

```rust
pub async fn log_message((level, source, message, data)) -> Result<(), String>;
```

**用途**：logging IPC（log_message / config / dir）（具体用法见各 command 注释）

---

### get_log_config

```rust
pub async fn get_log_config(()) -> Result<LogConfig, String>;
```

**用途**：logging IPC（log_message / config / dir）（具体用法见各 command 注释）

---

### set_log_config

```rust
pub async fn set_log_config(LogConfig) -> Result<(), String>;
```

**用途**：logging IPC（log_message / config / dir）（具体用法见各 command 注释）

---

### get_log_dir

```rust
pub async fn get_log_dir(()) -> Result<String, String>;
```

**用途**：logging IPC（log_message / config / dir）（具体用法见各 command 注释）

---



## 3. 接缝契约

**frontend 调用模式**：

```typescript
// frontend app/<module>/usecases/*.ts
import { invoke } from "@/infra/tauri/api";

const result = await invoke<ReturnType>("<command_name>", {
  arg1: value1,
  arg2: value2,
});
```

**backend 处理模式**：

```rust
#[tauri::command]
pub async fn <command_name>(
    arg1: ArgType,
    arg2: ArgType,
    state: State<'_, Arc<ServiceState>>,
) -> Result<ReturnType, String> {
    // 1. 调 services/<module>::<fn>
    // 2. 错误转 String
    // 3. 返回
}
```

## 4. 错误码

| 错误 | 含义 | IPC 字符串 |
|---|---|---|
| `SessionError::NotFound(id)` | session_id 不存在 | `"session N not found"` |
| `SessionError::WriteFailed(msg)` | write 失败 | `"write failed: MSG"` |
| `SessionError::CloseFailed(msg)` | close 失败 | `"close failed: MSG"` |
| `SessionError::PermissionDenied` | attach 状态拒绝 | `"session not attached by this client"` |
| `SessionError::QuotaExceeded` | 100 session 上限 | `"session quota exceeded"` |
| `McpError::SessionNotFound` | MCP session_id 不存在 | `"session not found"` |
| `McpError::SessionAlreadyAttached` | attach 互斥 | `"session already attached by CLIENT_ID"` |
| `McpError::SessionNotAttached` | 未 attach | `"session not attached"` |
| `ConfigError::IoError(msg)` | IO 失败 | `"io error: MSG"` |
| `ConfigError::ParseError(msg)` | JSON parse 失败 | `"json parse error: MSG"` |
| `ConfigError::ValidationError(msg)` | schema 校验失败 | `"validation error: MSG"` |


## 5. 性能

| 操作 | 预算 | 备注 |
|---|---|---|
| 简单命令（如 `close_session`） | < 5ms | 调 services + 返回 |
| 复杂命令（如 `create_local_session`） | < 200ms | PTY spawn + session_id 分配 |
| `write_session` | < 10ms | attach 权限检查 + PTY write |
| `mcp_status` | < 1ms | 读 settings.mcp |

## 6. 变更流程

1. **新增命令** → 加 `#[tauri::command]` 函数 + 更新 `commands/mod.rs::all_handlers()` + 本文档 §2
2. **修改命令签名** → 同步 frontend `infra/tauri/commands/<module>/<name>.ts` + 本文档
3. **删除命令** → 三处一起删除 + frontend 同步清理

## 7. frontend 同步清单

每次改命令，必须同步：

- `src/infra/tauri/commands/<module>/<name>.ts`（invoke 包装）
- `src/model/<domain>/types.ts`（如有 type 变化）
- `src/service/<domain>/api.ts`（如有 reactive use）
- 4 个测试文件（happy + error）

## 8. 验收

- 所有命令 Tauri 2 capability 权限已申请（capabilities/default.json）✅
- frontend invoke 包装存在（`src/infra/tauri/commands/<module>/`）✅
- 错误码字符串与 frontend 错误处理一致 ✅
- TypeScript 类型与 Rust struct 一致 ✅
