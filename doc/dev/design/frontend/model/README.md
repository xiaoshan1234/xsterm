# Frontend · Model 层 (= `src/model/`)

> **职责**：纯状态 + 不变量 + 派生计算。无 React、无 IPC、无 I/O。
>
> model = "数据形状 + 在数据上跑的纯函数"。service 层读 model 算结果，app 层读 model 渲染 UI。**任何层都不得在 model 之上做重复的派生计算**。

## 1. 模块清单（现状）

```
src/model/
├── index.ts                       顶层 barrel
├── app.ts                         App-level state 顶层类型
├── capabilities.ts                后端能力探测结果
├── session-config.ts              创建 session 的配置 shape
├── session-output.ts              输出帧类型
├── persistence.ts                 持久化数据形状（兼容 shim）
├── pane.ts                        Pane 数据（兼容 shim）
│
├── session/                       一个 domain 一个子目录，4-piece 表面
│   ├── index.ts                   barrel
│   ├── types.ts                   Session / SessionKind / SessionStatus
│   ├── repository.ts              SessionRepository 接口
│   ├── events.ts                  SessionEvent 枚举 + handler 签名
│   ├── accessor.ts                纯派生 helper（getActive、findById）
│   ├── model.ts                   SessionModel class（active state holder）
│   ├── useSessionModel.ts         React hook 绑定（可选）
│   └── model.test.ts
├── workspace/                     同上结构
├── window/
├── pane/
├── persistence/
├── tmux/                          tmux 域
├── output/                        会话输出缓冲
└── theme/                         主题配置
```

> 注释中的"4-piece 表面"：`types.ts` + `repository.ts` + `events.ts` + `accessor.ts`。这是 frontend model 的**约定结构**，每个 domain 子目录都按这个模板落。

## 2. 关键约束

- **禁止**任何 `import { invoke } from "@tauri-apps/api"` 或 `listen(...)` 或 `import { ... } from "../infra/*"`。
- **禁止** `import React` 或 `useState` / `useEffect`（除了可选的 `*Model.ts` hook 文件，但 hook 仍然只读 model，不调 service）。
- **派生计算必须放在 model 的 `accessor.ts`**。例如"按 lastUsed 排序的会话列表"是派生数据，写在 `model/session/accessor.ts`，service 层和 app 层**共用同一个函数**，不允许 service 单独再写一遍排序逻辑。
- **类型字段命名严格 camelCase**，与后端 `serde(rename_all = "camelCase")` 对齐。
- **保留 legacy shim**：`session.ts` / `session-config.ts` / `pane.ts` 等顶层文件已经存在，下层消费方继续 import 它们不报错。新代码**应当**直接用 `session/types.ts` 的导出。

## 3. domain 子目录的 4-piece 模板

每个 domain 子目录（`session/`、`workspace/`、`window/`、`pane/`、`tmux/`、`persistence/`、`output/`、`theme/`）按以下模板组织：

| 文件 | 职责 | 例子 |
|---|---|---|
| `types.ts` | 纯数据 shape、enum、union | `Session`、`SessionKind`、`SessionStatus` |
| `repository.ts` | 与后端对话的接口签名（**不实现**） | `interface SessionRepository { create(cfg): Promise<SessionId> }` |
| `events.ts` | 事件总线契约：event name + payload | `SessionOutputEvent`、`SessionClosedEvent` |
| `accessor.ts` | 纯派生 helper（排序、过滤、聚合） | `getActiveSession(sessions): Session` |

可选的第五个文件：`model.ts` + `useXxxModel.ts`，把上述类型组合成"可订阅的 model"。

## 4. 依赖方向

```
model/  ◄─── 任何层都可读
   │
   └─►  无（除了 TS 内置类型 + zod/schema 等纯校验库，可选）
```

model 层**绝不**依赖其他前端目录。

## 5. 改进方向

- **8 个 domain 已基本对齐**。缺的是 `repository.ts` 的统一实现——目前每个 domain 的 repository 行为是 service 层现编的。下一步把 service 层里的"跟 model 强耦合的部分"挪到 model 层作为 default 实现。
- **`model.ts` class 化 vs function-based**：`SessionModel` 当前是 class + setter。React 19 时代可考虑全部转回 `useReducer` + 纯函数 reducer，让"应用状态变更"成为可重放的事件流。
- **zod 引入时机**：目前 model 字段没有运行时校验。后端 IPC 返回值不可信，schema 校验应在 infra 层做。但 schema 形状本身可以放 model 层（`types.ts` 的 companion `schema.ts`）。下一阶段评估。
- **`accessor.ts` 集中派生**：现状部分派生计算散落在 component 文件里（典型：`Sidebar.tsx` 里直接排序 sessions）。grep 一次，把这类计算迁到 `accessor.ts`。
- **`theme/` 跟其他 7 个 domain 不一样**：theme 是 CSS 变量 + xterm 颜色配置，不是数据。要么改名 `theme/` → `infra/theme/`，要么在 model 里只留 type 把 CSS 部分挪走。
