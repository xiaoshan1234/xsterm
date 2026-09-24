# Frontend · Service 层（v4 从零设计）

> **位置**：`src/service/`
> **关注点**：跨 module 共享的运行时状态 + IPC 桥
> **平级于**：app / ui / model / infra（5 个顶层目录之一）

## 1. 6 domain 划分

从零设计后 service 应当有 **6 个 domain**——既不追求最小（避免业务状态被分散到 ui / infra），也不追求过细（避免底层原语混入 service）：

```
src/service/
├── session/         跨 module 元数据（7 个 module 用）
├── workspace/       跨 module 树状态（5 个 module 用）
├── tmux/            backend tmux control mode 镜像（3 个 module 用）
├── settings/        应用配置（8 个 module 用）
├── persistence/     tauri-plugin-store 业务 wrapper（3 个 app module 用）
└── (已合并到其他位置 — 见下)
```

## 2. v4 重构的 3 个变化

从最初 9 domain 砍到 6 domain，关键调整：

| 调整 | 旧 v3/v4 位置 | 新位置 | 理由 |
|---|---|---|---|
| 删除 `theme` | `service/theme/` | `service/settings/` 内部字段 | theme 是 settings 的子集，不是独立状态 |
| 删除 `output` | `service/output/` | `ui/terminal/view/OutputBuffer.ts` | output 是 ui 渲染队列，不是跨 module 状态 |
| 删除 `terminal` | `service/terminal/` | `ui/terminal/view/TerminalRegistry.ts` | xterm 实例是 ui 实现细节 |
| 删除 `logger` | `service/logger/` | `infra/logger/` | logger 是底层原语，不是业务状态 |

详细归档说明见各目录的 `README.md`（已重写为归档格式）。

## 3. 6 domain 的依赖关系

```
session  ←  跨 7 个 module 订阅
workspace  ←  跨 5 个 module 订阅
tmux  ←  跨 3 个 module 订阅
settings  ←  跨 8 个 module 订阅（最广）
persistence  ←  app/settings、app/workspace、app/session 调用
```

**service 之间**：

- 唯一允许的 service 内部调用：`session → output`（在 ui/terminal 内部，不是 service）
- 其他 service 之间**不互相调**——通过 app 编排

## 4. service 的判断标准

不是所有"基础设施"都归 service。判断标准：

| 标准 | 归 service | 不归 service（归 ui 或 infra） |
|---|---|---|
| 跨 module 状态？ | ✅ 是 | ❌ 否（只跨 component） |
| 跨 React 树访问？ | ✅ 是 | ❌ 否（React Context 够用） |
| 持有持久状态？ | ✅ zustand store | ❌ 只是 API / buffer |
| 跨多个 module 订阅？ | ✅ 5+ 个 module | ❌ 1-2 个 module |

按这个标准：

| 候选 | 跨 module | 跨 React 树 | 持有状态 | 决定 |
|---|---|---|---|---|
| session | ✅ 7 | ✅ bridge | ✅ zustand | **service** |
| workspace | ✅ 5 | ✅ bridge | ✅ zustand | **service** |
| tmux | ✅ 3 | ✅ bridge | ✅ zustand | **service** |
| settings | ✅ 8 | ⚠️ 树内够用 | ✅ zustand | **service**（用 React Context 也行，但 service 更清晰） |
| persistence | ✅ 3 | ❌ 树内 | ❌ wrapper | **service**（业务 schema migration） |
| logger | ✅ 所有 | ❌ 树内 | ❌ ring buffer | **infra**（底层原语） |
| theme | ✅ 4 | ❌ 树内 | ❌ 镜像 | **删除**（并入 settings） |
| output | ❌ 1 | ❌ 树内 | ❌ buffer | **删除**（归 ui/terminal） |
| xterm 注册表 | ❌ 1 | ❌ 树内 | ❌ Map | **删除**（归 ui/terminal） |

## 5. 6 个 domain 索引

每个 domain 有 3 份文档：**职责 / 对外接口 / 对下依赖**

| domain | 职责 | 对外接口 | 对下依赖 |
|---|---|---|---|
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) |
| **tmux** | [RESPONSIBILITY](./tmux/RESPONSIBILITY.md) | [INTERFACE](./tmux/INTERFACE.md) | [DOWNSTREAM](./tmux/DOWNSTREAM.md) |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) |
| **persistence** | [RESPONSIBILITY](./persistence/RESPONSIBILITY.md) | [INTERFACE](./persistence/INTERFACE.md) | [DOWNSTREAM](./persistence/DOWNSTREAM.md) |

