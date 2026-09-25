# Backend · Model 层（v1：5 业务 domain + 1 cross-cutting）

> **位置**：`src-tauri/src/models/`（目录名沿用 Rust 习惯）
> **关注点**：纯数据 + 不变量 + 纯函数算法
> **平级于**：app / service / infra（4 个顶层目录之一）
> **前端对应**：[`../../frontend/model/`](../../frontend/model/README.md)（同样 5 + 1 结构）

## 0. 为什么重写这一层

v0 把 `models/` 当作**平铺的"几个文件"**：`session.rs / group.rs / capabilities.rs`。问题：

- **tmux 相关类型散在 `session.rs` 里**——`TmuxCcConfig / AttachedTmuxServer / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit` 全在 `session.rs`(一行 1670 行的单文件)
- **group 单独占文件**——但 group 跟 workspace 紧耦合(workspace 内的 group),拆开是过度切分
- **capabilities 是能力探测结果**——但 v0 没有 `workspace.rs` / `tmux.rs` / `settings.rs` / `cross-cutting.rs`
- **跨 service 共享的 binding 数据散落**——bug 0009 的根因(`SessionManager::create_tmux` 直读 `TmuxController` 的 `window_bindings`)

v1(本文档)把 `models/` 重构为 **5 业务 domain + 1 cross-cutting**,与 frontend `model/` **1:1 镜像**:

| v0 (3 文件) | v1 (5 + 1) | 依据 |
|---|---|---|
| `models/session.rs`(1670 行,内含 tmux 类型) | `models/session/` + `models/tmux/`(拆分)| tmux 是独立的派生 domain |
| `models/group.rs` | `models/workspace/`(group 并入 workspace)| group 跟 workspace 紧耦合 |
| `models/capabilities.rs` | `models/cross-cutting/`(跨域 capability flags)| capabilities 是横切关注点 |
| —(缺) | `models/settings/` | settings 数据模型(log config + saved config) |
| —(缺) | `models/workspace/` | workspace / window / pane / group 类型 |

## 1. 5 + 1 = 6 个 domain

```
src-tauri/src/models/
├── mod.rs                      re-export 6 个子 domain
├── session/                    ⭐ 核心:Session 全生命周期纯类型 + 算法
│   ├── types.rs                SessionConfig / SessionInfo / SessionType / SessionIdSource
│   ├── accessor.rs             纯查询函数(getSession / getActive)
│   ├── rules.rs                纯变更函数(withStatus / applyDisplayConfig)
│   ├── errors.rs               SessionConfigError / SessionError(thiserror)
│   └── *.test.rs               纯函数单测
│
├── workspace/                  ⭐ 核心:Workspace / Window / Group / PaneNode(含算法)
│   ├── types.rs                Workspace / Window / PaneNode / Group / GroupStore
│   ├── accessor.rs             findPaneNode / getLeafPanes
│   ├── rules.rs                createWindow / createLeafPane / splitPane / closePane
│   └── *.test.rs               paneTree 算法必须 100% 覆盖
│
├── tmux/                       ⭐ 派生:tmux 协议层的纯数据投影
│   ├── types.rs                TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer
│   ├── accessor.rs             pure helper(find pane by id)
│   └── errors.rs               TmuxConfigError
│
├── settings/                   ⭐ 横切:settings 全字段纯类型
│   ├── types.rs                LogConfig / SavedSessionConfigV1 / SizingMode / DisplayConfig / EnvConfig / SavedSessionConfigKind
│   ├── accessor.rs             getDefaultShell / getEffectiveLogLevel
│   ├── rules.rs                mergeDefaults / validateConfig
│   └── errors.rs               SettingsError
│
└── cross-cutting/              ⭐ 横切:跨域纯类型 + 算法 + 常量
    ├── types.rs                CapabilityFlags / SplitDirection / SessionLoggingConfig
    ├── ids.rs                  id 分配器(SessionIdSource 移到此处或保持 session 内部)
    ├── helpers.rs              build_remote_image_path / tmux_pane_info
    └── constants.rs            (未来) 文件大小上限 / 超时默认值
```

## 2. 6 个 domain 索引

每个 domain 有 3 份文档:**职责 / 对外接口 / 对下依赖**

### 2.1 5 个业务 domain

| domain | 职责 | 对外接口 | 对下依赖 | 类型 |
|---|---|---|---|---|
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) | 核心 |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) | 核心 |
| **tmux** | [RESPONSIBILITY](./tmux/RESPONSIBILITY.md) | [INTERFACE](./tmux/INTERFACE.md) | [DOWNSTREAM](./tmux/DOWNSTREAM.md) | 派生 |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) | 横切 |

### 2.2 1 个 cross-cutting

