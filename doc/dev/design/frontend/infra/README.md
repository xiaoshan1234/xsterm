# Frontend · Infra 层（v4 从零设计）

> **位置**：`src/infra/`
> **关注点**：物理适配（外部世界 / npm 包 / Tauri IPC）
> **平级于**：app / ui / service / model（5 个顶层目录之一）

## 1. 4 子模块

从零设计后 infra 应当有 **4 个子模块**——既不追求最简（避免 UI / service 直接调外部 API），也不追求最全（避免"工具层"变成"杂物桶"）：

```
src/infra/
├── tauri/         IPC 适配（invoke 封装 + listen 封装 + Repository 实现 + 事件总线）
├── store/         tauri-plugin-store wrapper（持久化底层）
├── clipboard/     剪贴板读写（tauri-plugin-clipboard-manager 包装）
└── logger/        日志（命令式 API，全局单例）
```

## 2. 为什么是 4

候选清单回顾——xsterm frontend 跟"外部世界"的所有交互：

| 外部交互 | 归属 |
|---|---|
| Tauri IPC（invoke/listen） | `infra/tauri` |
| Tauri 窗口控制（getCurrentWindow）| 归 `ui/shell`（特例——只 shell 用） |
| tauri-plugin-store | `infra/store` |
| 剪贴板 | `infra/clipboard` |
| 日志 | `infra/logger` |
| 输出帧 ring buffer | 归 `ui/terminal`（特例——只 terminal 用） |
| 静态资源（CSS/icons/assets） | 归 `ui`（UI 关注点） |
| xterm.js / xterm-addons | 归 `ui/terminal`（UI 第三方） |
| 5 个 ANSI 调色板 | `model/settings/terminal`（数据而非物理） |

调整后：

| v3 候选 | v4 调整 | 理由 |
|---|---|---|
| `infra/tauri/` | **保留** | 核心 IPC 适配，跨 service |
| `infra/store/` | **保留** | 持久化底层，service/persistence 编排 |
| `infra/clipboard/` | **保留** | 全局工具，ui/dialogs 用 |
| `infra/logger/` | **保留**（已设计） | 全局命令式 API |
| `infra/buffers/` | ❌ 归 `ui/terminal` | 只 terminal 用，是渲染队列 |
| `infra/window/` | ❌ 归 `ui/shell` | 只 shell 用，是窗口控制 |
| `infra/themes/` | ❌ 归 `model/settings/terminal` | 调色板是 model 数据 |
| `infra/static/` | ❌ 归 `ui` | CSS/icons 是 UI 关注点 |

## 3. 4 子模块索引

每个子模块有 3 份文档：**职责 / 对外接口 / 对下依赖**

| 子模块 | 职责 | 对外接口 | 对下依赖 |
|---|---|---|---|
| **tauri** | [RESPONSIBILITY](./tauri/RESPONSIBILITY.md) | [INTERFACE](./tauri/INTERFACE.md) | [DOWNSTREAM](./tauri/DOWNSTREAM.md) |
| **store** | [RESPONSIBILITY](./store/RESPONSIBILITY.md) | [INTERFACE](./store/INTERFACE.md) | [DOWNSTREAM](./store/DOWNSTREAM.md) |
| **clipboard** | [RESPONSIBILITY](./clipboard/RESPONSIBILITY.md) | [INTERFACE](./clipboard/INTERFACE.md) | [DOWNSTREAM](./clipboard/DOWNSTREAM.md) |
| **logger** | [RESPONSIBILITY](./logger/RESPONSIBILITY.md) | [INTERFACE](./logger/INTERFACE.md) | [DOWNSTREAM](./logger/DOWNSTREAM.md) |

## 4. infra 的"特权"——直跳外部 API

infra 是 frontend **唯一**允许直接 `import` 外部 API 的层：

