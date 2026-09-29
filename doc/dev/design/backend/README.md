# Backend · 顶层架构

> **位置**：`src-tauri/src/` 下的 3 层架构（commands / domain / infra）
> **关注点**：把 frontend IPC 调用映射到 Rust 后端的 3 个正交层
> **设计原则**：backend 不需要 ui 层（frontend 多 ui 是因为有视图，backend 没视图）；service 跟 model 边界模糊，合并为 domain

## 1. 3 层架构全景

```
src-tauri/src/                                            （语义名）
├── commands/    Tauri IPC 编排（3 module 按产品功能切）+ 跨 module 协调
│   ├── session/      session lifecycle IPC + MCP attach（P1-3）
│   ├── terminal/     tmux IPC + attached_tmux 持久化
│   └── shell/        启动钩子 + log runtime IPC + user config IPC（v5.1）
├── domain/      业务核心：状态机 + 持久化 + 纯数据 + 算法（合并 service + model，砍掉 settings / workspace / persistence）
│   ├── session/      SessionManager + 3 backend 实现 + settings 字段 + MCP attach 注册表（P1-3）
│   └── terminal/     TmuxController（单一 controller/mod.rs 文件，P1-2 不再拆 state.rs）+ tmux 协议层 + attached_tmux 持久化
├── infra/       物理适配（5 子模块按外部资源切）
│   ├── config_watcher/ 用户配置文件（PRD §2 M9 — TOML + notify watch + schema；v5.1 新增）
│   ├── pty/          OS PTY 子进程（portable-pty）
│   ├── ssh/          SSH 协议（russh）
│   ├── tmux/         tmux 控制模式（外部子进程）
│   └── tauri/        Tauri runtime（AppBackend + binary_frame）
└── integration/ ⭐ 第 4 类（集成层——AI agent 接入，独立于 3 层架构）
    └── mcp/         MCP server（PRD §2 M6 + M7 差异化组件；rmcp SDK；stdio 默认 + 可选 TCP）
```

| 层 | 职责 | 子结构数 | 子结构 |
|--|--|--|--|
| `commands/` | Tauri IPC 编排 | 3 module | session / terminal / shell |
| `domain/` | 业务核心（状态机 + 类型 + 算法 + 持久化）| **2 domain** | session / terminal |
| `infra/` | 物理适配（PTY / SSH / tmux / Tauri / config_watcher v5.1）| 5 子模块 | pty / ssh / tmux / tauri / config_watcher |

**与 frontend 的关系**：

- frontend `app/` **6 module** ↔ backend `commands/` **3 module**（workspace 完全 frontend 持有；settings 跨多 backend：attached_tmux → `domain/terminal`，**session_log → `commands/session`——P1-5**，log_config → `commands/shell`，**v5.1 新增 user config.toml 走 `infra/config_watcher`**；**MCP server 归 frontend `app/mcp/`** —— 复杂业务放 TS 层，backend 只暴露 IPC 桥 + stdio transport helper）
- frontend `model/` ↔ backend `domain/` 内嵌 types —— **同名镜像**（不同语言：Rust serde vs TS interface）
- frontend `service/` ↔ backend `domain/` 内嵌 stores —— **职责分叉**：frontend 镜像状态，backend 协议 + 状态机 + 持久化
- frontend `infra/tauri`（IPC adapter）↔ backend `infra/tauri`（AppBackend + binary_frame）

### 1.1 为什么 backend 没有 `integration/` 层（架构原则）

xsterm 架构原则（2026-09 确立）：**rust backend 只做核心数据处理 + 简单业务**；**复杂业务（MCP server、AI 编排、tool 注册表、外部协议驱动的状态机）放 frontend TS 层**。

