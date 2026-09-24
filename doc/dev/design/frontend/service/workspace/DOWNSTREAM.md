# Service · Workspace — 对下依赖接口

> **位置**：`src/service/workspace/`

## 1. 依赖图

```
service/workspace/
├── api.ts        ────►  @/model/workspace/types      (类型)
├── api.ts        ────►  @/model/workspace/accessor   (派生计算)
├── store.ts      ────►  @/model/workspace/types      (持有 Workspace 实例)
├── store.ts      ────►  @/model/workspace/rules      (mutation 时生成新对象)
└── store.ts      ────►  @/model/session/types        (反向引用 session.workspaceId)
```

## 2. model/workspace

| 调用 | 来源 | 何时调 |
|---|---|---|
| `Workspace` / `Window` / `Group` / `PaneNode` 类型 | `model/workspace/types` | store schema + api.ts 类型 |
| `createLeafPane` / `createSplitNode` 等 | `model/workspace/rules` | store mutation 时使用 |
| `getActiveWorkspace(workspaces)` | `model/workspace/accessor` | api.ts 派生方法 |
| `getWindowsByWorkspace` | `model/workspace/accessor` | api.ts listWindows |

## 3. model/session（**反向引用**）

workspace store **持有** Session 实例的反向引用——通过 pane 树持有：

```
Window.panes[].sessionId → Session
```

但 workspace service **不直接读** session service——只是 store 里的字段引用。

如果需要"由 sessionId 查 workspace"，通过以下方式：

```typescript
// 在 app 层编排（不直接调 session service）
const workspaceId = workspaceSvc.findBySessionId(sessionId);  // 内部遍历 workspace 树
```

## 4. infra

workspace service **几乎不直接调 IPC**——workspace CRUD 主要在 app/workspace/usecases 通过 IPC 完成，然后写 store。

**例外**：

- `autoAttachTmuxServers()` 等纯 IPC 命令如果需要 store 同步，可以在 service 层监听
- 但通常**不**——bridge 通常只在 session/terminal 等需要实时同步的 domain

## 5. 不允许的依赖

- ❌ `service/workspace/` → `app/` 或 `ui/` 或 `@tauri-apps/api` 直接
- ❌ `service/workspace/` → `service/session/api`（不直接调其他 service api）
- ❌ `service/workspace/` → `service/persistence/api`（持久化由 app 编排）

## 6. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"@tauri-apps' src/service/workspace/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(app\|ui\)' src/service/workspace/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(session\|theme\|logger\|persistence\|settings\|output\|terminal\)/api' src/service/workspace/ --include='*.ts'
# 必须为空
```
