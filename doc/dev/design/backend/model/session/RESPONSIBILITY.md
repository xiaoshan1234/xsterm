# Model · Session — 职责

> **位置**：`src-tauri/src/models/session/`
> **类型**：⭐ 核心 domain — session 全生命周期的纯类型 + 算法
> **被使用方**：`services/session`、`services/tmux`(通过 `models/tmux/` 间接)、`app/session`、`app/terminal`、`app/workspace`(未来)、`infrastructure/*`
> **Frontend 对应**：[`../../../frontend/model/session/RESPONSIBILITY.md`](../../../frontend/model/session/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

session model 定义 **"一个 xsterm session" 的所有数据形态和算法**——session 是 xsterm 的核心数据实体,所有其他业务(terminal / workspace / settings)都围绕 session 存在。

承担 5 类职责:

1. **session 配置类型**——`LocalSessionConfig / SSHSessionConfig / SessionConfig`(enum 分发)
2. **session 元数据类型**——`SessionInfo`(IPC 序列化)、`SessionType`(local/ssh/tmux 区分)
3. **id 分配器类型**——`SessionIdSource`(Arc 共享 + AtomicU32 单调递增)
4. **派生计算**(accessor)——纯查询函数(根据 id 找 session、根据 type 过滤)
5. **算法**(rules)——纯变更函数(`withStatus / applyDisplayConfig`)

## 2. 这个 domain **不**负责什么

- **不持有运行时状态**——纯类型 + 纯函数
- **不调 IPC**——所有 IPC 走 service 或 app
- **不存 workspace / pane 树**——归 `models/workspace/`
- **不存 tmux controller 状态**——归 `models/tmux/`
- **不存 settings 字段**——归 `models/settings/`
- **不存 capability flags**——归 `models/cross-cutting/`
- **不存 group**——归 `models/workspace/`
- **不存 image upload helper**——归 `models/cross-cutting/helpers`

## 3. 子结构

```
models/session/
├── mod.rs               re-export types / accessor / rules / errors
├── types.rs             SessionType / SessionInfo / SessionConfig / LocalSessionConfig / SSHSessionConfig / SessionLoggingConfig / SessionIdSource / SizingMode / DisplayConfig / EnvConfig
├── accessor.rs          纯查询:按 id 查、按 type 过滤
├── rules.rs             纯变更:withStatus / applyDisplayConfig / withCapability
└── errors.rs            SessionConfigError / SessionError(thiserror)
```

**关键**:v3 的 `SessionIdSource` 在 `models/session.rs:21`,v4 移到本 domain 的 `types.rs`(或 `cross-cutting/ids.rs`——见 §4.2)。

## 4. v3 → v4 拆分映射

| v3 位置(在 session.rs) | v4 位置 | 改动 |
|---|---|---|
| `SessionIdSource` (line 21) | `models/session/types.rs` | 保留在 session domain(理由:id 是 session 生命周期的一部分) |
| `SessionType` enum (line 48) | `models/session/types.rs` | 不动 |
| `SessionInfo` (line 75) | `models/session/types.rs` | 不动 |
| `LocalSessionConfig` (line 104) | `models/session/types.rs` | 不动 |
| `SSHSessionConfig` (line 138) | `models/session/types.rs` | 不动 |
| `SplitDirection` enum (line 222) | **`models/cross-cutting/types.rs`** | 拆分——不是 session 专属,3 种 backend 都用 |
| `AttachedTmuxServer` (line 258) | **`models/tmux/types.rs`** | 拆分——tmux 专属 |
| `TmuxCcConfig` (line 291) | **`models/tmux/types.rs`** | 拆分——tmux 专属 |
| `tmux_pane_info()` fn (line 418) | **`models/tmux/accessor.rs`** | 拆分——tmux helper |
| `TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit` (line 481-532) | **`models/tmux/types.rs`** | 拆分——tmux 专属 |
| `SessionConfig` enum (line 550) | `models/session/types.rs` | 保留——dispatcher 入口 |
| `SessionLoggingConfig` (line 564) | `models/session/types.rs` | 不动 |
| `SizingMode / DisplayConfig / EnvConfig` (line 590-671) | **`models/settings/types.rs`** | 拆分——settings 字段 |
| `SavedSessionConfigV1 / SavedSessionConfigKind` (line 710-729) | **`models/settings/types.rs`** | 拆分——持久化的 saved config |
| `build_remote_image_path()` fn (line 1516) | **`models/cross-cutting/helpers.rs`** | 拆分——跨域 helper |

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `models/workspace` | Session 持有反向引用 `workspaceId / windowId / paneId`(纯类型字段) |
| `models/tmux` | Session 的 `SessionType::TmuxCc` 变体引用 `controller_id / pane_id / session_name`(`models/tmux` 的字段) |
| `models/settings` | Session 的 default 值(`SizingMode / DisplayConfig / EnvConfig`)从 settings 读(纯类型引用) |
| `models/cross-cutting` | Session 使用 `SplitDirection`(来自 cross-cutting),`CapabilityFlags` 来自 cross-cutting |

**关键约束**:
- session model **不** import `models/workspace::*` 或 `models/tmux::*` 或 `models/settings::*` 的**内部**(types 字段引用允许——因为纯类型不含逻辑)
- session model **不** import 任何 service / app / infra
- session model **允许** import `models/cross-cutting::*`(因为 cross-cutting 是最底层)

## 6. 跟 service / app / infra 的关系

| 层 | 怎么用 models/session |
|---|---|
| `services/session` | `SessionInfo` 是中央状态机的 value 类型;`SessionConfig` 是 create_* 方法参数 |
| `services/tmux` | 通过 `models/tmux` 间接使用;`TmuxCcConfig` 是 spawn_create 的参数 |
| `app/session` | `SessionConfig` 是 `#[tauri::command]` 入参;`SessionInfo` 是 IPC 返回类型 |
| `app/terminal` | `TmuxCcConfig` 是 create_tmux_session 的入参;`TmuxSessionInit` 是返回类型 |
| `infrastructure/pty` | `LocalSessionConfig` 是 PtyPair::spawn 的参数 |
| `infrastructure/ssh` | `SSHSessionConfig` 是 russh connect 的参数 |

## 7. 这个 domain 的"产品语言"术语

- **session** —— 一个后台进程 + 它的连接配置 + 状态
- **local session** —— 本地 PTY(local shell)
- **ssh session** —— 远程 SSH(russh)
- **tmux session** —— tmux -CC controller 下的 pane(归 `models/tmux`)
- **session id** —— AtomicU32 单调递增的全局唯一 id
- **SessionInfo** —— 跨 IPC 边界的 session 元数据序列化形态
- **SessionConfig** —— 跨 IPC 边界的 session 创建配置(enum 分发)
- **SessionType** —— session 类型枚举(local / ssh / tmux-cc)
- **display config** —— 运行时可调的字体 / 字号 / theme(MVP backend 只持有 type,不应用)
- **SessionLoggingConfig** —— 日志配置(start_session_logging 的入参)

## 8. 关键设计约束

### 8.1 类型必须 Serialize + Deserialize(IPC 序列化)

所有跨 IPC 边界的类型必须 derive `Serialize + Deserialize`,字段命名按 `serde(rename_all = "camelCase")`(与 frontend TS 类型对齐)。

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
    pub capabilities: CapabilityFlags,
    // ...
}
```

### 8.2 构造器返回 Result<Self, SessionConfigError>

不变量靠 `#[derive]` + 构造器 + 校验方法保证。例如 `SessionConfig::try_new(...)` 应该返回 `Result<Self, SessionConfigError>` 而不是 `Self`。