**理由**：
1. TS 迭代速度 > Rust —— MVP 设计阶段频繁变更时,TS 编译/重启代价远低
2. frontend 已经持有 session/workspace/tmux/settings 状态 —— MCP server 自然延伸这些状态,放 TS 减少跨边界
3. backend 角色是**原始能力面**（PTY/SSH/tmux 进程控制 + 二进制 I/O 通道）,由 frontend 编排成业务

**判据**：问"这事是否需要 serde 状态机 + trait mock **且**不涉及核心数据流?" —— 答是则 push 到 TS。

**例外**：如果复杂业务需要 OS 级资源（stdio/TCP listener、子进程 spawn）且必须在 main process —— 用 `infra/` 子模块承担 OS adapter 边界，业务本身仍放 TS。MCP 即此类：stdio transport / TCP listener 在 `infra/tauri/mcp_transport.rs` 提供 adapter，9 个 tool 实现 + attach 状态机 + 白名单等业务逻辑在 frontend `app/mcp/`。

## 2. commands/ 子模块组织

`src-tauri/src/commands/<module>/` 3 module 拆分（已存在；module 列表见 [`commands/README.md`](commands/README.md)）。

**目录命名**：

- 本 README 的「commands/」是**语义名**；落地目录沿用 Rust 习惯 `commands/`，避免全量重写 import
- 重命名 `commands/` → 新顶层目录（`commands/ domain/ infra/`）是后续 PR 的事，本文档先描述目标结构
- 模块内部文件名：文档写 `commands/session/api.rs`，实际落地仍为 `commands/session.rs`（顶层），子目录 `commands/session/` 用作 sub-module 划分

## 3. 依赖方向

```
commands ──► domain ──► infra
   │           │             │
   │           │             ▼
   │           │        外部资源（OS / 网络 / tauri runtime）
   │           ▼
   │        纯数据 + 算法 + 状态机
   │
   ▼
Tauri IPC（边界）
```

**关键规则**：

- **commands → domain**：正常依赖——commands 编排 domain 业务逻辑
- **commands → infra**：**禁止**（commands 不直接调 infra trait，必须经过 domain）
- **domain → infra**：正常依赖——domain 持有 `Box<dyn Trait>` 引用，infra 提供 trait impl
- **domain → commands**：**禁止**（domain 不知道 Tauri IPC 存在）
- **infra → 任何**：**禁止**（infra 是最底层物理适配，只依赖外部 crate）
- **commands 跨 module**：通过 `commands/<other_module>/api.rs` 调用

## 4. 子层详述

### 4.1 `commands/` — Tauri IPC 编排

3 module 按产品功能切分（**workspace 状态完全 frontend 持有**，backend 无对应 module）。当前 IPC 总数与各 module 分布：

| module | 产品功能 | IPC 数 |
|---|---|---|
| `commands/session` | session lifecycle + **MCP attach（P1-3）** | **13 个**（10 + 3 MCP attach：set_mcp_attach / clear_mcp_attach / list_mcp_attached）|
| `commands/terminal` | tmux -CC IPC + attached_tmux 持久化 + **session_log 上移到 commands/session.log.rs（P1-5）** | **15 个**（含独立 `commands/tmux/auto_attach.rs`——P1-1）|
| `commands/shell` | 启动钩子（`.setup()` 内编排）+ log runtime IPC + user config IPC（v5.1）| **8 个**（log_message + get/set_log_config + get_log_dir + read/write_config + watch_config_start/stop）|
| **commands 合计** | — | **36 个** |

**关键变更**：

- **v5**：attached_tmux 持久化从原 `domain/persistence` 上移到 `commands/terminal`；log runtime 从 `commands/settings` 合并到 `commands/shell`
- **v5.1**：新增 user config IPC（`read_config` / `write_config` / `watch_config_start` / `watch_config_stop`）→ `commands/shell/commands/config/`
- **P1-1**：`auto_attach_tmux_servers` 独立成 `commands/terminal/commands/tmux/auto_attach.rs`
- **P1-3**：新增 3 个 MCP attach IPC → `commands/session/commands/attach.rs`
- **P1-5**：`start_session_logging_session` 上移到 `commands/session/commands/log.rs`（不再跨到 commands/shell）

