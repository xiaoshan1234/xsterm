# Backend · 顶层架构

> **位置**：`src-tauri/src/` 下的 4 层架构（app / service / model / infra）
> **关注点**：把 frontend IPC 调用映射到 Rust 后端的 4 个正交层

## 1. 4 层架构

```
src-tauri/src/
├── app/         Tauri IPC 命令编排（5 module 按产品功能切分，与 frontend app/ 镜像）
├── service/     业务逻辑 + 跨 module 状态（5 domain 按数据归属切）
├── model/       纯数据 + 算法（5 + cross-cutting 业务 domain）
└── infra/       物理适配（4 子模块按外部资源切：pty / ssh / tmux / tauri）
```

| 层 | 职责 | 子结构数 | 子结构 |
|---|---|---|---|
| `app/` | Tauri IPC 编排 | 5 module | shell / workspace / terminal / session / settings |
| `service/` | 业务逻辑 + 进程级状态 | 5 domain | session / workspace / tmux / settings / persistence |
| `model/` | 纯数据 + 算法 + 不变量 | 5 + 1 | session / workspace / tmux / settings / cross-cutting |
| `infra/` | 物理适配（PTY / SSH / tmux / Tauri） | 4 子模块 | pty / ssh / tmux / tauri |

**与 frontend 的关系**：
- frontend `app/` 5 module ↔ backend `app/` 5 module —— **1:1 镜像**，跨 IPC 调用
- frontend `model/` ↔ backend `model/` —— **同名镜像**（不同语言：Rust serde vs TS interface）
- frontend `service/` ↔ backend `service/` —— **同名镜像但职责相反**（frontend 镜像状态、backend 协议 + 状态机）
- frontend `infra/tauri`（IPC adapter）↔ backend `infra/tauri`（AppBackend + binary_frame）

## 2. v3 → v4：从零设计

backend 设计从零出发。v3 现状（`src-tauri/src/commands/` 单文件平铺）已映射到 v4 设计（`src-tauri/src/app/modules/<name>/` 5 module）。

**目录命名**：
- 本 README 的「app/」是**语义名**；落地目录沿用 Rust 习惯 `commands/`，避免全量重写 import
- 重命名 `commands/` → `app/` 是后续 PR 的事，本文档先描述目标结构
- 模块内部文件名同样：v4 文档写 `app/session/api.rs`，实际落地仍为 `commands/session.rs`（顶层），子目录 `commands/session/` 用作 sub-module 划分

## 3. 各层职责

### 3.1 `app/` — Tauri IPC 编排

5 module 按产品功能切分（跟 frontend `app/` 5 module 一一对应）：

| module | 产品功能 |
|---|---|
| `app/shell` | 启动序列 + 关闭序列的 IPC 编排 |
| `app/workspace` | 主视图 IPC 编排（预留位） |
| `app/terminal` | tmux -CC + terminal preferences IPC 编排 |
| `app/session` | session 全生命周期 IPC 编排 |
| `app/settings` | 设置持久化 + log 路径 IPC 编排 |

详见 [`app/README.md`](app/README.md)。

### 3.2 `service/` — 业务逻辑

按数据 domain 切分（与 frontend `service/` 的 5 domain 镜像）：

| domain | 职责 |
|---|---|
| `service/session` | session 元数据 + 3 种 backend 实现（local / ssh / tmux_pane） |
| `service/workspace` | 预留位（MVP 无 backend workspace 状态） |
| `service/tmux` | tmux -CC control mode 状态机 + 协议层 |
| `service/settings` | log config + reload handle 管理 |
| `service/persistence` | tauri-plugin-store 业务 wrapper |

详见 [`service/README.md`](service/README.md)。

### 3.3 `model/` — 纯数据 + 算法

按 5 + 1 domain 切分（与 frontend `model/` 1:1 镜像）：

| domain | 数据 |
|---|---|
| `model/session` | session 全生命周期纯类型 + 算法 |
| `model/workspace` | Workspace / Window / Group / PaneNode（含 paneTree 算法） |
| `model/tmux` | tmux 协议层的纯数据投影 |
| `model/settings` | log config + saved config 类型 |
| `model/cross-cutting` | 跨域纯类型 + helpers + 常量 |

详见 [`model/README.md`](model/README.md)。

### 3.4 `infra/` — 物理适配

按外部资源切分（与 frontend `infra/` 镜像）：