```rust
impl LocalSessionConfig {
    pub fn try_new(shell: String, cwd: String) -> Result<Self, SessionConfigError> {
        if shell.is_empty() { return Err(SessionConfigError::EmptyShell); }
        if cwd.is_empty() { return Err(SessionConfigError::EmptyCwd); }
        Ok(Self { shell, cwd, ... })
    }
}
```

### 8.3 accessor / rules 是 pure function

```rust
// accessor:不修改数据,返回原数据 + 派生值
pub fn filter_by_type(sessions: &[SessionInfo], session_type: SessionType) -> Vec<SessionInfo> {
    sessions.iter().filter(|s| matches!(s.session_type, session_type)).cloned().collect()
}

// rules:不可变,返回新对象
pub fn with_status(session: &SessionInfo, status: SessionStatus) -> SessionInfo {
    SessionInfo { status, ..session.clone() }
}
```

**关键**:rules 函数**不可变**——返回新对象,旧对象可安全丢弃。这让 service store 触发引用比较时正常工作。

### 8.4 SessionIdSource 持有 Arc 共享

```rust
pub struct SessionIdSource {
    next_id: AtomicU32,
}

impl SessionIdSource {
    pub fn new(start: u32) -> Arc<Self> {
        Arc::new(Self { next_id: AtomicU32::new(start) })
    }

    pub fn allocate(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Borrow the inner Arc for injection into a controller's session_id_allocator closure
    pub(crate) fn shared_allocator(self: &Arc<Self>) -> Arc<dyn Fn() -> u32 + Send + Sync> {
        let source: Arc<Self> = Arc::clone(self);
        Arc::new(move || source.allocate())
    }
}
```