详见 [`commands/README.md`](commands/README.md)。

### 4.2 `domain/` — 业务核心

按产品功能切分（合并原 service + model），每个 domain 内部自由组织 4 类文件：

| 文件类型 | 用途 |
|--|--|
| `<domain>/types.rs` | 纯数据 + serde derive（API 序列化 + IPC 序列化）|
| `<domain>/rules.rs` | 纯算法（不可变 mutation，纯函数）|
| `<domain>/state.rs` 或 `<domain>/<state_machine>.rs` | 状态机（持有 Arc<Mutex/DashMap>，提供 public method）|
| `<domain>/persistence.rs` | 持久化 IO（typed wrapper over infra）|

| domain | 数据 + 状态机 + 算法 + 持久化 |
|--|--|
| `domain/session` | SessionManager 中央状态机 + 3 种 backend 实现（local/ssh/tmux_pane）+ session types + settings 字段（CapabilityFlags/SizingMode/DisplayConfig/EnvConfig/SshAuthMethod/SessionLoggingConfig/SplitDirection）+ rules + helpers + constants + **MCP attach 注册表（P1-3：`mcp_attachments: DashMap<u32, String>`）** |
| `domain/terminal` | TmuxController（**P1-2：单一 `controller/mod.rs` 文件，不再拆独立 state.rs**）+ tmux 协议层 + tmux types + **attached_tmux 持久化**（v6 合并自原 domain/persistence） |
| （已删除——v6 砍） | attached_tmux 归 `domain/terminal`、log_config 归 `commands/shell`、**session_log 归 `commands/session/log.rs`（P1-5）** |

详见 [`domain/README.md`](domain/README.md)。

### 4.3 `infra/` — 物理适配

按外部资源切分（与 frontend `infra/` 镜像）：

| 子模块 | 外部资源 |
|--|--|
| `infra/config_watcher` | 用户配置文件（TOML + notify watch + schema；PRD §2 M9；v5.1 新增） |
| `infra/pty` | OS PTY 子进程（portable-pty） |
| `infra/ssh` | SSH 协议（russh）|
| `infra/tmux` | tmux 控制模式（外部子进程）|
| `infra/tauri` | Tauri runtime（AppBackend + binary_frame）|

详见 [`infra/README.md`](infra/README.md)。

### 4.4 P0-5 已采纳: config.toml + watch + schema 方案

PRD §2 M9 完整方案已落地为 backend `infra/config_watcher/` 子模块（5 个文件 + RESPONSIBILITY/INTERFACE/DOWNSTREAM 3 份 doc）：

- **config.toml** —— 用户配置文件（TOML 格式），路径 `%APPDATA%\xsterm\config.toml`
- **watch notify** —— `notify` crate 后台 task 监听 config.toml 改动 → debounce 200ms → 重新 read + schema check → emit `config-reloaded` 事件给 frontend
- **schema.json** —— 启动期从 `AppConfig` struct（`schemars` derive）自动生成，写到 `%APPDATA%\xsterm\xsterm-schema.json`，供 VS Code 关联智能提示

frontend 不再直存 `settings.json`（之前 v4 设计）——所有 settings 由 backend config.toml 持有，frontend UI 改 settings → 调 `invoke('write_config', { partial })` → backend merge + validate + atomic write + emit reload → frontend 监听 reload → 本地 store 同步。

详见 [`infra/config_watcher/RESPONSIBILITY.md`](infra/config_watcher/RESPONSIBILITY.md)。

## 5. 旧 4 层 → 新 3 层演进

