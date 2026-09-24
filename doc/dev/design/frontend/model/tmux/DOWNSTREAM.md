# Model · Tmux — 对下依赖接口

> **位置**：`src/model/tmux/`

## 1. 依赖图

```
model/tmux/
├── types.ts        ──►  (无)
├── repository.ts   ──►  ./types
├── events.ts       ──►  ./types
├── accessor.ts     ──►  ./types
├── rules.ts        ──►  ./types
└── *.test.ts
```

**model/tmux 不依赖 common 也不依赖其他 model domain**——tmux 自己的数据结构完整。

## 2. 不允许的依赖

- ❌ `model/tmux/` → `app/` `ui/` `service/` `infra/`
- ❌ `model/tmux/` → `@tauri-apps/api` 或 `react`
- ❌ `model/tmux/` → 其他 model domain

## 3. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/tmux/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(session\|workspace\|settings\|common\)' src/model/tmux/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"@tauri-apps\|from\s*"react"' src/model/tmux/ --include='*.ts'
# 必须为空
```

## 4. 跟 backend tmux 协议的镜像关系

tmux model 类型**严格对应** backend `src-tauri/src/services/tmux_session/protocol/events.rs` 的 ProtocolEvent enum。

每次 backend 新增事件类型，frontend 必须同步：

1. `src-tauri/src/services/tmux_session/protocol/events.rs` 新增 Variant
2. backend emit 新事件
3. `model/tmux/types.ts` 新增对应事件类型
4. `model/tmux/events.ts` 新增事件名常量
5. `model/tmux/rules.ts` 新增 apply 函数
6. `service/tmux/bridge.ts` 订阅新事件 + apply
7. `service/tmux/store.ts` schema 支持新事件
8. `model/tmux/rules.test.ts` 新增测试

**这条链路很关键**——tmux model 是 backend 协议的 frontend 镜像。

## 5. tmux pane 跟 xsterm pane 的类型隔离

```typescript
// model/tmux/types.ts
export interface TmuxPane {
  id: string;
  windowId: string;
  index: number;
  active: boolean;
  width: number;
  height: number;
}

// model/workspace/types.ts
export type PaneNode =
  | { kind: "leaf"; id: string; size: number; binding?: PaneBinding }
  | { kind: "split"; id: string; size: number; layout: { ... } };
```

**两者完全独立**——tmux pane 是 backend 镜像，xsterm pane 是 frontend 概念。

如果需要在 tmux pane 和 xsterm pane 之间建立关联，**在 service 层**（不归 model）：

```typescript
// service/session/store.ts（举例）
interface Session {
  ...
  tmuxPaneId?: string;   // 关联到 model/tmux 的 TmuxPane
  xstermPaneId?: string; // 关联到 model/workspace 的 PaneNode
}
```
