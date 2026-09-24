# Frontend · Infra 层 (= `src/infra/`)

> **职责**：与外部世界（Tauri IPC、本地 store、剪贴板、文件系统、xterm 缓冲）的适配层。infra = "I/O + 适配"。所有 `invoke()`、`listen()`、`localStorage`、剪贴板读写只允许出现在这一层。
>
> infra 是 frontend 的"最底层"。它把 `@tauri-apps/api`、浏览器 API、Tauri 插件封到统一接口后面，让 service 层不必知道用的是哪一套实现。

## 1. 模块清单（现状）

```
src/infra/
├── index.ts                   barrel
│
├── tauri/                     Tauri IPC 适配
│   ├── commands/              invoke 封装
│   │   ├── index.ts
│   │   ├── sessions.ts        createSession / writeSession / resize / close ...
│   │   ├── tmux.ts            tmux 相关 invoke
│   │   ├── persistence.ts     save/load
│   │   └── window.ts
│   ├── events/                listen 封装
│   │   ├── sessionOutput.ts   session-output 事件
│   │   ├── sessionClosed.ts   session-closed 事件
│   │   ├── tmuxEvents.ts      tmux-events
│   │   └── autoAttach.ts      auto-attach 触发
│   ├── eventBus.ts            通用事件总线
│   ├── eventBuses/            按 domain 的事件总线
│   │   ├── session.ts
│   │   └── tmux.ts
│   └── repositories/          Repository 接口的实现（与 model/repository.ts 配对）
│       ├── sessions.ts
│       ├── persistence.ts
│       └── tmux.ts
│
├── store/                     本地持久化（tauri-plugin-store）
│   ├── savedConfigs.ts
│   ├── savedWorkspaces.ts
│   ├── savedWindows.ts
│   ├── groups.ts
│   └── migrations.ts          schema 版本迁移
│
├── buffers/                   输出帧缓冲
│   ├── sessionOutputBuffer.ts ring buffer
│   ├── sessionOutputChannel.ts
│   └── sessionOutputFrame.ts
│
├── clipboard/                 剪贴板读写
│   ├── read.ts
│   └── write.ts
│
└── logger/                    前端 logger（包 console.* 转发到 backend）
    ├── logger.ts
    └── types.ts
```

## 2. 关键约束

- **infra 是唯一允许 import `@tauri-apps/api` 的层**。service / app / model 出现 `invoke` 或 `listen` 直接字面量 = 架构违规。
- **invoke 调用必须经过 `repositories/`**——不允许 service 层写 `invoke('create_session', cfg)`。`infra/tauri/commands/` 里的裸 invoke 仅作为仓库方法的内部实现，不对外暴露。
- **错误统一抛 typed error**，不是裸 `Error` 或 string。service 层 catch 后转成业务错误。
- **事件总线 (`eventBus.ts`) 是 infra 的核心**：service 层订阅事件 → 写 model；app 层通过 hook 订阅事件 → re-render。三层的事件契约定义在 `model/<domain>/events.ts`。
- **`store/` 的 schema 迁移**：`migrations.ts` 是唯一允许写版本号的地方。新加字段必须 append migration，老字段 deprecated 但不能删。

## 3. 依赖方向

```
infra/  ──►  model/  (类型契约来自 model/repository.ts 的接口)
   │
   └─►  @tauri-apps/api、@tauri-apps/plugin-store、tauri-plugin-clipboard-manager、浏览器 API
```

infra 层**禁止**依赖 service / app / ui。

## 4. 重要细节

- **`eventBus.ts` vs `eventBuses/`**：单例 `eventBus` 是底座，`eventBuses/session.ts` 和 `eventBuses/tmux.ts` 是 domain-specific 的 wrapper（带类型化的 payload）。service 层订阅时只用 wrapper。
- **`sessionOutputBuffer.ts`** 是 xterm 渲染前的最后一道缓冲。它把后端高频 emit 节流到 ~60fps，避免 xterm 写穿。这个 ring buffer 的设计跟 model/output/ 的类型定义紧耦合，**修改 buffer 大小需要同步更新两处**。
- **CSP 禁用**（AGENTS.md 记录）：当前 `csp: null`，意味着 frontend 远程脚本不受限制。infra 层如果加新插件（特别是涉及下载 / 网络），必须先回到 app 层决策是否打开 CSP。

## 5. 改进方向

- **补齐 `repositories/`**：现状 `infra/tauri/commands/` 的 invoke 已经被 service 直接调用，绕过了 repositories。下一步给每个 commands 文件包一个 repository 实现，service 层通过 repository 接口拿能力，不再直接 import commands。
- **`infra/logger/` 跟 `service/logger/` 重叠**：如 `frontend/service/README.md` §5 所述，把前端 logger 整体下沉到 infra，service 不再包一层。
- **`infra/store/` 加 schema 校验**：现在 store 读写都是 `JSON.parse`，没有运行时校验。加 zod schema（model 层定义，infra 层调用）防止 store 文件被外部破坏后整个应用挂掉。
- **`infra/buffers/` 拆分为 `infra/buffers/{ring,throttle,frame}`**：当前一个文件 200+ 行，承担 ring buffer + 节流 + 帧解析三件事。
- **`infra/clipboard/` 几乎无内容**：剪贴板读写目前只是 `navigator.clipboard` 的薄包装。如果未来加图片 / 富文本支持，扩成 `clipboard/{text,image,html}.ts`。
- **`infra/eventBuses/` 跟 `model/<domain>/events.ts` 的契约同步**：现状两边手写对齐，新加事件类型时容易漏改一边。下一步从 `events.ts` 自动生成 eventBus 类型（type-level test 保证编译期对齐）。