| 旧 4 层 | 新 3 层 | 简化理由 |
|--|--|--|
| `app/` | `commands/` | app/session/api.rs 是空壳纯转发（`create_local(state, backend, config)` ≈ `SessionManager::create_local(config, backend)`）；删除空壳 |
| `service/` + `model/` | `domain/` | service/session 既做"中央状态机"又做"3 种 backend 实现"，model/session 既做 types 又做 rules；service 跟 model 边界模糊，合并 |
| `infra/` | `infra/` | 不变——物理适配层始终正确 |

**文档数变化**：backend 62 份 → ~43 份（**-31%**）。

**代码影响**（仅设计文档，代码后续 PR 跟进）：

- `services/session/manager.rs`（3000+ 行）拆到 `domain/session/` 下按文件分（manager / registry / id / backends/local / backends/ssh / backends/tmux_pane / log / types / rules / errors）
- `services/tmux/controller/` 拆到 `domain/terminal/` 下按文件分（controller / spawn / commands / io_tasks / registry / sync / id_map / subscriber / types / errors）
- `services/persistence/{sessions,groups}.rs` 已在前轮砍掉
- v4 → v5 过渡期曾在 `commands/<module>/api.rs` 抽 IPC handler；v5 后该层已合并入 `commands/<module>.rs` 顶层文件（子目录拆分子 IPC handler 是目标态）

## 6. 现状 → 目标映射

| 设计目录 | 现状对应（rust） |
|---|---|
| `commands/` | `src-tauri/src/commands/`（目标态：3 module 平铺的拆分版本） |
| `domain/` | `src-tauri/src/services/` + `src-tauri/src/models/`（v6 合并目标；当前两目录仍按旧 4 层拆分，PR 跟进） |
| `infra/` | `src-tauri/src/infrastructure/`（不变） |

**目录名沿用 Rust 习惯**——`commands/` / `domain/` / `infrastructure/` 是 Rust 项目常见命名（注：service+model 已合并为 domain）。`commands/<module>/` 子目录按产品功能切。

## 7. 关键设计决策

### 7.1 为什么 backend 砍 ui 层

frontend 多一个 ui 层是因为有视图（React 组件），backend 没视图——自然不需要。frontend 5 层（app/ui/model/service/infra）↔ backend 3 层（commands/domain/infra）是**天然不对称**。

### 7.2 为什么 service 跟 model 合并为 domain

- service/session 同时做"中央状态机 + 3 backend 实现"——`service/session/backends/local.rs` + `service/session/backends/ssh.rs` 跟 `infra/pty/` + `infra/ssh/` 是**两层 backend 实现**（重叠代码）
- `model/<domain>/rules.rs` 跟 `service/<domain>/<state>.rs` 是两类代码（纯函数 vs 状态机），但**合并后按文件分（types/rules/state/persistence.rs）反而更清晰**
- service 跟 model 强制分层带来的实际收益小（边界本来就模糊），但认知开销大（多一个目录层级）

### 7.3 为什么 commands 直接调 domain（不经过 service 层）

- 旧 4 层架构（app/service/model/infra）曾在 `app/<module>/api.rs` 做空壳纯转发（命令签名 → service 方法），v5 已合并为 3 层（commands/domain/infra）；空壳层删除
- v6 架构下：`#[tauri::command]` wrapper 直接放在 `commands/<module>/<command>.rs`，内部直接 `domain/session::SessionManager::method(...)`
- 保留 `api.rs` 的**唯一价值**是统一封装 `State<Arc<...>>` 注入——但这每个 command 自己写 1 行就行，不需要单独一层

### 7.4 为什么 tmux 归 domain/terminal 而不是独立 domain

- tmux 是**terminal 产品功能的子集**，不是独立业务
- 前端 terminal module 包含 xterm + tmux + outputBuffer，backend terminal module 同理包含 TmuxController + protocol + 3 backend 实现
- 按产品功能切（不是按技术类型）——tmux 是 terminal 的子目录

### 7.5 类型字段归属