| domain | 职责 | 对外接口 | 对下依赖 |
|---|---|---|---|
| **cross-cutting** | [RESPONSIBILITY](./cross-cutting/RESPONSIBILITY.md) | [INTERFACE](./cross-cutting/INTERFACE.md) | [DOWNSTREAM](./cross-cutting/DOWNSTREAM.md) |

## 3. 6 个 domain ↔ 6 个 frontend model domain 镜像表

| backend domain | frontend domain | 对应关系 |
|---|---|---|
| `models/session/` | `model/session/` | 都是 session 全生命周期纯类型 |
| `models/workspace/` | `model/workspace/`(含 pane / window / group)| 都是主视图纯类型 + paneTree 算法 |
| `models/tmux/` | `model/tmux/` | 都是 tmux 协议层纯数据投影 |
| `models/settings/` | `model/settings/`(含 terminal)| 都是 settings 字段纯类型(backend 只管 log config + saved config;terminal palette 是 frontend-only) |
| `models/cross-cutting/` | `model/cross-cutting/` | 都是跨域纯类型 + 算法 + 常量 |
| (无对应 backend) | (frontend) `model/eventType/`(已删除 v4)| backend 事件契约在 service 层,不放 model |

**关键**:frontend 是"类型 + repository 接口 + events";backend 是"类型 + serde derive + thiserror"。两边**名字一致**,但实现形式不同——这是 Rust vs TS 的语言差异。

## 4. 关键设计决策

### 4.1 为什么 5 + 1,不是 3 或 8

参考 frontend v4 的"5 + 1"决策(已写在 `frontend/model/README.md` §2):

- **不是 3**——3 会让 settings / workspace 等核心 domain 变臃肿
- **不是 8**——8 会重复切分紧密耦合的 concept(比如把 group / pane / window 各自独立)
- **5 + 1**——5 个业务 domain(每个有清晰归属)+ 1 个 cross-cutting(命名陷阱见 §4.3)

### 4.2 backend 没有"repository.ts"接口

frontend `repository.ts` 是 zustand store 的 interface——service 层实现该 interface 用于 mock。

backend 不需要这个模式:
- backend 没有 zustand store
- backend `services/session/` 的 `DashMap<u32, Arc<ActiveSession>>` 就是 source of truth,不需要 interface
- 跨 service 共享的"binding 数据"通过**纯类型 + 公共方法**传递(bug 0009 防御)

### 4.3 backend 没有"events.ts"文件

frontend `events.ts` 定义 Tauri event payload 的 TS 类型。

backend 的事件契约:
- 事件名是字符串字面量(如 `"session-output"`、`"tmux-pane-added"`),集中在 `services/tmux/bridge.rs` 或 `services/session/mod.rs` 的 const
- event payload 由 `models/<domain>/types.rs` 的 Serialize derive 类型承担
- 因此 backend 不需要 `events.ts` 单独文件——类型已经在 domain `types.rs` 内

### 4.4 backend model 子结构不是 frontend 的 5 文件模板

frontend `model/<domain>/` 有 5 文件模板:`types / repository / events / accessor / rules`。

backend `models/<domain>/` 的子结构取决于 domain 复杂度:

| domain | 子文件 |
|---|---|
| session | types / accessor / rules / errors |
| workspace | types / accessor / rules |
| tmux | types / accessor / errors |
| settings | types / accessor / rules / errors |
| cross-cutting | types / ids / helpers / constants |

**关键差异**:
- `repository.ts` → 不存在(backend 不需要 interface)
- `events.ts` → 不存在(backend 事件类型在 service 层)
- `errors.rs` → 新增(Rust thiserror derive,前端用 Result 模式)
- `ids.rs` / `helpers.rs` / `constants.rs` → backend 新增,放 cross-cutting(纯函数 + 常量)

### 4.5 cross-cutting 不叫 common

跟 frontend 同样的命名陷阱警告:

> "common" 太宽泛——是"杂物桶"的代名词。`cross-cutting` 是 AOP 术语,精确描述"横切多个业务域"的角色。

backend 也遵守这条规则。`models/cross-cutting/` 装什么:
- **纯类型**——`SplitDirection`(local/ssh/tmux 都用)、`CapabilityFlags`、`SessionLoggingConfig`
- **id 分配器**——`SessionIdSource`(3 种 backend 共享)
- **pure helpers**——`build_remote_image_path`、`tmux_pane_info`
- **常量**——(未来)文件大小上限、超时默认值

## 5. 跟其他层的关系

```
service  ──►  model   ✅ 允许(service 读 model 类型 + 调 model accessor / rules)
app     ──►  model   ✅ 允许(useCase 读 model 类型 + 调 model rules)
infra   ──►  model   ✅ 允许(impl trait 时读 model 类型)
model   ──►  任何    ❌ 禁止
```

**关键**:
- model 是**最底层**——永远不反向依赖 service / app / infra
- model **不** import `tokio` / `tauri` / `std::net` / `std::process`
- model **允许** `serde` / `thiserror` / `derive_more` / `serde_json` 等纯派生 crate
- model **不** 在 `models/<domain>/` 内 import 另一个 domain(除 types 字段引用)

