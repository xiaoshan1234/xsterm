# Backend · 顶层架构

> **位置**：`src-tauri/src/` 下的 3 层架构（commands / domain / infra）
> **关注点**：把 frontend IPC 调用映射到 Rust 后端的 3 个正交层
> **设计原则**：backend 不需要 ui 层（frontend 多 ui 是因为有视图，backend 没视图）；service 跟 model 边界模糊，合并为 domain

## 1. 3 层架构

```
src-tauri/src/                                            （语义名）
├── commands/    Tauri IPC 编排（4 module 按产品功能切）+ 跨 module 协调
│   ├── session/      原 app/session/* —— session lifecycle IPC
│   ├── workspace/    原 app/workspace/* —— 主视图 IPC（预留）
│   ├── terminal/     原 app/terminal/* —— tmux IPC
│   ├── settings/     原 app/settings/* —— persistence/logging IPC（含 attached_tmux）
│   └── shell/        原 app/shell/* —— 启动钩子（setup hook 内编排）
├── domain/      业务核心：状态机 + 持久化 + 纯数据 + 算法
│   ├── session/      合并：原 service/session/*（状态机 + 3 backend 实现）+ 原 model/session/*（types + rules）
│   ├── workspace/    合并：原 service/workspace/* + 原 model/workspace/*（paneTree 算法 + types）
│   ├── terminal/     合并：原 service/tmux/* + 原 model/tmux/*（TmuxController + protocol + types）
│   ├── settings/     合并：原 service/settings/* + 原 model/settings/* + 原 model/cross-cutting/*（types + constants + helpers）
│   └── persistence/  原 service/persistence/*（attached_tmux + log_config 直存）
└── infra/       物理适配（4 子模块按外部资源切）
    ├── pty/          OS PTY 子进程（portable-pty）
    ├── ssh/         SSH 协议（russh）
    ├── tmux/        tmux 控制模式（外部子进程）
    └── tauri/       Tauri runtime（AppBackend + binary_frame）
```

| 层 | 职责 | 子结构数 | 子结构 |
|—|—|—|—|
| `commands/` | Tauri IPC 编排 | 4 module | session / workspace / terminal / shell（砍掉 settings——attached_tmux→terminal，log→shell）|
| `domain/` | 业务核心（状态机 + 类型 + 算法 + 持久化）| 4 domain | session / workspace / terminal / persistence（砍掉 settings——类型字段拆到归属 domain）|
| `infra/` | 物理适配（PTY / SSH / tmux / Tauri）| 4 子模块 | pty / ssh / tmux / tauri |

**与 frontend 的关系**：

- frontend `app/` 5 module ↔ backend `commands/` **4 module**（app/settings 不对应 backend 单一 module——attached_tmux 在 terminal，log 在 shell）
- frontend `model/` ↔ backend `domain/` 内嵌 types —— **同名镜像**（不同语言：Rust serde vs TS interface）
- frontend `service/` ↔ backend `domain/` 内嵌 stores —— **职责分叉**：frontend 镜像状态，backend 协议 + 状态机 + 持久化
- frontend `infra/tauri`（IPC adapter）↔ backend `infra/tauri`（AppBackend + binary_frame）

## 2. 从零设计

`src-tauri/src/commands/<module>/` 4 module 拆分（已存在；module 列表见 `commands/README.md`）。

**目录命名**：

- 本 README 的「commands/」是**语义名**；落地目录沿用 Rust 习惯 `commands/`，避免全量重写 import
- 重命名 `commands/` → 新顶层目录（`commands/ domain/ infra/`）是后续 PR 的事，本文档先描述目标结构
- 模块内部文件名：文档写 `commands/session/api.rs`，实际落地仍为 `commands/session.rs`（顶层），子目录 `commands/session/` 用作 sub-module 划分

## 3. 3 层依赖方向

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

## 4. 各层职责

### 4.1 `commands/` — Tauri IPC 编排

4 module 按产品功能切分（砍掉 settings：attached_tmux→terminal，log→shell）：

| module | 产品功能 |
|—|—|
| `commands/session` | session lifecycle IPC（create / write / resize / close / list）|
| `commands/workspace` | 主视图 IPC（预留）|
| `commands/terminal` | tmux -CC IPC + attached_tmux 持久化|
| `commands/shell` | 启动钩子（`.setup()` 内编排）+ log runtime IPC（合并 log_message + get/set_log_config + get_log_dir）|