- `SessionType` / `SplitDirection` / `CapabilityFlags` / `build_remote_image_path` / `constants` 等 types + constants + helpers 拆到归属 domain（大部分归 session）
- 单独成 domain 是过度切分（types/constants/helper 不构成独立业务）
- v6 已砍 `domain/settings`（合并后由 commands/domain 内的 typed wrapper 承担 runtime config）
- 拆分原则：**按数据归属切**——settings 字段跟哪个 domain 的状态机相关就归哪个 domain

### 7.6 字段可见性约束（bug 0009 类防御——P0-2）

- `pub struct SessionManager` 字段全部 `pub(crate)`（不暴露 module 外部读写）
- `TmuxController` 字段全部 private（不暴露 module 外部读写）
- 跨 module / 跨 domain 访问**只**通过 `impl SessionManager` / `impl TmuxController` 公开方法（plan 整改 P0-2）
- 新加字段必须先在 impl 加公开方法，子文档引用本节 §10.1 / §10.2，禁止字段直读

详见 §10.1 + §10.2。

## 8. 跨 module 协调

3 commands module 之间的协调**只通过 `commands/<other>/api.rs`**（domain 模块不感知 commands 边界）：

| 协调类型 | 谁编排 | 通过哪个 api.rs |
|---|---|---|
| terminal 创建 tmux 后持久化 attached_tmux | `commands/terminal` | `commands/terminal/api.rs::saveAttachedTmuxServers` |
| 启动 → 加载 log_config + binary frame | `commands/shell` | `commands/shell/api.rs::initialize` |
| session create → 启动 session_log | `commands/session` | `commands/session/log.rs::start_session_logging_session`（**P1-5 上移**） |
| MCP AI attach 登记 / 释放 / 列表 | `commands/session` | `commands/session/attach.rs::set_mcp_attach / clear_mcp_attach / list_mcp_attached`（**P1-3**） |
| settings 变更 → 应用到 terminal | （已删除）| `commands/terminal/api.rs::applyTerminalPreferences` |

## 9. 占位与未来工作

backend 设计文档里**保留**所有「（未来）」占位——它们标记 MVP 暂未实现但设计已规划的部分：

- 各类「（未来）」标注的字段、命令、helper
- `domain/terminal/attached_tmux.rs`：MVP 已有 attached_tmux.json 持久化（save/load on startup + shutdown）
- schema migration 框架（MVP 单版本无 migration）

**保留占位的理由**：

- 设计文档是"目标态"——MVP 不实现不等于设计不规划
- 后续 PR 可以按占位逐项落地
- 删除占位会丢失设计意图

## 10. Bug 防御（单一事实源）

下面汇总 backend 历史 bug 的防御措施——子文档**不**重复抄写，只引用本节。

### 10.1 bug 0009：TmuxController 字段直读导致 stale data

**根因**（见 `doc/dev/changelog/bugs.md` 0009）：`SessionManager::create_tmux` 直读 `TmuxController.window_bindings` HashMap，导致 stale data。

**防御措施**（必须遵守）：

- ❌ `commands/session/`、`commands/terminal/` → `domain::terminal::*` 内部字段（pane_bindings / window_bindings / initial_state / dispatch_task）
- ✅ 所有跨 domain 访问走 `domain::session::SessionManager` public method 代理
- ✅ session manager 持 `Arc<TmuxController>` 引用但不暴露字段
- ✅ `TmuxController` 字段全部 private（**P0-2**）；外部访问走 `pane_binding_for` / `window_binding_for` / `initial_state` 等公开方法（返回引用，禁止 caller 持有引用期间 mutation）

**应用位置**：

- `commands/terminal/RESPONSIBILITY.md` §5
- `commands/terminal/DOWNSTREAM.md` §4 + §5
- `domain/session/DOWNSTREAM.md` §2
- `domain/terminal/INTERFACE.md` §7 + §8
- `frontend/app/mcp/DOWNSTREAM.md` §4（MCP tool 不直读 TmuxController 字段）