| 子模块 | 外部资源 |
|---|---|
| `infra/pty` | OS PTY 子进程（portable-pty） |
| `infra/ssh` | SSH 协议（russh） |
| `infra/tmux` | tmux 控制模式（外部子进程） |
| `infra/tauri` | Tauri runtime（AppBackend + binary_frame） |

详见 [`infra/README.md`](infra/README.md)。

## 4. 依赖方向

```
                     ┌─────────────────────────┐
                     │  app/                    │
                     │  ──► service/*           │
                     │  ──► model/*             │
                     │  ──► infra/* (经 service) │
                     └─────────────────────────┘
                            │  ▲
   ┌────────────────────────┘  │
   │                           │
   ▼                           │
service/* ──► infra/* ──► model/*
```

**关键规则**：
- **app → service**：正常依赖
- **app → model**：自由（参数 / 返回类型）
- **app → infra**：**禁止**（必须经过 service）
- **app 模块之间**：只通过 `modules/<other>/api.rs` 互相调用

## 5. 跟现状的对应

| v4 设计目录 | 现状对应 |
|---|---|
| `app/` | `src-tauri/src/commands/`（5 module 拆分中） |
| `service/` | `src-tauri/src/services/`（5 domain 重构中） |
| `model/` | `src-tauri/src/models/`（5 + 1 domain 重构中） |
| `infra/` | `src-tauri/src/infrastructure/`（4 子模块重构中） |

**目录名沿用 Rust 习惯**——`services/` / `infrastructure/` / `models/` / `commands/`（不动）。模块内部按 5 module / 5 domain / 5 + 1 domain / 4 子模块结构重组。

## 6. 关键设计决策

### 6.1 为什么按"产品功能"切分 `app/`，按"数据 domain"切分 `service/` 和 `model/`

- **`app/` 按产品功能切**：5 module ↔ frontend app/ 5 module —— 改一个产品功能 = 改 1 个 app module + 1 个 frontend app module
- **`service/` 和 `model/` 按数据 domain 切**：跨 module 共享状态按数据归属切，不按产品功能切（避免被产品边界拆散）
- **`infra/` 按外部资源切**：4 子模块按外部系统切（OS PTY / SSH / tmux / Tauri）

### 6.2 为什么 backend `service/` 比 frontend `service/` 多一层（业务逻辑）

frontend `service/` 只持有**运行时状态副本**（zustand）+ IPC bridge。

backend `service/` **除了状态，还承载业务规则**：
- `service/session::SessionManager` 是中央状态机（3000+ 行 → 拆分后）
- `service/tmux::TmuxController` 是协议层 + 状态机
- `service/persistence::save_*/load_*` 是 IO 业务规则

frontend 业务规则在 `app/`，backend 业务规则在 `service/`——两边对"业务逻辑"的归属不同（这是 frontend ↔ backend 镜像的固有差异）。

### 6.3 为什么 `infra/session_backend.rs` 不在 `infra/`

`SessionBackend` trait 是 3 种 backend（PTY / SSH / tmux pane）的**抽象接口**——是 service 关注，不是外部资源。`SessionBackend` 已迁出 `infra/` → `services/session/backends/traits.rs`。

infra 是"对外部世界的接口"——`PtySystem::openpty()`、`SshBackend::connect()`、`TmuxBackend::spawn()`、`AppBackend::emit()`。service trait 是"对 service 的接口"——`SessionBackend` 让 `SessionManager` 统一调度。

## 7. 占位与未来工作

backend 设计文档里**保留**所有「（未来）」占位——它们标记 MVP 暂未实现但设计已规划的部分：

- `services/workspace/`：MVP backend 无 workspace 状态，pane tree 在 frontend store
- `services/persistence/migrations/`：schema 升级时的 migration 框架（MVP 单版本无 migration）
- 各类「（未来）」标注的字段、命令、helper

**保留占位的理由**：
- 设计文档是"目标态"——MVP 不实现不等于设计不规划
- 后续 PR 可以按占位逐项落地
- 删除占位会丢失设计意图，未来需要重新设计

## 8. 文档地图

- 顶层（本文）：backend 4 层架构总览 + 跟 frontend 的镜像关系
- 各层 README：`app/README.md` / `service/README.md` / `model/README.md` / `infra/README.md`
- 每层子文档：每个 module/domain 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份子文档的 "Frontend 对应" 链接指向 frontend 同名 README

**TM 验收入口**：先读本文档（4 层架构总览）→ 读 `app/README.md`（5 module 按产品功能）→ 读 `service/README.md`（5 domain 按数据归属）。