## 6. 跟 service 的对应关系(关键镜像)

| backend model domain | backend service domain |
|---|---|
| `models/session/` | `services/session/` |
| `models/workspace/`(预留) | `services/workspace/`(预留) |
| `models/tmux/` | `services/tmux/` |
| `models/settings/` | `services/settings/`(只管 log_config + saved config 类型) |
| `models/cross-cutting/` | (无对应 service——被所有 domain 用) |
| (无对应 model) | `services/persistence/`(generic IO wrapper) |

**算法 vs 状态的根本分离**(与 frontend 同构):

```
paneTree 算法            → models/workspace/rules.rs             (纯函数)
pane tree 状态            → services/workspace/store.rs           (DashMap,预留位)

applyDisplayConfig        → models/session/rules.rs               (纯函数)
session 元数据             → services/session/DashMap               (中央状态机)

build_remote_image_path   → models/cross-cutting/helpers.rs       (纯函数)
```

这条分离的好处:
1. **model 容易单测**——纯函数,无 mock
2. **service 容易重构**——状态内部表示可换(DashMap / BTreeMap / RwLock<Vec>),接口不变
3. **bug 防御**——跨 service 共享走 `models/<domain>/types.rs` 的纯类型,bug 0009 类问题彻底避免

## 7. 强制约束(可机械校验)

```bash
# model 不能 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/
# 必须为空

# model 不能 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/
# 必须为空(serde / serde_json / thiserror / derive_more 允许)

# cross-cutting 是最底层——不能 import 其他 domain
grep -rn 'use crate::models::\(session\|workspace\|tmux\|settings\)' src-tauri/src/models/cross-cutting.rs
# 必须为空

# model/<domain>/ 之间不能互相调(除 types 字段引用)
grep -rn 'use crate::models::\(session\|workspace\|tmux\|settings\)::' src-tauri/src/models/ \
  --include='*.rs' | grep -v 'src-tauri/src/models/.*types.rs'
# 必须为空(types 文件允许引用其他 domain 的类型字段)
```

## 8. 跟 v0 的核心差异

| 维度 | v0 | v1(本文档) |
|---|---|---|
| 顶层目录结构 | `src-tauri/src/models/` 平铺 3 文件 | **5 业务 + 1 cross-cutting**(6 个子目录) |
| `session.rs` 体积 | 1670 行单文件(含所有 tmux 类型 + SessionIdSource + helpers) | 拆为 `session/types.rs` + `tmux/types.rs` + `cross-cutting/ids.rs` + `cross-cutting/helpers.rs` |
| group 归属 | `models/group.rs` 平铺 | `models/workspace/types.rs`(group 是 workspace 子集) |
| capabilities 归属 | `models/capabilities.rs` 平铺 | `models/cross-cutting/types.rs`(跨域类型) |
| settings 数据模型 | ❌ 不存在(settings 字段散在 session.rs) | `models/settings/types.rs`(`LogConfig / SavedSessionConfigV1 / SizingMode / DisplayConfig / EnvConfig`) |
| workspace 数据模型 | ❌ 不存在(workspace 业务在 frontend store) | `models/workspace/types.rs`(预留位,MVP backend 无状态) |
| tmux 类型 | 内嵌在 session.rs | `models/tmux/types.rs`(独立派生 domain) |
| 子结构模板 | 无 | 每个 domain 有 3-4 文件(`types / accessor / rules / errors`)|
| bug 0009 防御 | 字段直读 window_bindings | binding 数据通过 `models/tmux/types.rs` 的纯类型传递 |

## 9. 入口链

```
src-tauri/src/lib.rs::run()
  ├─► app::shell::api::initialize(app)
  │    └─► services::settings::api::load_log_config
  │         └─► models::settings::types::LogConfig        ← model 读取
  └─► tauri::Builder::default()
       .invoke_handler(app::mod::all_handlers())
       └─► app::{session,terminal,settings}::api::*
           └─► services::{session,tmux,settings,persistence}::api::*
               └─► models::{session,workspace,tmux,settings,cross-cutting}::*    ← model 在最底
                   └─► infrastructure::{pty,ssh,tmux,store,logger}::*
```

## 10. 文档地图

- 顶层(本文):设计契约 / 现状映射 / 依赖方向 / v0→v1 diff
- 6 domain 子文档:每个 domain 3 份(RESPONSIBILITY / INTERFACE / DOWNSTREAM)
- 镜像验证:每份 domain README 的 §3 列 frontend 对应 domain 的同构说明

**TM 验收入口**:先读本文档,再对照 `models/mod.rs` 的 6 domain re-export + `models/session/types.rs::SessionInfo`(最大数据结构)的字段定义。