| 外部 API | 归属 |
|---|---|
| `@tauri-apps/api/core` 的 `invoke` | `infra/tauri/commands/*` |
| `@tauri-apps/api/event` 的 `listen` | `infra/tauri/events/*` |
| `@tauri-apps/api/window` 的 `getCurrentWindow` | （归 `ui/shell`——特例） |
| `@tauri-apps/plugin-store` 的 `Store.load` | `infra/store/store.ts` |
| `@tauri-apps/plugin-clipboard-manager` | `infra/clipboard/*` |
| `console.*` | `infra/logger/forwarder.ts` |

**这条特权让 infra 是"frontend 的物理边界"**——所有外部 API 调用都集中在这里。

## 5. 依赖方向

```
app         ──►  service ──►  infra/tauri        (业务经 service 调 IPC)
ui          ──►  service ──►  infra/tauri        (同上)
ui          ──►  infra/clipboard                  (ui/dialogs 直接调，例外)
ui          ──►  infra/logger                     (ui logger 全局可用，例外)
任何层       ──►  infra/logger                     (logger 全局可用)
service     ──►  infra/store                      (service/persistence 调)
service     ──►  infra/tauri                      (service IPC 调)
```

**禁止**：

- ❌ `infra/` → `app/` `ui/` `service/`
- ❌ `infra/` → `model/`（**只允许**读 model 类型）
- ❌ `app/ui` → `infra/tauri`（**禁止直跳**，必须经过 service）

## 6. 例外：ui 直跳 infra 的 3 个特例

| ui 子模块 | 调用 infra | 理由 |
|---|---|---|
| `ui/dialogs` | `infra/clipboard` | 剪贴板是 UI 操作，不是业务状态 |
| `ui/terminal` | （输出 buffer 已归 ui） | 渲染队列是 UI 实现 |
| `ui/shell` | （窗口控制已归 ui） | 窗口装饰是 shell 职责 |
| **任何** | `infra/logger` | logger 全局可用 |

**关键**：ui **不可以**直跳 `infra/tauri`（IPC 适配必须经过 service），但可以直跳 `infra/clipboard` 和 `infra/logger`。

## 7. 强制约束（可机械校验）

```bash
# infra 是唯一允许直跳 @tauri-apps/api 的层
grep -rn 'from\s*"@tauri-apps' src/ --include='*.ts' --include='*.tsx' | grep -v 'src/infra/'
# 必须为空（除 infra 外）

# infra 不能依赖 app / ui / service
grep -rn 'from\s*"\.\./\(app\|ui\|service\)' src/infra/ --include='*.ts'
# 必须为空

# infra 可以依赖 model（仅类型）
grep -rn 'from\s*"\.\./model/' src/infra/ --include='*.ts'
# 应当出现（类型）

# ui 不可以直跳 infra/tauri（必须经过 service）
grep -rn 'from\s*"@/infra/tauri' src/ui/ --include='*.ts' --include='*.tsx'
# 必须为空（除 ui/terminal 通过 props 间接使用）

# ui 可以直跳 infra/clipboard 和 infra/logger（特例）
```

## 8. 5 层架构现状

```
src/
├── app/         业务编排（5 module × 3 文档 = 15 份）
├── ui/          视图渲染（5 module × 3 文档 = 15 份）
├── model/       纯数据 + 算法（5 + cross-cutting × 3 文档 = 16 份）
├── service/     跨 module 状态 + IPC 桥（6 domain × 3 文档 = 18 份）
└── infra/       物理适配（4 子模块 × 3 文档 = 12 份）
```

## 9. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 顶层目录结构 | `src/infra/` 平铺 | 不变，但**按 4 子模块重构** |
| 子模块数 | 多个（tauri/buffers/window/themes/...） | 4 个（tauri/store/clipboard/logger） |
| buffers | infra/buffers | 归 `ui/terminal` |
| window | infra/window | 归 `ui/shell` |
| themes | infra/themes | 归 `model/settings/terminal` |
| static | infra/static | 归 `ui` |
| logger 位置 | service/logger | 归 `infra/logger` |

## 10. 设计系统约束

infra 不涉及 UI 设计系统，但 design-system.css 在 `ui/styles/global.css` 引入（main.tsx），由 ui 层管理。