**变更流程**：新加 `TmuxController` 字段必须先在 `TmuxController` impl 加公开方法，子文档引用本节，禁止字段直读。

### 10.2 bug 0009 类：SessionManager 字段直读

**防御措施**：

- ❌ commands / integration / 子 domain → `SessionManager` 字段直读（DashMap / AtomicU32 / tmux_controllers / **mcp_attachments——P1-3**）
- ✅ 只通过 `SessionManager::method()` 公开方法访问
- ✅ 所有 `pub struct SessionManager` 字段必须 `pub(crate)`（**P0-2**），外部访问走 `get_session` / `controller_for_pane` / `ssh_backend` / `pty_system` / `tmux_controller` / `allocate_session_id` 等公开方法

**应用位置**：所有调 `SessionManager` 的 module（commands/session / commands/terminal / commands/shell / `frontend/app/mcp/`）；子文档 §8 末尾统一加 `**严格遵守 backend/README §10.1 + §10.2**` 反向引用。

### 10.3 MCP attach 期间 user keystroke 防御（P1-3 风险）

**根因**：MCP AI 工具独占 session 时（`attached_by_mcp: true`），user 在 frontend xterm 输入的 keystroke 会跟 MCP 工具写入冲突（race condition + state divergence）。

**防御措施**：

- `commands/session/commands/write.rs::write_session` 前置检查 `if state.is_attached_by_mcp(session_id) { return Err(SessionError::McpAttachBlocked(client_id)) }`
- frontend UI 检测 `McpAttachBlocked` 时弹 banner：「session 被 AI agent 独占，请先 detach」+ 提供 release 口令 / detach 按钮入口

**应用位置**：`domain/session/RESPONSIBILITY.md` §8.6、`commands/session/RESPONSIBILITY.md` §5。

### 10.4 SSH host-key 校验禁用（已知安全债）

**事实**：`src-tauri/src/infrastructure/ssh/` 当前不校验 host key。

**防御措施**（由 AGENTS.md §"Important Gotchas" 强约束）：

- ❌ 在 `infra/ssh/` 之外的位置重新打开 host-key 校验
- ❌ commands / domain 层 bypass 该限制
- ❌ 关闭 `SshError::HostKeyUnchecked` 警告

**未来启用**：必须经过完整安全评审 + 用户配对 UX + known_hosts 持久化策略。

**应用位置**：`infra/ssh/RESPONSIBILITY.md` §10 + §11、`infra/ssh/INTERFACE.md` §5.3。

### 10.5 新 bug 模板

未来新 bug 记录流程：
1. 创建 issue → 修复 → PR
2. 在 `doc/dev/changelog/bugs.md` 加条目
3. 在本节加对应防御段落
4. 子文档只引用本节，不重复抄

## 11. 文档地图

- 顶层（本文）：3 层架构总览 + frontend 镜像关系
- 各层 README：`commands/README.md` / `domain/README.md` / `infra/README.md`
- 每层子文档：每个 module/domain 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份子文档的 "Frontend 对应" 链接指向 frontend 同名 README
- bug 防御：本文 §10（单一事实源）
- **MCP server**（PRD §2 M6 + M7）：归 frontend `app/mcp/` —— 详见 `doc/dev/design/frontend/app/mcp/RESPONSIBILITY.md` + 本文 §1.1 架构原则

**TM 验收入口**：先读本文档（3 层架构总览 + §10 bug 防御 + §1.1 架构原则）→ 读 `commands/README.md`（IPC 编排 3 module + IPC 计数表）→ 读 `domain/README.md`（状态机 + 类型 2 domain）→ 读 `infra/README.md`（**5 子模块**物理适配）→ 跳到 frontend `app/mcp/RESPONSIBILITY.md` 看 MCP server 9 tools + AI 接管。