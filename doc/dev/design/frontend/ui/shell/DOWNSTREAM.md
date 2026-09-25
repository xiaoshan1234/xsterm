# Module · Shell — 对下依赖接口

> **位置**：`src/ui/modules/shell/`
> shell 是顶层 module，依赖所有 feature module。

## 1. 依赖图

```
modules/shell/
├── api.ts    ────►  workspace/api.ts        (装 <WorkspaceApp>)
├── view/    ────►  workspace/api.ts        (Layout 主槽位)
├── view/    ────►  settings/api.ts         (SettingsDrawer 抽屉)
├── view/    ────►  session/api.ts          (CreateSessionDialog / SelectSavedDialog 通过 activeDialog 触发)
├── view/    ────►  terminal/api.ts         (不直接调；workspace 嵌入 terminal)
├── init.ts  ────►  workspace/api.ts        (loadLastWorkspace)
├── init.ts  ────►  settings/api.ts         (loadSettings)
├── init.ts  ────►  shared/persistence      (tauri-plugin-store)
└── primitives/  ──►  (无下层依赖，最纯的展示)
```

**禁止**：

- ❌ `modules/shell/` → `app/`（shell 是 UI 层，不调 useCase；useCase 由 feature module 调用）
- ❌ shell 内部的 primitives 被 feature module 直接 import（必须走 `api.ts`）

## 2. workspace module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<WorkspaceApp>` | `workspace/api.ts` | `<Layout>` 主槽位 |
| `useWorkspaceApi()` | `workspace/api.ts` | init.ts 调 `loadLastWorkspace()` |

## 3. settings module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<SettingsDrawer>` | `settings/api.ts` | `<Layout>` 抽屉槽位 |
| `useSettingsApi()` | `settings/api.ts` | init.ts 调 `loadSettings()` |

## 4. session module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<CreateSessionDialog>` | `session/api.ts` | 当 `activeDialog.kind === "createSession"` 时 |
| `<SelectSavedDialog>` | `session/api.ts` | 当 `activeDialog.kind === "selectSaved"` 时 |
| `<EditSessionDialog>` | `session/api.ts` | 当 `activeDialog.kind === "editSession"` 时 |
| `<ConfirmDialog>` | `session/api.ts` | 当 `activeDialog.kind === "confirm"` 时 |

**关键**：shell **不**直接持有 dialog 的 open 状态。dialog 的"什么时候显示"由 session module 注册到 shell 的 `dialogRegistry`，由 shell 统一编排（见 INTERFACE.md §3）。

## 5. 平级层（infra / service / model）

| 调用 | 来源 | 何时调 |
|---|---|---|
| 持久化加载 | `service/persistence/api` | init.ts 启动序列 |
| 主题加载 | `service/settings/api`（theme 是 Settings.theme 字段）| init.ts |
| `@tauri-apps/api/window` 的 `getCurrentWindow()` | `ui/shell` 内部（窗口控制是 shell 自身职责）| WindowControls |
| 全局 CSS / design-system tokens | `ui/styles/global.css`（main.tsx 引入）| main.tsx |

## 6. shell 的"特权"：直跳 infra

shell 是**唯一**允许直接 `import { getCurrentWindow } from "@tauri-apps/api/window"` 的 module。理由：窗口控制（min/max/close）是 OS 级操作，不在 useCase / service 编排范围。

**Tauri 能力依赖**（在 tauri.conf.json 中声明）：

```json
{
  "capabilities": {
    "shell:default": {},
    "core:default": {
      "permissions": ["window:allow-minimize", "window:allow-maximize", "window:allow-close"]
    }
  }
}
```

## 7. 设计意图：为什么 shell 拥有 primitives

`<Icon>` `<Button>` `<Dialog>` 等放在 shell module 内：

- **primitives 是"app shell 的实现细节"**——它们跟 design system 绑定，跟 app 视觉一致性绑定
- **抽到 ui-kit 增加协调成本**——加一个 `<Button>` 变体要 review 跨 module 影响
- **primitives 由 shell 拥有不违背"module 边界"**——其他 module 通过 `shell/api.ts` 拿原子，跟其他依赖走同一条路

如果未来 primitives 数量爆炸（>20 个），可以单独抽 `modules/ui-kit/`，那是**将来**的事。

## 8. 不允许的依赖

- ❌ `modules/shell/` → `infra/` 除 `getCurrentWindow` 以外的 API
- ❌ `modules/shell/view/*` 被 feature module 直接 import
- ❌ feature module 内部组件绕过 shell 直接 import（必须走 `shell/api.ts`）

## 10. 依赖变更流程

1. **workspace module api.ts 变化**——同步更新 §2
2. **新增 dialog 类型**——同步更新 INTERFACE.md §3 DialogDescriptor union
3. **新增 primitive**——同步更新 INTERFACE.md §2 + RESPONSIBILITY.md §3
4. **window control API 升级**（@tauri-apps/api 版本变化）——同步更新 §6