## 6. 已删除的 4 个 domain（归档）

| 原 domain | 归档说明 | 当前位置 |
|---|---|---|
| theme | [README](./theme/README.md) | 并入 `service/settings/` |
| output | [README](./output/README.md) | 归 `ui/terminal/view/OutputBuffer.ts` |
| terminal | [README](./terminal/README.md) | 归 `ui/terminal/view/TerminalRegistry.ts` |
| logger | [README](./logger/README.md) | 归 `infra/logger/` |

## 7. 每个 domain 的内部约定

```
service/<domain>/
├── api.ts            ⭐ 唯一对外入口（useXxxService hook）
├── store.ts          zustand store（或 ring buffer / Map 等）
├── bridge.ts         listen backend 事件 → store mutation
├── types.ts          domain 内部类型
└── *.test.ts
```

**强制规则**：

- `api.ts` 是**唯一对外入口**——其他 module 只 import 这个
- `store.ts` **不**对外暴露——只能通过 api.ts 的 hook 读写
- service 之间不互相调（除 session→output 的边缘 case）

## 8. 跟其他层的关系

```
app  ──►  service  (通过 service api.ts 编排业务)
ui   ──►  service  (通过 service api.ts 订阅状态)
model  ──►  (service 读 model 类型)
infra  ──►  service  (service 通过 infra 调 IPC)
```

**禁止**：

- ❌ `service/` → `app/` 或 `ui/` 或 `@tauri-apps/api` 直接
- ❌ `service/<domain>/` → `service/<other-domain>/api.ts`（除 session→output 边缘）
- ❌ `service/<domain>/` → `infra/` 直接（部分允许——bridge 可以 listen `infra/tauri/events/*`）

## 9. api.ts 的标准接口模板

每个 service domain 暴露的 hook 长这样：

```typescript
export interface XxxService {
  // 命令式（不发 re-render）
  list(): ReadonlyArray<Xxx>;
  get(id: KeyType): Xxx | undefined;

  // 响应式订阅
  useXxxs(): ReadonlyArray<Xxx>;
  useXxx(id: KeyType): Xxx | undefined;

  // mutation（业务无关）
  upsert(item: Xxx): void;
  remove(id: KeyType): void;

  // IPC 触发
  create(config: Config): Promise<KeyType>;
  close(id: KeyType): Promise<void>;

  // 事件订阅（语义化）
  onEvent(callback: (event: XxxEvent) => void): () => void;
}

export function useXxxService(): XxxService;
```

**关键设计**：

1. **响应式 vs 命令式分离**——bridge 用命令式，UI 用响应式
2. **mutation vs IPC 分离**——`upsert` 不调 IPC，`create` 调 IPC
3. **事件订阅语义化**——`onOutput(cb)` 而不是 `eventBus.on("xxx", ...)`

## 10. 强制约束（可机械校验）

```bash
# service 不能直跳 @tauri-apps/api（除 logger，归 infra）
grep -rn 'from\s*"@tauri-apps' src/service/ --include='*.ts'
# 必须为空

# service 不能依赖 app / ui
grep -rn 'from\s*"\.\./\(app\|ui\)' src/service/ --include='*.ts'
# 必须为空

# service/<domain>/ 之间不能互相调 api.ts（除 session→output）
grep -rn 'from\s*"\.\./[a-z]*/api' src/service/ --include='*.ts'
# 必须为空

# service/<domain>/api.ts 必须存在
for d in src/service/*/; do test -f "$d/api.ts" || echo "missing: $d"; done
# 6 个 domain 都应当存在
```

## 11. 设计系统约束

所有 UI 改动必读 [`../../design-system.md`](../../design-system.md)。

service 层不直接涉及 UI，但要注意 design-system 的 CSS variables（theme 通过 settings 影响 CSS）。

## 12. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 顶层目录结构 | `src/service/` 平铺 | 不变，但**按 6 domain 重构** |
| domain 数 | 9 个（包含过度切分）| 6 个（去掉 theme/output/terminal/logger）|
| theme 处理 | 独立 service | 并入 settings |
| output / xterm 注册表 | 独立 service | 归 ui/terminal 内部 |
| logger 处理 | 独立 service | 归 infra（底层原语）|
| 暴露接口 | `useXxxStore()` + `getState()` | 只 `useXxxService()` |
| legacy hooks | `src/service/legacy/hooks/` | 删除（迁到对应 domain 或删除）|
| bridges | `src/service/bridges/` | 散落到各 domain 的 bridge.ts |
