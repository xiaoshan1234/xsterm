# Frontend · Service 层 (= `src/service/`)

> **职责**：跨多个 model 的业务流程。把"读 session 列表 + 调 invoke 创建 + 写回 model"这种多步操作放在一个地方。service 是 model 与 infra 之间的胶水。
>
> service **不知道 UI 存在**——它不知道 React、不知道组件、不知道 props。它返回的是纯数据 + Promise，由 app 层决定怎么消费。

## 1. 模块清单（现状）

```
src/service/
├── index.ts                  barrel — 按 domain 命名空间 re-export
│
├── session/                  会话业务
│   ├── create.ts             createLocalSession / createSshSession / createTmuxSession
│   ├── lifecycle.ts          close / reconnect / rename / resize
│   └── ...
├── workspace/                工作区业务
├── window/                   窗口业务
├── pane/                     分屏业务
├── tmux/                     tmux 业务（attach / detach / pane 操作）
├── persistence/              保存/加载工作区、配置、组
├── output/                   输出缓冲与节流
├── theme/                    主题切换
├── logger/                   前端日志 → invoke('log_message')
│
├── bridges/                  跨层数据桥接
│   └── ...                   例：把 session-output 事件映射到 model 写入
│
├── hooks/                    React-aware service bindings
│   └── useXxxService.ts      hook 形式暴露给 app 层
│
└── legacy/                   兼容旧路径（删干净后整目录可删）
    ├── hooks/                旧 React hooks 位置
    └── utils/                旧 utils 位置
```

## 2. 关键约束

- **service 不知道 React**（除了 `hooks/` 子目录——hooks/ 是允许的 service × React 适配层）。
- **service 不写 UI**。即使"打开一个对话框提示错误"也应该返回 `Result<T, Error>`，由 app 层决定如何呈现。
- **service 之间通过 model 共享数据，不互相调用**。`sessionService.create()` 不能 import `workspaceService`。需要组合时由 app 层的 useCase 完成。
- **service 是唯一允许调 `infra/` 的层**。app 层直跳 infra 是架构违规。
- **service 内的 `.test.ts` 用 vitest mock infra 的 Tauri 调用**，不 mock `@tauri-apps/api` 本体。

## 3. 依赖方向

```
service/  ──►  model/  (读 + 写 model)
     │
     └─►  infra/   (调 Tauri IPC)
```

service 层**禁止** import `app/useCases/*` 或 `ui/*`。

## 4. 与 backend service 的语义差异

| 维度 | backend service | frontend service |
|---|---|---|
| 持有状态 | 是（`SessionManager` 单例） | 否（model 层持有） |
| 错误处理 | `thiserror` 派生 `Result<T, ServiceError>` | 通常 throw / `Result<T, string>`，由 useCase 翻译 |
| 异步原语 | `tokio::spawn` / channel | `Promise` / `EventTarget` |
| 测试方式 | `mockall` mock infra trait | vitest mock `@tauri-apps/api` |
| 跨服务通信 | 通过 `models::*` 共享数据 | 通过 `model/*` 共享数据 |

两侧 service 层**职责对称**（都是"业务编排"），但实现机制完全不同。

## 5. 改进方向

- **`service/legacy/` 必须逐步清空**。这是历史包袱，AGENTS.md 已经记录旧路径被 shim 兼容；下一阶段按 model 的 domain 顺序逐个把 legacy 函数迁走，每迁一个删除 `legacy/hooks/` 或 `legacy/utils/` 里对应文件。
- **`bridges/` 与 `hooks/` 边界**：`bridges/` 是"跨层数据桥"（事件 → model 写入），`hooks/` 是"对 React 的暴露"。两个角色不同，目前混在一起。下一步拆 `service/{bridges,hooks,stores}/`，hooks 拆出后 service 主体可彻底变成"纯函数集合"。
- **service 不再调 `sessionService.X` 直跳**：现状 service 内部有"我先调 sessionService 再调 persistenceService"的串联写法。目标态改由 app/useCases/ 编排，service 只暴露单一入口。
- **`output/` 是 service 但其实更像 buffer infra**：输出缓冲（xterm write 节流、ring buffer）本质是无状态 transform，可以挪到 `infra/buffers/`。评估后再决定。
- **`logger/` 跟 model 概念重叠**：loggerService 实际是把前端 console 桥到后端 rolling file。把它降级为 `infra/logger/`，service 不必再包一层。
