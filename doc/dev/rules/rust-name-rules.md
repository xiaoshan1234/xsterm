# Rust 代码命名规范（团队统一标准版）

## 前言

本规范适用于 xsterm 后端 `src-tauri/` 目录下的所有 Rust 代码，统一 **变量、常量、函数、参数、模块、Trait、结构体、枚举、错误、文件、crate** 命名规则。规范以 [Rust API Guidelines (Naming)](https://rust-lang.github.io/api-guidelines/naming.html) 为基准，针对本项目（Tauri 2 + portable-pty + russh + tmux -CC 控制器）的实际场景做了补充与裁剪。

核心原则：**遵循 Rust 标准惯例、语义化、简洁不缩写、见名知意、严格区分大小写、与 serde/Tauri IPC 边界一致**。

## 一、通用基础规则（强制）

- **强制**：所有标识符命名必须遵循 Rust 标准 —— 类型 `UpperCamelCase`、函数/变量/模块 `snake_case`、常量 `SCREAMING_SNAKE_CASE`。编译器会强制大小写（`Foo` 不能用 `foo` 引用），但 **前缀/后缀约定** 仍靠规范约束。
- **禁止**：拼音命名、无意义单词（`tmp`, `obj`, `data`, `val`, `res`）、中文命名、`_` 开头/结尾的变量（除了编译器约定的 `let _ = ...` 占位）。
- **禁止**：随意缩写。允许的通用缩写：`id`, `pty`, `ssh`, `rpc`, `ipc`, `cmd`, `tmux`, `cc`（tmux -CC 协议专用）、`cwd`, `pid`, `ttl`, `msg`, `buf`, `err`。其他业务术语首次出现必须展开（`window_id` ✅, `wid` ❌）。
- **强制**：布尔值统一使用状态语义前缀（`is_` / `has_` / `should_` / `can_`）。
- **强制**：命名纯英文，语义精准，避免歧义。
- **禁止**：类型、变量、模块同名冲突（包括跨 crate 重名导出时加 `as` 别名而不是改原名）。

## 二、变量命名规则

### 2.1 普通变量（`let` 绑定）

**格式**：`snake_case`

**规则**：语义化名词/动宾结构，描述变量内容；多单词用下划线分隔。

```rust
// ✅ 正确
let user_name = String::new();
let session_info = SessionInfo::default();
let pane_count: usize = 4;

// ❌ 错误
let username = String::new();      // 无下划线
let a = String::new();             // 无意义
let yongHuMing = String::new();   // 拼音
```

### 2.2 布尔变量

**格式**：`snake_case`，固定前缀 **`is_` / `has_` / `should_` / `can_` / `should_`**

```rust
// ✅ 正确
let is_attached = true;
let has_pane = false;
let can_resize = true;
let should_retry = false;

// ❌ 错误
let attached = true;
let error_state = true;
let resized: bool;                // 形容词不是布尔命名
```

### 2.3 集合变量

**规则**：复数名词 / 集合后缀

```rust
// ✅ 正确
let pane_ids: Vec<String> = vec![];
let active_sessions: HashMap<SessionId, Arc<ActiveSession>> = HashMap::new();
let log_entries: VecDeque<LogEntry> = VecDeque::new();

// ❌ 错误
let pane = vec![];                // 单数但装多个
let pane_arr: Vec<String> = vec![]; // 禁止带 _arr/_vec 后缀
let panes_map: Vec<String> = vec![]; // 类型后缀命名
```

### 2.4 常量（`const` / `static`）

**格式**：`SCREAMING_SNAKE_CASE`（全大写 + 下划线）

**适用**：编译期常量、配置魔数、协议常量、IPC 事件名。

```rust
// ✅ 正确
const MAX_PANE_BYTES: usize = 64 * 1024;
const DEFAULT_SHELL: &str = "/bin/bash";
const SESSION_OUTPUT_EVENT: &str = "session-output";

// ❌ 错误
const maxPaneBytes: usize = 64 * 1024;
const max_pane_bytes_str: &str = "...";   // 带类型后缀
```

> **特殊例外**：`LazyLock<T>`/`OnceLock<T>` 包装的运行时单例用 `snake_case`，因为它们本质是静态变量（详见 §3.4）。

### 2.5 生命周期参数

**格式**：短小语义化小写字母，按惯例使用：

```rust
// 常用约定（不强制）
fn parse<'a>(input: &'a str) -> &'a str { input }
fn first<'src, 'dst>(src: &'src str) -> &'dst str  // 多场景区分语义
```

## 三、函数/方法命名规则

**格式**：`snake_case`

**规则**：动词 + 名词，体现行为逻辑。

**常用动词规范**：

| 动词 | 用途 | 示例 |
|---|---|---|
| `get_` | 无副作用读取 | `get_session`, `get_log_config_impl` |
| `set_` | 无校验写入字段 | `set_cursor_pos` |
| `update_` | 校验后修改 | `update_pane_size` |
| `create_` | 构造并返回 | `create_local_session`, `create_ssh_session` |
| `build_` | 构造（不分配资源） | `build_remote_image_path` |
| `new_` / `init_` | 构造器 | `SessionManager::new` |
| `send_` | 异步/单向发出 | `send_keys`, `send_command` |
| `handle_` | 事件/请求入口 | `handle_session_create` |
| `try_` | 返回 `Option` 或 `Result`，可能失败 | `try_resize_pane` |
| `parse_` / `format_` | 解析/格式化 | `parse_wire_frame` |
| `is_` / `has_` / `can_` | 谓词 | `is_attached`, `has_pane` |
| `_impl` 后缀 | Tauri command 的内部实现函数（IPC 边界以外的纯逻辑） | `save_attached_tmux_servers_impl` |

```rust
// ✅ 正确
fn get_user_info() -> SessionInfo { ... }
fn handle_session_close(id: SessionId) { ... }
fn init_logging(dir: &Path, cfg: &LogConfig) -> ReloadHandle { ... }
fn try_acquire_pane(pane_id: &str) -> Option<PaneHandle> { ... }

// ❌ 错误
fn userInfo() { ... }               // 无下划线
fn sessionCloseDo() { ... }         // 拼音/拼凑
fn pane() { ... }                   // 名词无动词
```

**事件/请求处理函数统一前缀**：`handle_xxx`，与 Tauri command 一一对应。

### 3.1 转换函数命名

按 Rust 标准惯例：

- `as_`  免费 IETF 廉价 / 无损转换（`&str -> &str`）
- `to_`  可能分配 / 转换所有权（`&str -> String`）
- `into_`  消耗 `self` 的转换（`self -> Self::Other`）

```rust
// ✅ 正确
fn as_bytes(&self) -> &[u8];
fn to_string(&self) -> String;
fn into_owned(self) -> OwnedBuf;
```

### 3.2 迭代器方法

链式调用方法使用动词原形或现在分词：

```rust
items.iter().filter().map().collect()
sizes.into_iter().filter(|s| s.can_fit).sum()
```

### 3.3 错误返回函数

返回 `Result<T, E>` 的函数用动词；返回 `Option<T>` 的可在动词前加 `try_`：

```rust
pub fn close(self: Box<Self>) -> Result<(), String>;     // 动词
pub fn try_resize(&mut self, rows: u16) -> Option<()>;    // try_
```

### 3.4 静态/单例变量

```rust
// 运行时单例用 snake_case（与 const 区分）
static RELOAD_HANDLE: OnceLock<ReloadHandle> = OnceLock::new();
```

## 四、Tauri Command 命名

Command 名是 **前后端契约**，字符串字面量必须与 `sessionService.ts` 一致。

**格式**：`snake_case`，动词开头；不带参数后缀。

```rust
// ✅ 正确
#[tauri::command]
pub async fn create_local_session(config: LocalSessionConfig) -> Result<SessionId, String> { ... }

#[tauri::command]
pub async fn close_session(id: SessionId) -> Result<(), String> { ... }

#[tauri::command]
pub async fn list_sessions() -> Result<Vec<SessionInfo>, String> { ... }

// ❌ 错误
#[tauri::command]
pub async fn createLocalSession(...) { ... }      // camelCase
#[tauri::command]
pub async fn create_session_cmd(...) { ... }      // 带 _cmd 后缀
```

**实现函数后缀 `_impl`**：command 入口只做参数提取 + 调用 `xxx_impl`：

```rust
#[tauri::command]
pub async fn save_attached_tmux_servers(servers: Vec<AttachedTmuxServer>) -> Result<(), String> {
    save_attached_tmux_servers_impl(servers).await.map_err_string()
}

pub async fn save_attached_tmux_servers_impl(servers: Vec<AttachedTmuxServer>) -> Result<(), AppError> {
    // 纯逻辑，可被单元测试直接调用
}
```

## 五、Rust 类型与 Trait 规范（核心重点）

### 5.1 结构体 `struct`

**格式**：`UpperCamelCase`

**规则**：语义名词，**禁止 `T_` / `S_` 前缀**（避免与泛型混淆）。

**常用后缀**：

| 后缀 | 用途 | 示例 |
|---|---|---|
| `Info` | 完整主体信息 | `SessionInfo`, `TmuxPaneInfo` |
| `Config` | 配置参数 | `LocalSessionConfig`, `TmuxCcConfig` |
| `Handle` | 资源句柄 | `TmuxPaneHandle`, `ReloadHandle` |
| `Init` | 初始化数据结构 | `TmuxSessionInit`, `TmuxControlWindowInit` |
| `Outcome` | 结果（Result 解构后的扁平结构）| `AutoAttachOutcome` |
| `Flags` | 位标志集合 | `CapabilityFlags` |
| `Id` | ID 类型 | `SessionId`, `WindowId` |
| `Error` | 错误类型 | `AppError`, `TmuxError` |
| `State` | 内部可变状态 | `RouterState` |

```rust
// ✅ 正确
pub struct SessionInfo { ... }
pub struct LocalSessionConfig { ... }
pub struct TmuxPaneHandle { ... }

// ❌ 错误
pub struct S_SessionInfo { ... }   // S_ 前缀
pub struct session_info { ... }    // snake_case（编译器拒绝）
pub struct SessionInfoDTO { ... }  // 禁止 _DTO 后缀（用 serde tag 区分）
```

### 5.2 枚举 `enum`

**格式**：`UpperCamelCase`

**变体格式**：`UpperCamelCase`（与类型同名空间，**不是 `SCREAMING_SNAKE_CASE`** —— 这是 Rust 与 TypeScript 的关键差异）。

```rust
// ✅ 正确
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

pub enum SessionError {
    NotFound,
    PermissionDenied(String),
    Io(std::io::Error),
}

// ❌ 错误（TS 习惯带到 Rust）
pub enum SplitDirection {
    HORIZONTAL,        // 全大写（TS enum 写法）
    VERTICAL,
}
```

### 5.3 Trait

**格式**：`UpperCamelCase`

**规则**：语义名词或形容词；表示能力的 trait 用动词-ing / -able 后缀。

```rust
// ✅ 正确
pub trait SessionBackend: Send + Sync { ... }
pub trait PtySystem { ... }
pub trait StringError<T> { ... }
pub trait Resizable { ... }
pub trait IntoPaneId { ... }           // 类型转换（少见）

// ❌ 错误
pub trait session_backend { ... }      // snake_case（编译器拒绝）
pub trait ISessionBackend { ... }      // 禁止 I 前缀
pub trait SessionBackendTrait { ... }  // 禁止 _Trait 后缀
```

### 5.4 类型别名 `type`

**格式**：`UpperCamelCase`

```rust
// ✅ 正确
pub type SessionId = u32;
pub type PaneId = String;
pub type Result<T> = std::result::Result<T, AppError>;  // crate-local Result 别名

// ❌ 错误
pub type session_id = u32;          // snake_case
pub type SessionIdType = u32;         // 禁止 _Type 后缀
```

### 5.5 泛型参数

**格式**：**大写单字母**（惯例）或 **UpperCamelCase 业务语义名**（当类型有具体含义时）。

```rust
// ✅ 正确
fn first<T>(items: &[T]) -> &T { ... }                       // 通用占位
fn map_pane<TPane: PaneIdLike, TState: Send>(...) { ... }    // 业务语义

// ❌ 错误
fn first<t>(items: &[t]) -> &t { ... }                       // 小写
fn first<TPaneType>(items: &[TPaneType]) { ... }             // 禁止 _Type 后缀
```

### 5.6 新类型 `Newtype`

**格式**：`UpperCamelCase`，与包装类型同名但语义化。

```rust
// ✅ 正确
pub struct SessionId(pub u32);
pub struct WindowId(pub String);

// ❌ 错误
pub struct SessionIdWrapper(pub u32);   // 禁止 _Wrapper 后缀
pub struct session_id_type(pub u32);    // snake_case + _type
```

## 六、模块与文件命名规范

### 6.1 文件名

**格式**：`snake_case`（Rust 强制 `mod foo;` 与 `foo.rs` 对应）。

```rust
// ✅ 正确
session_manager.rs
tmux_pane_handle.rs
binary_frame.rs

// ❌ 错误
SessionManager.rs          // camelCase
sessionManager.rs
session_manager_impl.rs    // 禁止 _impl 后缀（除非是测试配套）
```

### 6.2 模块名（`mod`）

**格式**：`snake_case`，与文件名一致。

```rust
// ✅ 正确
mod session_manager;
mod tmux_session;
mod infrastructure;

// ❌ 错误
mod SessionManager;        // 编译器拒绝
mod TmuxSession;
```

### 6.3 Crate 名

**格式**：`snake_case`（Cargo.toml `[lib]` / `[package]` `name`）。

本项目所有 crate 都是 `xsterm_*` 前缀（保留产品品牌），例如：`xsterm-core`, `xsterm-tmux`（未来拆分时）。

```toml
# ✅ 正确
[package]
name = "xsterm"

# ❌ 错误
name = "xsterm-core-crate"   // 禁止 _crate 后缀
name = "Xsterm"              // 大写
```

### 6.4 模块分层约定

本项目已固定的目录分层（见 `doc/dev/architecture/01-logical-view.md`）：

| 目录 | 职责 | 示例 |
|---|---|---|
| `commands/` | Tauri command 入口（薄壳） | `session.rs`, `persistence.rs` |
| `services/` | 业务逻辑 + 状态管理 | `session_manager.rs`, `tmux_session/` |
| `infrastructure/` | 外部适配层（PTY/SSH/tmux wire） | `pty.rs`, `ssh.rs`, `tmux/backend.rs` |
| `models/` | 纯数据结构 | `session.rs`, `group.rs`, `capabilities.rs` |
| `services/tmux_session/{protocol,controller,bridge}/` | 子模块按职责切分 | 见 `tmux_session/protocol/{wire,codec,events,parser,command,version}.rs` |

新增模块必须放进对应目录，不允许 `services/foo/bar.rs` 与 `services/foo_bar.rs` 同主题并存。

## 七、错误类型规范

### 7.1 错误枚举

**格式**：`<CrateName>Error` 或按主题 `XxxError`，变体用 `UpperCamelCase`。

```rust
// ✅ 正确
pub enum AppError {
    NotFound,
    PermissionDenied(String),
    Io(std::io::Error),
}

pub enum TmuxError {
    HandshakeFailed,
    ParseFailed(String),
    RouterClosed,
}

// ❌ 错误
pub enum AppErr { ... }                // 缩写
pub enum APP_ERROR { ... }             // SCREAMING（不是类型）
```

### 7.2 错误转换 trait

`From<E> for Self`、`Display`、`std::error::Error` 是惯用法，不强制自定义 trait。

### 7.3 Tauri IPC 边界错误

在 command 返回 `Result<T, String>` 时使用 `StringError` trait（见 `src-tauri/src/error.rs`）：

```rust
use crate::error::StringError;

#[tauri::command]
pub async fn close_session(id: SessionId) -> Result<(), String> {
    close_session_impl(id).await.map_err_string()
}
```

`AppError::Display` 实现必须可读，前端会直接展示。

## 八、常用统一后缀规范（杜绝命名混乱）

| 后缀 | 用途 | 示例 |
|---|---|---|
| `Info` | 完整主体信息 | `SessionInfo`, `PaneInfo` |
| `Config` | 配置参数 | `LocalSessionConfig`, `TmuxCcConfig` |
| `Handle` | 资源句柄（持有内部锁 / Arc） | `TmuxPaneHandle`, `ReloadHandle` |
| `Init` | 一次性初始化数据结构 | `TmuxSessionInit` |
| `Outcome` | Result 解构后的扁平结果结构 | `AutoAttachOutcome` |
| `Flags` | 位标志集合（`bitflags!` 或自定义结构） | `CapabilityFlags` |
| `Id` | 强类型 ID（newtype） | `SessionId`, `WindowId`, `PaneId` |
| `Error` | 错误类型 | `AppError`, `TmuxError` |
| `State` | 内部可变状态机 | `RouterState`, `HandshakeState` |
| `Backend` | 抽象层 / 适配器实现 | `SessionBackend`, `AppBackend` |
| `System` | 抽象子系统 | `PtySystem`, `SshSystem` |
| `Impl` | 适配器的具体实现（私有） | `SshBackendImpl`, `NativePtySystem` |
| `Pair` | 二元组资源 | `PtyPair` |
| `Wrapper` | 已有类型的薄包装 | `SshSessionWrapper` |
| `_impl` 后缀 | command 内部纯逻辑函数 | `save_attached_tmux_servers_impl` |
| `tests` | 同模块的内联测试（`#[cfg(test)] mod tests`） | `local_session/tests.rs` |

> **禁止后缀**：`_dto`, `_model`, `_vo`, `_bean`, `_po`, `_entity`（来自 Java/TS 习惯，Rust 用 serde rename / newtype 表达边界）。
>
> **禁止后缀**：`_util`, `_helper`, `_common`, `_shared`, `_misc`（不能体现职责，新建有意义的子模块）。

## 九、测试代码命名

### 9.1 测试模块

**格式**：`#[cfg(test)] mod tests`（惯例），或独立文件 `tests.rs`。

```rust
// ✅ 正确（内联）
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_wire_frame_rejects_truncated_header() { ... }
}

// ✅ 正确（拆文件）
// session_manager.rs
#[cfg(test)]
mod tests;

// tests.rs
#[test]
fn ... { ... }
```

### 9.2 测试函数

**格式**：`snake_case`，格式：`<被测函数>_<场景>_<期望结果>`

```rust
// ✅ 正确
#[test]
fn resize_pane_with_zero_rows_returns_err() { ... }

#[test]
fn parse_wire_frame_accepts_complete_header() { ... }

// ❌ 错误
#[test]
fn test1() { ... }                       // 无意义
#[test]
fn TestResize() { ... }                   // PascalCase
```

### 9.3 Mock 类型

**格式**：`<被模拟类型>Mock` 或 `<场景>Mock`，**UpperCamelCase**。

```rust
// ✅ 正确
pub struct MockPtySystem { ... }
pub struct FailingSshBackend { ... }     // 描述行为

// ❌ 错误
pub struct mock_pty_system { ... }        // snake_case
pub struct PtySystemMock { ... }          // 可以，但顺序不自然
```

## 十、禁止黑名单（严格禁用）

```rust
// 全部禁止
let tmp, obj, data, val, res          // 无意义通用名
let aa, bb, cc                        // 随机命名
let 用户名, 状态                       // 中文命名
let user_str, user_arr                // 类型后缀命名
fn handleSomeThing() { }              // camelCase 函数
struct S_SessionInfo { }              // S_ 前缀
trait ISessionBackend { }             // I 前缀（接口，TS 习惯带过来）
enum AppErr { }                       // 缩写
const maxPaneBytes: usize = ...;      // camelCase 常量
mod SessionManager;                   // PascalCase 模块
```

## 十一、Rust 与 TypeScript 命名差异速查

新人 / 全栈成员常把 TS 习惯带到 Rust，这里列出关键差异：

| 维度 | TypeScript（`ts-name-rules.md`） | Rust（本规范） |
|---|---|---|
| 函数 | `getUserInfo`（camelCase） | `get_user_info`（snake_case） |
| 变量 | `userName` | `user_name` |
| 常量 | `MAX_PAGE_SIZE` | `MAX_PAGE_SIZE`（一致） |
| 类型 | `UserInfo` | `UserInfo`（一致） |
| 接口 | `interface UserInfo`（无 I 前缀） | `trait UserInfo`（无 I 前缀） |
| 枚举项 | `enum Status { SUCCESS = '...' }` | `enum Status { Success, ... }`（不是全大写） |
| 接口前缀 | 禁止 `IUserInfo` | 禁止 `IUserInfo` |
| 文件 | `userInfo.ts`（camelCase） | `user_info.rs`（snake_case） |
| 泛型 | `<T>` 或 `<ItemType>` | `<T>` 或 `<TPane>`（避免 `_Type` 后缀） |
| DTO 后缀 | 偶尔用 | 禁止，用 newtype 表达 |
| Boolean | `isHydrated` | `is_hydrated` |

## 十二、快速速查对照表（极简总结）

| 代码类型 | 命名格式 | 示例 |
|---|---|---|
| 普通变量 / 函数 / 模块 | `snake_case` | `pane_count`, `send_keys`, `tmux_session` |
| 布尔变量 | `is_/has_/should_/can_` 前缀 | `is_attached`, `has_pane` |
| 常量 / `static` | `SCREAMING_SNAKE_CASE` | `MAX_PANE_BYTES` |
| 结构体 / 枚举 / Trait / 类型别名 | `UpperCamelCase` | `SessionInfo`, `SessionBackend`, `AppError` |
| 枚举变体 | `UpperCamelCase`（**不是**全大写） | `SplitDirection::Horizontal` |
| 泛型参数 | 大写单字母 / 业务语义 | `T`, `TPane` |
| 文件名 | `snake_case.rs` | `session_manager.rs` |
| Crate 名 | `snake_case` | `xsterm` |
| Tauri command | `snake_case` + 动词 | `create_local_session` |
| 实现函数（command 内部） | `<command>_impl` | `save_attached_tmux_servers_impl` |
| 测试函数 | `<fn>_<scenario>_<expected>` | `resize_pane_with_zero_rows_returns_err` |
| Mock 类型 | `<Type>Mock` / `<Behavior>` | `MockPtySystem`, `FailingSshBackend` |
| 新类型 ID | `XxxId`（newtype） | `SessionId(u32)` |

## 十三、引用规范

- Rust API Guidelines — Naming: <https://rust-lang.github.io/api-guidelines/naming.html>
- The Rust Programming Language — 命名约定: <https://doc.rust-lang.org/book/ch06-00-enums.html>
- clippy `pedantic` 默认启用的命名 lint: `clippy::enum_variant_names`, `clippy::module_name_repetitions`
- 项目内配套规范：`doc/dev/rules/ts-name-rules.md`、`doc/dev/architecture/01-logical-view.md`

---

> （注：部分内容可能由 AI 生成；正式落地前请 dev/tm 评审。）