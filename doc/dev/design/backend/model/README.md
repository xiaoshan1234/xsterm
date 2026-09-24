# Backend · Model 层 (= `src-tauri/src/models/`)

> **职责**：纯数据 + 不变量。没有任何 I/O、tokio、Tauri、serde 之外的依赖（serde 是边界必需，例外允许）。
>
> model 是整个后端的「最底层」。其他三层**永远**依赖它，它**永远**不依赖其他三层。

## 1. 模块清单（现状）

```
src-tauri/src/models/
├── mod.rs            re-export 3 个子模块
├── session.rs        SessionConfig / SessionMetadata / SessionKind（local/ssh/tmux）
├── group.rs          Group / GroupConfig（侧边栏分组）
└── capabilities.rs   BackendCapabilities（pty/ssh/tmux 各自能力探测结果）
```

## 2. 关键约束

- **禁止**任何 `tokio` / `tauri` / `std::net` / `std::process` import。
- **禁止**在 model 文件里调用 service 或 infra 的方法。
- **不变量靠 `#[derive]` + 构造器 + 校验方法**保证。例如 `SessionConfig::new(...)` 应该返回 `Result<Self, ConfigError>` 而不是 `Self`。
- **序列化**：所有需要跨 IPC 边界的类型 `#[derive(Serialize, Deserialize)]`，字段命名按 `serde(rename_all = "camelCase")`（与前端 TS 类型对齐）。
- **允许 `serde` 派生**，因为 IPC 序列化是 model 的本职。其他第三方 crate 默认不允许——加新依赖前先看是否真的需要。

## 3. 三个子模块的边界

- **`session.rs`** — 任何跟"会话"相关的纯数据：配置（创建参数）、元数据（运行时信息：pid、started_at、bytes_written）、kind（local/ssh/tmux 枚举）。
- **`group.rs`** — UI 侧边栏的分组数据，独立于 session 概念。可以为空（没分组的 session）。
- **`capabilities.rs`** — 启动时探测的结果。local backend 一定有 PTY；SSH 后端有 SSH；tmux 二进制存在与否决定能不能用 tmux -CC。这是 service 层决策的输入。

## 4. 跨层共享字段

model 是 service ↔ service 之间共享数据的**唯一合法通道**。

典型例子：tmux controller 需要让 `SessionManager::create_tmux` 能查到「这个 xsterm session id 对应的 tmux window id」。当前实现是把 binding 表藏在 controller 内部，bug 0009 就是因为 `SessionManager` 不知道去查。

**改进方向**：把这种 binding 类型提升到 model 层（如 `models::tmux_binding.rs`），service 层只能读，不能藏状态。

## 5. 依赖方向

```
models/   ◄─── 任何层都可读 models
   │
   └─►  仅 serde / thiserror / derive_more 等纯派生 crate
```

model 不 import 任何 `crate::*`。

## 6. 改进方向

- **拆出 `tmux.rs` 子模块**：tmux 相关的 binding 数据（xsterm_window_id ↔ tmux_window_id 映射、attach server 列表）目前散在 controller 的 HashMap 里。下一步把这些"跨 service 共享的状态"提到 `models/tmux.rs`，controller 只持有引用。
- **加 `validate()` 方法**：现状 `SessionConfig` 没有"启动前必填字段检查"，是 service 层在 spawn 时才报错。把校验下沉到 `SessionConfig::try_new()`，service 只看 `Result`。
- **`Group` 当前非常薄**，未来可能需要 `GroupRule`（自动归类规则）。先预留位置，不急。
- **capabilities.rs 改用 bitflags**：现在是 3 个独立 bool，未来如果加新能力位（剪贴板、图片、GPU 加速渲染），`bitflags!` 更省事。