**关键**:`SessionIdSource` 必须是 `Arc<SessionIdSource>`——3 种 backend + tmux controller 共享一个 allocator。

### 8.6 现状 v3 有 typed error 缺失

v3 `models/session.rs` 没有 `SessionConfigError`——构造器是直接 `pub fn new(shell: String, cwd: String) -> Self` 没有校验。v4 引入 typed error:

```rust
#[derive(Debug, thiserror::Error)]
pub enum SessionConfigError {
    #[error("shell command is empty")]
    EmptyShell,
    #[error("cwd is empty")]
    EmptyCwd,
    #[error("ssh host is empty")]
    EmptySshHost,
    #[error("ssh port {0} is out of range")]
    InvalidSshPort(u16),
    // ...
}
```

## 9. 强制约束(可机械校验)

```bash
# models/session 不 import 其他 domain(除 types 字段引用)
grep -rn 'use crate::models::\(workspace\|tmux\|settings\)::' src-tauri/src/models/session/
# 必须为空(types.rs 内允许 `use crate::models::tmux::types::*` 引用 controller_id 等纯字段)

# models/session 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/session/
# 必须为空

# models/session 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/session/
# 必须为空
```

## 10. 测试

每个子文件都有 `*.test.rs`(在 v3 基础上补充):

- `types.rs` 的 try_new 构造器 100% 覆盖
- `accessor.rs` 的查询函数(参数边界 + 边界 case)
- `rules.rs` 的不可变更新(返回新对象 + 旧对象不变)

**为什么 model 测试最重要**:
- **model 是最底层**——上层(service / app)都依赖它
- **model 出 bug = 全 app 出 bug**——下游影响范围最大
- **model 是纯函数**——测试简单,无需 mock

## 11. 依赖变更流程

### 11.1 新增 session field

```
1. models/session/types.rs           # 加 field + 更新 struct
2. models/session/rules.rs           # 加 immutable update function
3. models/session/accessor.rs        # 加 query helper(如果需要)
4. services/session/manager.rs       # 更新 SessionManager 内部状态
5. app/session/api.rs                # 读 / 写新字段(IPC payload key)
6. 更新本文档 §4 + §5
```

### 11.2 拆分类型(从 session 迁到其他 domain)

```
1. models/<other>/types.rs           # 加新 struct(迁入目标)
2. models/session/types.rs           # 删旧 struct,改引用新位置
3. 所有 use crate::models::session::OldType → use crate::models::<other>::types::NewType
4. 更新本文档 §4 + §5
5. cargo check 全仓(批量改名)
```