详见 [`commands/README.md`](commands/README.md)。

### 4.2 `domain/` — 业务核心

按产品功能切分（合并原 service + model），每个 domain 内部自由组织 4 类文件：

| 文件类型 | 用途 |
|—|—|
| `<domain>/types.rs` | 纯数据 + serde derive（API 序列化 + IPC 序列化）|
| `<domain>/rules.rs` | 纯算法（不可变 mutation，纯函数）|
| `<domain>/state.rs` 或 `<domain>/<state_machine>.rs` | 状态机（持有 Arc<Mutex/DashMap>，提供 public method）|
| `<domain>/persistence.rs` | 持久化 IO（typed wrapper over infra）|

| domain | 数据 + 状态机 + 算法 + 持久化 |
|—|—|
| `domain/session` | SessionManager 中央状态机 + 3 种 backend 实现（local/ssh/tmux_pane）+ session types + settings 字段（CapabilityFlags/SizingMode/DisplayConfig/EnvConfig/SshAuthMethod/SessionLoggingConfig）+ rules + helpers + constants |
| `domain/workspace` | 预留位（MVP backend 无 workspace 状态）+ paneTree 算法 + Workspace/Window/Group/PaneNode/SplitDirection types |
| `domain/terminal` | TmuxController 状态机 + tmux 协议层 + tmux types |
| `domain/persistence` | attached_tmux + log_config 直存 backend-only 持久化（含 LogConfig runtime + ReloadHandle 管理，合并自原 domain/settings）|

详见 [`domain/README.md`](domain/README.md)。

### 4.3 `infra/` — 物理适配

按外部资源切分（与 frontend `infra/` 镜像）：

| 子模块 | 外部资源 |
|—|—|
| `infra/pty` | OS PTY 子进程（portable-pty）|
| `infra/ssh` | SSH 协议（russh）|
| `infra/tmux` | tmux 控制模式（外部子进程）|
| `infra/tauri` | Tauri runtime（AppBackend + binary_frame）|

详见 [`infra/README.md`](infra/README.md)。

## 5. 简化原因（单层 → 3 层）

| 旧 4 层 | 新 3 层 | 简化理由 |
|—|—|—|
| `app/` | `commands/` | app/session/api.rs 是空壳纯转发（`create_local(state, backend, config)` ≈ `SessionManager::create_local(config, backend)`）；删除空壳 |
| `service/` + `model/` | `domain/` | service/session 既做"中央状态机"又做"3 种 backend 实现"，model/session 既做 types 又做 rules；service 跟 model 边界模糊，合并 |
| `infra/` | `infra/` | 不变——物理适配层始终正确 |

**文档数变化**：backend 62 份 → ~43 份（**-31%**）。

**代码影响**（仅设计文档，代码后续 PR 跟进）：

- `services/session/manager.rs`（3000+ 行）拆到 `domain/session/` 下按文件分（manager / registry / id / backends/local / backends/ssh / backends/tmux_pane / log / types / rules / errors）
- `services/tmux/controller/` 拆到 `domain/terminal/` 下按文件分（controller / spawn / commands / io_tasks / registry / sync / id_map / subscriber / types / errors）
- `app/<module>/api.rs` 删除——`#[tauri::command]` wrapper 直接放在 `commands/<module>/<command>.rs`，内部调 domain 方法
- `services/persistence/{sessions,groups}.rs` 已在前轮砍掉

## 6. 跟现状的对应

| 设计目录 | 现状对应（rust）|
|—|—|
| `commands/` | `src-tauri/src/commands/`（已存在 4 module 平铺的拆分版本）|
| `domain/` | `src-tauri/src/services/` + `src-tauri/src/models/` 合并 |
| `infra/` | `src-tauri/src/infrastructure/`（不变）|

**目录名沿用 Rust 习惯**——`commands/` / `domain/` / `infrastructure/` 是 Rust 项目常见命名（注：service+model 已合并为 domain）。`commands/<module>/` 子目录按产品功能切。

## 7. 关键设计决策

### 7.1 为什么 backend 砍 ui 层

frontend 多一个 ui 层是因为有视图（React 组件），backend 没视图——自然不需要。frontend 5 层（app/ui/model/service/infra）↔ backend 3 层（commands/domain/infra）是**天然不对称**。

