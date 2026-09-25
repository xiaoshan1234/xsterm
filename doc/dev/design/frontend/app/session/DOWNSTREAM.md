# Module · App Session — 对下依赖接口

> **位置**：`src/app/modules/session/`

## 1. 依赖图

```
modules/session/
├── api.ts    ────►  app/workspace/api.ts          (openInWorkspace 跨 module)
├── usecases/ ────►  infra/tauri/commands/session  (invoke create_local_session 等)
├── usecases/ ────►  service/session/store         (读写 session store)
├── usecases/ ────►  service/persistence           (saved configs)
├── usecases/ ────►  service/settings              (default shell / default ssh user)
└── model.ts  ────►  model/session/types
```

## 2. app/workspace

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useWorkspaceApi().openSession(sessionId, configId, workspaceId, paneId?)` | `app/workspace/api.ts` | session 创建后调，把 session 装到 pane |

**关键**：session 不直接 import `app/workspace/usecases/*`——只调 api.ts。

## 3. infra/tauri/commands/session

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('create_local_session', config)` | `infra/tauri/commands/session/local` | createLocal.ts |
| `invoke('create_ssh_session', config)` | `infra/tauri/commands/session/ssh` | createSsh.ts |
| `invoke('create_tmux_session', config)` | `infra/tauri/commands/session/tmux` | createTmux.ts |
| `invoke('close_session', { sessionId })` | `infra/tauri/commands/session/close` | close.ts |
| `invoke('write_session', { sessionId, data })` | `infra/tauri/commands/session/write` | write.ts (输入数据) |
| `invoke('resize_pty_session', ...)` | `infra/tauri/commands/session/resize` | resize.ts |

**约束**：session **不**直接 import `@tauri-apps/api`——必须经过 `infra/tauri/commands/session`。

## 4. service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSessionService()` 订阅 + mutation | `service/session/api` | usecases/store |
| saved configs CRUD | `service/persistence/api` | saveConfig.ts / removeConfig.ts |
| 读 default shell / default ssh user | `service/settings/api` | createLocal / createSsh 初始化时 |

## 5. model/session

| 调用 | 来源 |
|---|---|
| `Session` / `SessionConfig` / `LocalSessionConfig` / `SshSessionConfig` / `TmuxCcConfig` | `model/session/types` |
| `PersistedSessionConfig` | `model/persistence/types`（v4 内嵌到 session） |
| `SessionDisplayConfig` | `model/session/types` |
| `SessionKind` / `SessionStatus` | `model/session/types` |

## 6. 设计意图：session 通过 settings 拿默认值

session 不直接调 `app/settings/api.ts`（避免循环：settings 调 session 创建默认值，session 调 settings 读默认值）。session 通过 `service/settings/api` 读默认值——单向：settings 写，session 读。

```typescript
// modules/session/usecases/createLocal.ts
import { useSettingsService } from "@/service/settings/api";  // ✅ 通过 service

export async function createLocal(config: LocalSessionConfig, workspaceId: string): Promise<...> {
  const settings = useSettingsService().get();
  const finalConfig = {
    ...config,
    shell: config.shell ?? settings.defaultShell,
    cwd: config.cwd ?? process.env.HOME ?? "/",
  };
  // ...
}
```

## 7. 不允许的依赖

- ❌ `modules/session/` → `app/workspace/usecases/*`（必须走 api.ts）
- ❌ `modules/session/` → `infra/` 直接（必须经过 `infra/tauri/commands/session`）
- ❌ `modules/session/` → `app/settings/api.ts`（避免循环依赖，通过 service 间接）

## 8. 依赖变更流程

1. **新增 useCase** → 加 usecases + api.ts + 更新 §3
2. **backend 新增 IPC 命令** → 加 `infra/tauri/commands/session/<子域>` + 加 usecases 调用
3. **backend 修改 IPC 命令签名** → 同步更新 §3 + usecases
4. **settings 新增默认字段** → 加 `service/settings` + 更新 §4
5. **session store schema 变化** → 加 migration + 更新 model.ts