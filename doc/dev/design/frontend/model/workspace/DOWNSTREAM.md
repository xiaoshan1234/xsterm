# Model · Workspace — 对下依赖接口

> **位置**：`src/model/workspace/`

## 1. 依赖图

```
model/workspace/
├── types.ts              ──►  ./cross-cutting (SplitDirection 在 cross-cutting?)
├── repository.ts         ──►  ./types
├── events.ts             ──►  ./types
├── accessor.ts           ──►  ./types + ./cross-cutting/findPaneNode (内部)
├── rules/
│   ├── workspace.ts      ──►  ./types
│   ├── window.ts         ──►  ./types + ./cross-cutting/generateId
│   ├── group.ts          ──►  ./types + ./cross-cutting/generateId
│   └── paneTree.ts       ──►  ./types + ./cross-cutting/generateId
└── *.test.ts
```

**关键依赖**：workspace model 依赖 `model/cross-cutting` 的 `generateId`——pane / window / group 创建时需要 id。

## 2. model/cross-cutting

| 调用 | 来源 | 何时调 |
|---|---|---|
| `generateId()` | `model/cross-cutting/id` | createLeafPane / createSplitNode / createWindow / createGroup |

## 3. 不允许的依赖

- ❌ `model/workspace/` → `app/` `ui/` `service/` `infra/`
- ❌ `model/workspace/` → `@tauri-apps/api` 或 `react`
- ❌ `model/workspace/` → `model/session` / `model/tmux` / `model/settings`（**不跨 domain**）

## 4. 强制约束（可机械校验）

```bash
# workspace model 不能依赖 frontend 层
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/workspace/ --include='*.ts'
# 必须为空

# workspace model 不能依赖其他 model domain（除 cross-cutting）
grep -rn 'from\s*"\.\./\(session\|tmux\|settings\)' src/model/workspace/ --include='*.ts'
# 必须为空

# workspace model 可以依赖 cross-cutting
grep -rn 'from\s*"\.\./cross-cutting' src/model/workspace/ --include='*.ts'
# 应当出现（generateId 等）
```

## 5. paneTree 算法的依赖隔离

`model/workspace/rules/paneTree.ts` 应该是**纯函数**——不依赖 React、不依赖 store、不依赖 IPC。

```typescript
// model/workspace/rules/paneTree.ts
import { generateId } from "../../cross-cutting/id";
import type { PaneNode, SplitDirection } from "../types";

// 纯函数：输入 → 输出，不修改输入
export function splitPane(tree, paneId, direction, newSessionId, newConfigId): PaneNode { ... }
```

**测试优势**：

- 无需 mock
- 可单测
- 可在 React 组件外使用（pure pipe）

## 6. paneTree 算法跟 service/workspace 的协作

```typescript
// app/workspace/usecases/splitPane.ts
import { useWorkspaceService } from "@/service/workspace/api";
import { splitPane } from "@/model/workspace/rules/paneTree";

const workspace = useWorkspaceService();
const tree = workspace.getPaneTree(windowId);
const newTree = splitPane(tree, paneId, direction, newSessionId, newConfigId);   // ← 纯函数
workspace.applyPaneTreeMutation(windowId, newTree);   // ← 触发 store 更新
```

**关键**：算法在 model，状态修改在 service。**这条边界让 paneTree 算法可以独立单测**。

## 7. paneTree 算法的测试覆盖

```typescript
// model/workspace/rules/paneTree.test.ts
describe("splitPane", () => {
  it("splits a leaf into two leaves", () => { ... });
  it("splits a nested pane correctly", () => { ... });
  it("returns original tree if paneId not found", () => { ... });
});

describe("closePane", () => {
  it("removes a leaf and promotes sibling", () => { ... });
  it("returns original tree if paneId not found", () => { ... });
});

describe("resizePane", () => {
  it("adjusts ratio within parent split", () => { ... });
});

describe("replacePaneNode", () => {
  it("replaces a leaf", () => { ... });
  it("replaces a nested pane", () => { ... });
});
```

**测试覆盖必须 100%**——paneTree 是 xsterm 关键路径。
