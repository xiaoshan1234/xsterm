# Module · ui-kit — 对下依赖接口

> **位置（目标态）**：`src/ui/ui-kit/`
>
> 本文档描述 ui-kit module **调用的下层接口**。

## 1. 依赖图

```
ui/ui-kit/
├── dialogs/  ──►  primitives/           (内部子依赖，L3→L4 合规)
│             ──►  ui/icons/             (Icon)
│             ──►  app/rules/textTransform
│             ──►  service/legacy/contexts/session/constants  (架构债)
│             ──►  model/                (SessionConfig / Group / Workspace 等)
│
├── primitives/ ──►  (无下层依赖，最底层)
│
└── settings/   ──►  dialogs/form-atoms/  (内部子依赖，复用 FormXxxField)
                ──►  service/persistence/  (读取 + 写入设置)
                ──►  service/theme/        (主题切换联动)
                ──►  service/logger/       (日志配置)
                ──►  model/                (Settings 类型)
```

**调用统计（基于现状 grep）**：
- `primitives` × 4（dialogs 调）
- `icons` × 1
- `app/rules/textTransform` × 1
- `service/legacy/contexts/session/constants` × 1（**架构债**）
- `model` × 1
- `app/modules/*` × 0（✅ 干净：ui-kit 不调 useCase，只通过 onSubmit 回调）

## 2. 内部依赖（ui-kit 子目录之间）

ui-kit 内部单向依赖：

```
primitives/  ◄───  dialogs/  ◄───  settings/  (复用 form-atoms)
                ▲
                └────────  settings/  (直接复用 primitives)
```

**禁止**：

- `primitives/` → `dialogs/` 或 `settings/`（primitives 无业务概念）
- `dialogs/` → `settings/`（dialogs 不感知 settings）

## 3. ui/icons/

| 调用 | 用途 |
|---|---|
| `Icon` | dialog 标题栏、按钮、关闭图标 |

## 4. app/rules/textTransform

`textTransform.ts` 提供 ANSI 解析、tab 转换等纯函数 helper，被 `pasteConfirm.ts` 调用做"粘贴内容预处理"。

## 5. service/legacy/contexts/session/constants（**架构债**）

当前 dialogs import 的常量：

```typescript
import { DEFAULT_TAB_SIZE, MAX_PASTE_LENGTH } from "../../service/legacy/contexts/session/constants";
```

这些常量是数据约束（"粘贴超过 1000 字符要确认"），应在 `model/session/types.ts` 或新建 `model/constants.ts`——它们是数据约束不是 UI 状态。改造 PR 应迁到 model 层。

## 6. settings/ 额外依赖

settings 不只是 dialogs 的复用，它**真的**需要读写 service：

| 调用 | 用途 |
|---|---|
| `service/persistence/store` | 读 / 写用户设置 |
| `service/theme/store` | 主题切换 |
| `service/logger/config` | 日志级别 / 文件大小 |

**注意**：settings 的写操作通过 `SettingsView` 集中完成，5 个 tab 只调 `onChange` 冒泡。tab 自己**不**直接写 store。

## 7. model/ — 类型

| 调用 | 来源 |
|---|---|
| `SessionConfig`、`LocalSessionConfig`、`SSHSessionConfig`、`TmuxCcConfig` | dialogs 表单值类型 |
| `Group`、`Workspace`、`PersistedWorkspace` | dialogs 持久化结构 |
| `Session`、`SessionStatus`、`SessionKind` | dialogs 列表项展示 |
| `Settings`、`SettingsCategory` | settings 视图类型 |
| `Theme` | settings/theme 联动 |

## 8. 当前架构债

| 现状 | 问题 | 改造方向 |
|---|---|---|
| `service/legacy/contexts/session/constants` | 常量散落在 legacy 路径 | 迁到 `model/constants.ts` |
| `pasteConfirm.ts` 内联"是否启用 paste 确认"判断 | 应由 settings 控制 | dialog 接收 `pasteWarnThreshold` prop |
| dialogs/ 平铺 31 文件 | 文件多靠命名区分 | 按业务域拆 dialogs/{session,group,workspace,paste,form-atoms}/ 子目录 |
| dialogs/、primitives/、settings/ 三处散落 | 跨目录协调成本 | 改造 PR 收编到 ui-kit/ |
| `useDialogOpenState` 未实现 | 每个调用方都写 useState | 新增 hook 统一 |

**可机械校验**：

```bash
# ui-kit 不允许写 store
grep -rn 'use.*Store.getState().set\|use.*Store.setState' src/ui/ui-kit/ --include='*.tsx' --include='*.ts'
# 必须为空（除 settings/SettingsView 集中处理）

# ui-kit 不允许直接调 useCase
grep -rn 'from\s*"[./]*app/modules' src/ui/ui-kit/ --include='*.tsx' --include='*.ts'
# 必须为空

# ui-kit 不允许直接 import service legacy
grep -rn 'service/legacy' src/ui/ui-kit/ --include='*.tsx' --include='*.ts'
# 必须为空（迁移完成后）
```

## 9. 不允许的依赖

- ❌ `ui/ui-kit/` → `ui/terminal/` 或 `ui/sidebar/` 或 `ui/layout/` 或 `ui/hooks/` 或 `ui/tmux/`（ui-kit 不感知其他 L2）
- ❌ `ui/ui-kit/` → `infra/`（任何路径）
- ❌ `ui/ui-kit/primitives/` → `ui/ui-kit/dialogs/` 或 `ui/ui-kit/settings/`
- ❌ `ui/ui-kit/dialogs/` → `ui/ui-kit/settings/`
- ❌ `ui/ui-kit/` 写 store setter（除 SettingsView 集中点）

## 10. 依赖变更流程

当下层接口变更时：

1. **primitives 组件 props 变更**——同步更新所有引用该 primitive 的 dialog / settings
2. **model 类型变更**——同步更新所有 dialog form type + settings tab type
3. **新增 form 原子**——加到 `INTERFACE.md` §1.2
4. **新增 dialog**——加到 `RESPONSIBILITY.md` §7 + `INTERFACE.md` §2
5. **新增 settings tab**——加到 `RESPONSIBILITY.md` §7.3 + `INTERFACE.md` §1.3
