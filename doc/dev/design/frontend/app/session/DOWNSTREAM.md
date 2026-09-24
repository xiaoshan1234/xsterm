# Module · App Session — 对下依赖接口

> **位置**：`src/app/modules/session/`

## 1. 依赖图

```
modules/session/
├── api.ts    ────►  app/workspace/api.ts          (openInWorkspace 跨 module)
├── usecases/ ────►  shared/infra/api.ts           (invoke create_local_session 等)
├── usecases/ ────►  shared/service/session/store (读写 session store)
├── usecases/ ────►  shared/service/persistence   (saved configs)
├── usecases/ ────►  shared/service/settings      (default shell / default ssh user)
└── model.ts  ────►  shared/model/session
```

## 2. app/workspace

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useWorkspaceApi().openSession(sessionId, configId, workspaceId, paneId?)` | `app/workspace/api.ts` | session 创建后调，把 session 装到 pane |

**关键**：session 不直接 import `app/workspace/usecases/*`——只调 api.ts。

## 3. shared/infra

| 调用 | 来源 | 何时调 |
|---|---|---|
| `infra.invoke('create_local_session', config)` | `shared/infra/api.ts` | createLocal.ts |
| `infra.invoke('create_ssh_session', config)` | `shared/infra/api.ts` | createSsh.ts |
| `infra.invoke('create_tmux_session', config)` | `shared/infra/api.ts` | createTmux.ts |
| `infra.invoke('close_session', { sessionId })` | `shared/infra/api.ts` | close.ts |
| `infra.invoke('write_session', { sessionId, data })` | `shared/infra/api.ts` | write.ts (输入数据) |
| `infra.invoke('resize_pty_session', ...)` | `shared/infra/api.ts` | resize.ts |

**约束**：session **不**直接 import `@tauri-apps/api`——必须经过 `shared/infra/api.ts`。

## 4. shared/service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSessionStore()` 订阅 + mutation | `shared/service/session/store` | usecases/store |
| saved configs CRUD | `shared/service/persistence` | saveConfig.ts / removeConfig.ts |
| 读 default shell / default ssh user | `shared/service/settings` | createLocal / createSsh 初始化时 |

## 5. shared/model/

| 调用 | 来源 |
|---|---|
| `Session` / `SessionConfig` / `LocalSessionConfig` / `SshSessionConfig` / `TmuxCcConfig` | `shared/model/session` |
| `PersistedSessionConfig` | `shared/model/persistence` |
| `SessionDisplayConfig` | `shared/model/session` |
| `SessionKind` / `SessionStatus` | `shared/model/session` |

## 6. 设计意图：session 通过 settings 拿默认值

v3 设计里 createLocalSession 直接 hardcode 默认值。新设计：

```typescript
// modules/session/usecases/createLocal.ts
import { useSettingsStore } from "@/app/shared/service/settings/store";  // ✅ 通过 service

export async function createLocal(config: LocalSessionConfig, workspaceId: string): Promise<...> {
  const settings = useSettingsStore.getState();
  const finalConfig = {
    ...config,
    shell: config.shell ?? settings.defaultShell,
    cwd: config.cwd ?? process.env.HOME ?? "/",
  };
  // ...
}
```

**好处**：

- session 不直接调 `app/settings/api.ts`（避免循环：settings 调 session 创建默认值，session 调 settings 读默认值）
- session 通过 `shared/service/settings/store` 读默认值——单向：settings 写，session 读

## 7. 当前架构债 → 设计意图说明

| 旧 v3 现状 | 新设计意图 |
|---|---|
| 43 个 useCase 平铺在 `app/useCases/` | 5 个 module 按产品功能 + 每个 module 强制 api.ts |
| `createLocalSession` / `createLocalSessionOnly` 两个文件 | `createLocal.ts` 一个文件，2 个 export 函数 |
| session 操作直接 import service | session 通过 api.ts 间接调 |
| 跨 module 协调（session → workspace）混杂在 useCase 内部 | `openInWorkspace.ts` 单独 usecase，调 api.ts |

## 8. 不允许的依赖

- ❌ `modules/session/` → `app/workspace/usecases/*`（必须走 api.ts）
- ❌ `modules/session/` → `infra/` 直接（必须经过 shared/infra）
- ❌ `modules/session/` → `app/settings/api.ts`（避免循环依赖，通过 shared/service 间接）

## 9. 依赖变更流程

1. **新增 useCase** → 加 usecases + api.ts + 更新 §3
2. **backend 新增 IPC 命令** → 加 shared/infra/commands + 加 usecases 调用
3. **backend 修改 IPC 命令签名** → 同步更新 §3 + usecases
4. **settings 新增默认字段** → 加 shared/service/settings + 更新 §4
5. **session store schema 变化** → 加 migration + 更新 model.ts
