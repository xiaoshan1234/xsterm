# SessionModel 设计稿（Phase 3 of model refactor）

> **状态**：🚧 设计稿 v0（基于 2026-09 调研）
>
> **范围**：`src/model/session/model.ts` 的活跃 model 形态、生命周期、与现有 `service/session/store.ts` + `service/bridges/sessionBridge.tsx` 的迁移路径。不覆盖 `TmuxModel` / `PersistenceModel` —— 那两个是 Phase 4。
>
> **前置**：本设计依赖 [Phase 1 + Phase 2 PR](#references) 已经合入 `main`（仓库当前 commit `3db0fdf feat(model): add Repository / EventBus contracts + tauri impls`），即 `SessionRepository` / `SessionEventBus` / `tauriSessionRepository` / `tauriSessionEventBus` 都已就绪。
>
> **阅读路径**：10 分钟读 §0 + §3 + §4；30 分钟读全文。

---

## 0. 一句话结论

把 `service/session/store.ts` 当前用 Zustand 承担的「**Session 行注册表 + 生命周期 + tmux 重试 banner 状态**」三件套搬到一个**显式有状态、有方法、注入 Repository** 的 `SessionModel` 对象；Zustand store 退化为**只读 React 镜像**（Phase 3 试点），未来 Phase 5 可以替换为 `useSyncExternalStore`。

`service/bridges/sessionBridge.tsx` 不再直接 `useSessionStore.getState().markSessionConnected(...)`，而是调 `sessionModel.markConnected(...)`；`sessionModel` 内部既更新自身状态、又写入 React 镜像。Use cases（`app/useCases/createTmuxSession.ts` 等）继续持有自己的 store 调用 —— Phase 4 再迁。

---

## 1. 背景与目的

### 1.1 当前痛点（commit `3db0fdf` 之前）

- `src/model/` 是个**只有 types 的目录**，没有任何运行时逻辑、Repository 契约、EventBus 契约。
- 真实意义上的"model"散落在 `service/<domain>/store.ts`（Zustand state）+ `service/<domain>/actions.ts`（mutator wrapper）+ `service/bridges/<domain>Bridge.tsx`（事件→store 扇入）。
- `service/session/store.ts::useSessionStore` 同时持有：
  - **`sessions: Session[]`** —— 真正的 model 数据
  - **`sessionsRef: { current: Session[] }`** —— React 外的同步读取副本
  - **`establishingSessionsRef: { current: Set<number> }`** —— 创建中会话集合
  - **`globalLocalEcho / sessionLocalEchoOverrides / getEffectiveLocalEcho`** —— 本地回显策略
  - **`tmuxControllerErrors` / `tmuxControllerConfigsRef` / `tmuxWindowListsRef`** —— tmux 重试 banner 状态
  - 上述每一项都有一对 `setX` + `upsertX` + `removeX` mutator（29 个 action）

  → 一个 store 同时承载 3 个不同语义的域（session registry、local-echo policy、tmux retry banner），每个都暴露一份 action API。

- `service/bridges/sessionBridge.tsx` 直接拿 `useSessionStore.getState()`，fan Tauri 事件进 store —— 不存在一个语义化的 `sessionService.markConnected(id, false)`。
- `app/useCases/createTmuxSession.ts` 也直接拿三个 store 调 `.setX`，绕过 `service/*/actions.ts`（[ts-app-service-interface.md §2.3](./ts-app-service-interface.md) 已记录这个"actions 层是死代码"的现状）。
- 路径上 `app → service → model` 的依赖方向是对的，但**没有** `model → infra` 的 Repository 契约（Phase 2 已经补上），也没有**真正的活跃 model 对象**在 service 层之上。

### 1.2 Phase 1 + 2 已经给了什么

| Phase | 给的东西 | 文件 |
|---|---|---|
| 1 | `src/model/session/{types,accessor,index}.ts` | 类型、accessor helper |
| 2 | `src/model/session/repository.ts::SessionRepository` | 8 个方法：list / create / close / write / resizePty / resizeSsh / resizeTmuxPane / uploadImageToSsh |
| 2 | `src/model/session/events.ts::SessionEventBus` | 3 个订阅：onOutput / onClosed / onDisconnected |
| 2 | `src/infra/tauri/repositories/sessions.ts::tauriSessionRepository` | Tauri 实现，wrap `invoke(...)` |
| 2 | `src/infra/tauri/eventBuses/session.ts::tauriSessionEventBus` | Tauri 实现，bridge 异步 unlisten |

Phase 3 唯一要做的事：**写一个持有 Session 状态、注入 Repository + EventBus、暴露 typed mutator 方法的活跃 model**。

### 1.3 相关文档

| 主题 | 路径 |
|---|---|
| App ↔ Service 接口契约（含 S-001..S-010 session action 清单） | [`doc/dev/roadmap/ts-app-service-interface.md`](./ts-app-service-interface.md) §3.2.1 |
| 前端目标态分层（model ← infra ← service ← app ← ui） | [`doc/dev/architecture/03-development-view.md`](../architecture/03-development-view.md) §2 |
| 现有 session store 现状 | `src/service/session/store.ts`（295 行） |
| 现有 session bridge 现状 | `src/service/bridges/sessionBridge.tsx`（67 行） |
| Use case 现状（典型：`createTmuxSession.ts` 直写 3 个 store） | `src/app/useCases/createTmuxSession.ts` |

---

## 2. 目标与非目标

### 2.1 Goals

- **G-1**：session 域的所有"读取 + 写入 + 事件回流"封装到一个有状态的 `SessionModel` 对象。
- **G-2**：所有写入 session 状态的入口（use case、bridge）都通过 `SessionModel` 的方法，不直接 `useSessionStore.getState().setX`。
- **G-3**：`SessionModel` 自己注入 `SessionRepository` + `SessionEventBus`，model 模块**不 import** 任何 `@tauri-apps/api` 或 `src/infra/*`。
- **G-4**：React 组件订阅模式**不破**：现有 `useSessionStore(selector)` 风格的 hook 全部保留 —— Phase 3 通过 model 写镜像 store 实现，Phase 5 再替换 `useSyncExternalStore`。
- **G-5**：保持 `service/session/store.ts` 既有 429 个测试通过；新增 ≥ 30 个 model-level 单元测试。

### 2.2 Non-goals（Phase 3 不做）

- ❌ 不替换 `service/legacy/contexts/session/*` —— Commit 6 整体删除。
- ❌ 不动 `app/useCases/*` —— use case 继续直接调 `service/*/store.ts`；Phase 4 切换到 `sessionModel.method()`。
- ❌ 不替换 Zustand —— Phase 5 议题（`useSyncExternalStore` 迁移）。
- ❌ 不引入新依赖（`zustand`、`use-sync-external-store/select` 等保持现状）。
- ❌ 不写 `TmuxModel` / `PersistenceModel` —— Phase 4 议题，本文 §10.1 给衔接说明。

---

## 3. 状态归属

### 3.1 现在（commit `3db0fdf` 状态）

`useSessionStore` 同时持有三个域的状态：

| 域 | 字段 | 实际语义 |
|---|---|---|
| **session registry** | `sessions` / `sessionsRef` / `establishingSessionsRef` | 真正的 model 状态 |
| **session registry** | `addSession` / `removeSession` / `updateSession` / `markSessionConnected` / `setSessionName` / `applyDisplayConfig` | 6 个 mutator |
| **local-echo policy** | `globalLocalEcho` / `sessionLocalEchoOverrides` / `getEffectiveLocalEcho` | 配置状态 |
| **local-echo policy** | `setGlobalLocalEcho` / `setSessionLocalEchoAction` / `setSessionLocalEchoOverride` | 3 个 mutator |
| **tmux retry banner** | `tmuxControllerErrors` / `tmuxControllerConfigsRef` / `tmuxWindowListsRef` | tmux controller 派生 |
| **tmux retry banner** | `setTmuxControllerError` / `rememberTmuxControllerConfig` / `forgetTmuxControllerConfig` / `rememberTmuxWindowList` / `upsertTmuxWindowListEntry` / `removeTmuxWindowListEntry` / `renameTmuxWindowListEntry` | 7 个 mutator |

注：tmux retry banner 状态其实**逻辑上属于 `TmuxModel`**（Phase 4 才补），本文临时保留在 SessionModel，等 Phase 4 拆出去。

### 3.2 Phase 3 之后

```
┌────────────────────────────────────────────────────────────┐
│ model/session/model.ts::sessionModel                       │
│   (active object — 持有 Session[]、建立中集合、订阅事件总线)  │
└─────────────────┬───────────────────────────┬──────────────┘
                  │ writes through             │ emits
        ┌─────────▼──────────┐         ┌─────────▼────────────┐
        │ service/session/  │         │ sessionBridge.tsx    │
        │ store.ts (镜像)    │         │ 调用 sessionModel.*  │
        │ Zustand, 只读      │         │                      │
        └─────────┬─────────┘         └──────────────────────┘
                  │
                  ▼
            React 组件（useSessionStore 订阅）
```

**SessionModel 持有的内部状态**（不暴露给 React）：

```ts
class SessionModel {
  // ---- 内部状态 ----
  private state: SessionRegistryState;       // Session[] + establishing Set
  private listeners: Set<() => void>;         // subscribe() 注册表（Phase 5 use）
  private repo: SessionRepository;            // Phase 2 注入
  private bus: SessionEventBus;               // Phase 2 注入
  private disposers: Unsubscribe[];           // bus 订阅句柄，dispose() 时统一释放
}
```

**镜像 store 保留**（只读）：`useSessionStore` 的 `sessions` / `sessionsRef` / `establishingSessionsRef` / `tmuxControllerErrors` / `tmuxControllerConfigsRef` / `tmuxWindowListsRef` / `sessionLocalEchoOverrides` 等——**值仍来自 SessionModel 写入**。

**local-echo policy 单独保留为 Zustand-only 字段**（不变）：理由是这部分是用户 UI 设置，不是 session runtime state。Phase 3 不动它；Phase 5 再统一评估是否也搬到 model。

### 3.3 写镜像的两种实现选项

| 选项 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **A：保留 Zustand 镜像**（Phase 3 选这个）| SessionModel 的 mutator 内部调 `useSessionStore.setState({...})` | React 端零改动 | Zustand 仍存在，Phase 5 再删 |
| **B：直接 `useSyncExternalStore`** | SessionModel 暴露 `subscribe(listener)` + `getSnapshot()` | 删除 Zustand | 改全部 React hook（`useSessionStore(selector)` → `useSyncExternalStore(selector)`），改动面太大 |

Phase 3 选 A；Phase 5 议题。

---

## 4. Surface

### 4.1 工厂函数

```ts
// src/model/session/model.ts

export interface SessionModelDeps {
  /** Phase 2 已定义 */
  repo: SessionRepository;
  /** Phase 2 已定义；onClosed + onDisconnected 必订阅；onOutput 选订阅 */
  bus: SessionEventBus;
  /**
   * Cross-service fan-out: when a session closes, the workspace
   * pane tree needs to remove the matching leaf and collapse empty
   * splits. Phase 3 injects the workspace mutator here so the
   * SessionModel stays decoupled from `useWorkspaceStore`.
   * Phase 4 will inject a `WorkspaceModel` instead.
   */
  onSessionClosed?: (sessionId: number) => void;
}

export interface SessionModel {
  // ---- 查询（同步、纯内存）----
  list(): Session[];
  get(id: number): Session | undefined;
  getByConfigId(configId: string): Session | undefined;
  filterByType(type: SessionConnectionType): Session[];

  // ---- 命令（async；走 repository，再写本地状态）----
  /** Hydrate from backend: 调用 `repo.list()` 并替换整个 registry。 */
  hydrate(): Promise<void>;
  /** 创建 session。返回新建的 `Session`（前端 view-model）。 */
  create(input: SessionType, opts?: CreateOptions): Promise<Session>;
  /** 关闭 session：先调 `repo.close()`，再从 registry 移除。 */
  close(id: number): Promise<void>;
  /** 写 stdin（fire-and-forget；不 await）。 */
  write(id: number, data: Uint8Array): Promise<void>;
  /** 三种 resize（按 type 派发到对应 repo 方法）。 */
  resize(id: number, rows: number, cols: number): Promise<void>;

  // ---- mutation（纯内存；事件回流用）----
  markConnected(id: number, isConnected: boolean): void;
  setName(id: number, name: string): void;
  applyDisplayConfig(id: number, patch: Partial<SessionDisplayConfig>): void;

  // ---- 生命周期 ----
  beginEstablishing(id: number): void;
  endEstablishing(id: number): void;

  // ---- 订阅（Phase 5 use；Phase 3 暂不调用，但留口）----
  subscribe(listener: () => void): () => void;

  // ---- 清理 ----
  dispose(): void;
}

export function createSessionModel(deps: SessionModelDeps): SessionModel;
```

**为什么不导出单例 `sessionModel`**：与 `tauriSessionRepository` 不同，model 是有状态的。它必须在 `App.tsx` mount 时构造（订阅 EventBus），并在 unmount 时 `dispose()`。单例 + 树外全局会破坏 HMR + strict-mode 双 mount 的不变量。

工厂 + 树内构造：

```tsx
// src/model/session/index.ts 或 src/main.tsx
export const useSessionModel = (): SessionModel => {
  const modelRef = useRef<SessionModel | null>(null);
  if (modelRef.current === null) {
    modelRef.current = createSessionModel({
      repo: tauriSessionRepository,
      bus: tauriSessionEventBus,
      onSessionClosed: (sessionId) =>
        useWorkspaceStore.getState().setWorkspaces((prev) =>
          prev.map((w) => /* removeSessionAndCollapse */),
        ),
    });
  }
  useEffect(() => () => modelRef.current?.dispose(), []);
  return modelRef.current;
};
```

> 备注：bridge 已经持有 `useWorkspaceStore.setWorkspaces` 逻辑（`sessionBridge.tsx::session-closed`）。Phase 3 把这段逻辑迁移到 `onSessionClosed` 回调；bridge 不再调 `setWorkspaces`。

### 4.2 mutator 的实现骨架

```ts
// 节选：markConnected、show、close 的真实代码
class MockSessionModel {
  async create(input, opts) {
    const info = await this.repo.create(input);          // 1. 走 backend
    const session = buildFrontendSession(info, opts);   // 2. 用 sessionRules 转 view-model
    this.state.add(session);                              // 3. 写 model 内部
    mirrorStore.setState({ sessions: this.state.list() }); // 4. 写镜像
    this.notify();                                        // 5. Phase 5 use
    return session;
  }

  close(id) {
    await this.repo.close(id);
    this.state.remove(id);
    mirrorStore.setState({ sessions: this.state.list() });
    this.notify();
  }

  // 事件回流：model 构造时挂一次，dispose 时摘掉
  constructor() {
    this.disposers.push(this.bus.onClosed((id) => {
      this.state.remove(id);
      mirrorStore.setState({ sessions: ... });
      this.deps.onSessionClosed?.(id);
      this.notify();
    }));
    this.disposers.push(this.bus.onDisconnected((id) => {
      this.markConnected(id, false);  // 复用 mutator
    }));
  }

  dispose() {
    this.disposers.forEach((u) => u());
    this.disposers = [];
  }
}
```

`onOutput` **不订阅**——理由：output 是高频字节流，应由 `service/hooks/useTauriTerminalOutput.ts`（per-Pane 挂一次）直接订阅，而不是经过 model。Model 只关心"session 是否还在"+"session 状态何时变"。

### 4.3 React 订阅模式（不变）

```tsx
// 现状（Phase 3 不变）：
const sessions = useSessionStore((s) => s.sessions);
const markConnected = useSessionStore((s) => s.markSessionConnected);
// ↑ 都是从镜像 store 读，sessionModel 负责写入镜像
```

唯一的变化：**写入路径**从 `useSessionStore.getState().markSessionConnected(...)` → `sessionModel.markConnected(...)`。

---

## 5. 订阅（model ↔ EventBus）

| 通道 | Phase 3 订阅？ | 理由 |
|---|---|---|
| `onOutput` | ❌ | 高频字节流，由 `useTauriTerminalOutput` hook per-Pane 直接订阅；model 不关心 |
| `onClosed` | ✅ | `SessionModel.close()` 同语义 + cross-service 扇出 |
| `onDisconnected` | ✅ | 复用 `markConnected(id, false)` |

**为什么 onOutput 不进 model**：xterm.js 渲染需要 frame-by-frame 顺序保证；如果 model 拦截 + 再 fan 给 hook，会引入一个不必要的中转。保持现状。

---

## 6. Cross-service coordination

session-close 时需要：
1. 从 `Session[]` 移除该 session（`SessionModel` 内部）
2. 在所有 workspace 的 pane tree 中移除绑定该 sessionId 的 leaf（`WorkspaceModel` 域）
3. tmux 场景还要清理 `tmuxControllerConfigsRef` / `tmuxWindowListsRef`（`TmuxModel` 域）

Phase 3 的妥协：把第 2 步通过 `onSessionClosed` 回调参数化；model 不直接 import `useWorkspaceStore`。这是显式的依赖注入，避免循环依赖。

Phase 4 引入 `WorkspaceModel` 后：

```ts
createSessionModel({
  repo: tauriSessionRepository,
  bus: tauriSessionEventBus,
  workspaceModel,  // 替代 onSessionClosed 回调
});
```

> ⚠️ **风险点**：`onSessionClosed` 回调现在是 `(sessionId) => useWorkspaceStore.setWorkspaces(...)`，依赖 Zustand。Phase 4 之前这段代码不能提升依赖反转（违反 model ↔ infra 单向规则）。可接受的临时妥协，但 Phase 4 必须替换。

---

## 7. React 集成

### 7.1 Hook 形态

```ts
// src/model/session/useSessionModel.ts
export function useSessionModel(): SessionModel;
```

构造 + dispose 由 hook 负责：

```tsx
function AppRoot() {
  const sessionModel = useSessionModel();           // 构造 + 订阅 EventBus
  useEffect(() => sessionModel.hydrate(), []);      // 启动时一次
  return <SessionContext.Provider value={sessionModel}>{children}</SessionContext.Provider>;
}
```

### 7.2 现有 hook 兼容矩阵

| 现有 hook | Phase 3 是否改 | 备注 |
|---|---|---|
| `useSessionActions()` | ❌ 不改 | 仍返回 `sessions` + 几个 setSession 工具（setGlobalLocalEcho 等纯 UI 配置） |
| `useSessionStore(s => ...)` 选择器 | ❌ 不改 | 全部从镜像 store 读，sessionModel 负责写 |
| `service/bridges/sessionBridge.tsx` | ✏️ 改 | 不再调 `useSessionStore.getState()`；调 `sessionModel.*` |
| `app/useCases/createTmuxSession.ts` 等 | ❌ 暂不改 | Phase 4 议题；本文 §10.1 |
| 旧 `useSessionActions`（legacy） | ❌ 不改 | Commit 6 才删 |

### 7.3 写入路径的所有入口

Phase 3 完成后，**所有 session 状态写入**都从这两条路径之一进入：

```
┌─────────────────────────────────────────┐
│ Bridge: sessionBridge.tsx               │──→ sessionModel.markConnected
│ Bridge: tmuxBridge (Phase 4)            │──→ sessionModel.applyDisplayConfig
│ Bridge: tmuxControllerExit → retry banner│──→ sessionModel 持有 (Phase 3)
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Use case: createTmuxSession (Phase 4)   │──→ sessionModel.create / .hydrate
│ Use case: closeSession (Phase 4)        │──→ sessionModel.close
│ Use case: renameSession (Phase 4)       │──→ sessionModel.setName
│ Use case: applyDisplayConfig (Phase 4)  │──→ sessionModel.applyDisplayConfig
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Event: onClosed (bus)                   │──→ sessionModel 内置 listener
│ Event: onDisconnected (bus)             │──→ sessionModel 内置 listener
└─────────────────────────────────────────┘
```

Phase 3 只落地**第一条**（bridge），其他两条留给 Phase 4 / Phase 5。

---

## 8. 迁移计划（PR 切片）

| 阶段 | 内容 | 风险 | 可回滚 |
|---|---|---|---|
| **3a. SessionModel 骨架 + 单元测试** | 新增 `src/model/session/model.ts` + `src/model/session/useSessionModel.ts`。30+ vitest 单元测试覆盖 list / get / create / close / markConnected / setName / applyDisplayConfig + 事件回流（fake repo + fake bus）。**不动任何现有文件**。 | 🟢 低 | 完全可回滚（新文件） |
| **3b. bridge 切换** | `sessionBridge.tsx` 改调 `sessionModel.*`，bridge 内部的 `useWorkspaceStore.setWorkspaces` 段迁到 `onSessionClosed` 回调参数。 | 🟡 中（事件回流路径变） | 保留 Z4Y store actions 作为备用 |
| **3c. App.tsx 挂载 + 启动 hydrate** | `App.tsx` 顶层 `useSessionModel()`，启动时 `hydrate()`。把现有的 `useEffect` 一次性 session-list 加载替换为 `hydrate()`。 | 🟡 中 | hydrate 失败回退到旧路径 |
| **3d. （可选）use case 试点** | 把 `app/useCases/applyDisplayConfigToLiveSession.ts` 改成调 `sessionModel.applyDisplayConfig()`，验证 use case 路径。**只在 1 个 use case 上做**，其他 7 个留给 Phase 4。 | 🟡 中 | 1 个 use case，影响面有限 |

PR 3a 完成后**不需要 merge 顺序**；3b 必须在 3a 后；3c 在 3b 后；3d 可选。

每个 PR 必须满足：
- ✅ Type-check / lint / format / 现有 429 测试零回归
- ✅ 新增 ≥ 5 个单元测试
- ✅ Bridge → model 路径有集成测试（fake repo + 真实 zustand 镜像）

---

## 9. 测试策略

### 9.1 单元测试（Vitest，fake repo + fake bus）

```ts
// src/model/session/model.test.ts
import { createSessionModel } from "./model";

const fakeRepo: SessionRepository = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 1, ... }),
  close: vi.fn().mockResolvedValue(undefined),
  // ...
};

const fakeBus: SessionEventBus = {
  onOutput: vi.fn().mockReturnValue(() => {}),
  onClosed: vi.fn().mockReturnValue(() => {}),
  onDisconnected: vi.fn().mockReturnValue(() => {}),
};

it("create() persists session to registry after repo.create() resolves", async () => {
  const m = createSessionModel({ repo: fakeRepo, bus: fakeBus });
  const s = await m.create({ type: "local", config: {} });
  expect(s.id).toBe(1);
  expect(m.list()).toHaveLength(1);
});

it("onClosed listener removes session and fires onSessionClosed callback", () => {
  const onClose = vi.fn();
  const m = createSessionModel({ repo: fakeRepo, bus: fakeBus, onSessionClosed: onClose });
  // 模拟 Tauri 事件流入：
  const handler = (fakeBus.onClosed as Mock).mock.calls[0][0];
  handler(1);
  expect(m.list()).toHaveLength(0);
  expect(onClose).toHaveBeenCalledWith(1);
});

it("dispose() unsubscribes all bus listeners", () => {
  const m = createSessionModel({ repo: fakeRepo, bus: fakeBus });
  m.dispose();
  // 二次 dispose 不报错
  expect(() => m.dispose()).not.toThrow();
});
```

### 9.2 集成测试（bridge + 镜像 store）

```ts
// src/model/session/integration.test.ts
// 真实 useSessionStore（zukand 镜像），fake repo，fake bus
// 验证：sessionBridge 订阅 → sessionModel 写入 → 镜像 store 更新 → React 订阅触发
```

### 9.3 现有回归

- `src/service/session/store.test.ts`（5 个测试）—— 不能改。
- `src/service/bridges/sessionBridge.test.tsx`（4 个测试）—— 可能需要更新断言（写路径变了）。
- 全套 429 测试。

---

## 10. 风险与未决问题

### 10.1 Phase 4 衔接

Phase 3 的 `SessionModel` 设计必须让 Phase 4 的 `TmuxModel` / `WorkspaceModel` / `PersistenceModel` 直接对照实现，无需改 Phase 3 的 surface。具体的衔接点：

- **`tmuxControllerErrors` / `tmuxControllerConfigsRef` / `tmuxWindowListsRef`** —— Phase 3 临时挂在 SessionModel（通过 `bus.onControllerExit` + `bus.onAutoAttachOutcome` 订阅），Phase 4 迁到 `TmuxModel`。
- **`onSessionClosed` 回调** —— Phase 3 注入 Zustand 直接 mutator；Phase 4 替换为 `WorkspaceModel` 引用。
- **`useSessionActions().applyDisplayConfig` / `setName` / `markConnected`** —— Phase 3 不动 store actions；Phase 4 把 actions 改成 thin wrapper 转调 `sessionModel.*`。

### 10.2 React strict-mode 双 mount

构造 + dispose 的对称必须在 strict-mode 下幂等。`useSessionModel` 用 `useRef` 缓存 model，`useEffect` cleanup 调 `dispose()`；React 18 strict-mode 会 mount→unmount→mount，模型会在第二次 mount 时被 dispose 一次再构造一次。如果 model 构造时注册的事件订阅在 dispose 时被清掉，第二次构造后能干净恢复。这是 Phase 3 测试矩阵必须覆盖的场景。

### 10.3 Zustand 镜像的"被遗忘的写入"

任何绕过 `sessionModel.*` 直接调 `useSessionStore.setX` 的代码会让镜像与 model 内部状态漂移。Phase 3 靠"grep 检查"防回归：

```bash
# Phase 3 PR 落地后必须保持 0 命中（除 PR 自身）：
grep -rn 'useSessionStore.getState()' src/ --include='*.ts' --include='*.tsx'
```

允许的合法使用：`src/model/session/useSessionModel.ts`（构造 hook 内访问）、`src/service/bridges/sessionBridge.tsx` 暂时仍读取 ref（Phase 3b 删）。

### 10.4 已知不做的清单（避免 scope creep）

- ❌ 不写 `TmuxModel` / `WorkspaceModel` / `PersistenceModel` —— Phase 4
- ❌ 不重写 `useSessionActions` —— Phase 4 / 6
- ❌ 不删 `service/legacy/*` —— Commit 6
- ❌ 不替换 Zustand —— Phase 5

---

## 11. References

- **上游**：
  - Phase 1 commit `dd88673 refactor(model): split types into per-domain subdirs`
  - Phase 2 commit `3db0fdf feat(model): add Repository / EventBus contracts + tauri impls`
- **横向**：
  - [`doc/dev/roadmap/ts-app-service-interface.md`](./ts-app-service-interface.md) — app/service 接口契约主表（S-001..S-010 + W-* + P-*）
  - [`doc/dev/architecture/03-development-view.md`](../architecture/03-development-view.md) §2 — 前端依赖方向
  - [`doc/dev/architecture/01-logical-view.md`](../architecture/01-logical-view.md) §2 — UI 树层级 + Session 概念
- **现状代码**：
  - `src/service/session/store.ts` — 现有 Zustand store（Phase 3 后退化为镜像）
  - `src/service/bridges/sessionBridge.tsx` — 现有事件桥（Phase 3 改写）
  - `src/app/useCases/createTmuxSession.ts` — 典型 use case（Phase 4 议题）
  - `src/model/session/repository.ts` — Phase 2 注入接口
  - `src/model/session/events.ts` — Phase 2 事件总线接口
- **后续 ADR 候选**：本文如果拍板，可升为 `doc/dev/adr/0010-session-model-design.md`（State: Accepted），取代 Phase 3 的 `ts-app-service-interface.md` §3.2.1 中的"实现状态：⚠️ 直写"列。

---

签字：

- [ ] dev
- [ ] tm
- [ ] pdm