### 7.2 为什么 service 跟 model 合并为 domain

- service/session 同时做"中央状态机 + 3 backend 实现"——`service/session/backends/local.rs` + `service/session/backends/ssh.rs` 跟 `infra/pty/` + `infra/ssh/` 是**两层 backend 实现**（重叠代码）
- `model/<domain>/rules.rs` 跟 `service/<domain>/<state>.rs` 是两类代码（纯函数 vs 状态机），但**合并后按文件分（types/rules/state/persistence.rs）反而更清晰**
- service 跟 model 强制分层带来的实际收益小（边界本来就模糊），但认知开销大（多一个目录层级）

### 7.3 为什么 commands 直接调 domain（不经过 service 层）

- app/<module>/api.rs 是空壳纯转发（命令签名 → domain 方法），删除
- `#[tauri::command]` wrapper 直接放在 `commands/<module>/<command>.rs`，内部直接 `domain/session/manager.rs::create_local(...)`
- 保留 api.rs 的**唯一价值**是统一封装 `State<Arc<...>>` 注入——但这每个 command 自己写 1 行就行，不需要单独一层

### 7.4 为什么 tmux 归 domain/terminal 而不是独立 domain

- 原 service/tmux 是"独立 domain"——但 tmux 是**terminal 产品功能的子集**，不是独立业务
- 前端 terminal module 包含 xterm + tmux + outputBuffer，backend terminal module 同理包含 TmuxController + protocol + 3 backend 实现
- 按产品功能切（不是按技术类型）——tmux 是 terminal 的子目录

### 7.5 类型字段归属

- cross-cutting 内容是 types + constants + helpers——是 settings 的"基础设施"（SessionType / SplitDirection / CapabilityFlags / build_remote_image_path / constants）
- 单独成 domain 是过度切分（types/constants/helper 不构成独立业务）
- 合并到 domain/settings；进一步拆到归属 domain（CapabilityFlags 等 → session，SplitDirection → workspace）

## 9. 跨 module 协调

5 commands module 之间的协调**只通过 `commands/<other>/api.rs`**（domain 模块不感知 commands 边界）：

| 协调类型 | 谁编排 | 通过哪个 api.rs |
|—|—|—|
| session 创建 → 装到 workspace | `commands/session` | `commands/workspace/api.rs::openSession` |
| workspace pane split → 创建新 session | `commands/workspace` | `commands/session/api.rs::createLocal/Ssh/Tmux` |
| terminal 创建 tmux 后通知 settings 持久化 attached_tmux | `commands/terminal` | `commands/<module>/api（log → shell，attached_tmux → terminal）.rs::saveAttachedTmuxServers` |
| 启动 → 加载 settings → 加载 workspace | `commands/shell` | `commands/<module>/api（log → shell，attached_tmux → terminal）.rs::loadAll` → `commands/workspace/api.rs::loadLastWorkspace` |
| settings 变更 → 应用到 terminal | （已删除——attached_tmux→terminal，log→shell）| `commands/terminal/api.rs::applyTerminalPreferences` |

**关键**：跨 module 调用**只**通过 `commands/<other>/api.rs`——不绕过 import 内部文件。

## 10. 占位与未来工作

backend 设计文档里**保留**所有「（未来）」占位——它们标记 MVP 暂未实现但设计已规划的部分：

- `domain/workspace/`：MVP backend 无 workspace 状态，pane tree 在 frontend store
- `domain/persistence/migrations/`：schema 升级时的 migration 框架（MVP 单版本无 migration）
- 各类「（未来）」标注的字段、命令、helper

**保留占位的理由**：
- 设计文档是"目标态"——MVP 不实现不等于设计不规划
- 后续 PR 可以按占位逐项落地
- 删除占位会丢失设计意图

## 11. 文档地图

- 顶层（本文）：3 层架构总览 + frontend 镜像关系
- 各层 README：`commands/README.md` / `domain/README.md` / `infra/README.md`
- 每层子文档：每个 module/domain 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份子文档的 "Frontend 对应" 链接指向 frontend 同名 README

**TM 验收入口**：先读本文档（3 层架构总览）→ 读 `commands/README.md`（IPC 编排 4 module）→ 读 `domain/README.md`（状态机 + 类型 4 domain）→ 读 `infra/README.md`（4 子模块物理适配）。