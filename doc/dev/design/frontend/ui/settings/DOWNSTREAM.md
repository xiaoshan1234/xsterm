# Module · Settings — 对下依赖接口

> **位置**：`src/ui/modules/settings/`
> settings 是横切 module，通过 service/settings 间接影响其他 module。

## 1. 依赖图

```
modules/settings/
├── api.ts    ────►  shell/api.ts            (<Drawer> 等原子)
├── view/    ────►  shell/api.ts            (<Dialog> <FormField> <Button>)
├── store.ts ────►  service/settings        (跨 module 持久化)
├── store.ts ────►  service/persistence     (tauri-plugin-store 包装)
├── model.ts ────►  model/settings/types    (Settings 类型)
└── *.test.ts
```

**禁止**：

- ❌ `modules/settings/` → `modules/workspace/` 或 `modules/session/` 或 `modules/terminal/`
- ❌ `modules/settings/` → `infra/` 任何路径
- ❌ `modules/settings/` → `app/`（UI 层）

## 2. shell module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<Drawer>` `<Dialog>` | `shell/api.ts` | `<SettingsDrawer>` 容器（如果 shell 提供 Drawer 原子） |
| `<FormField>` `<Button>` `<Select>` | `shell/api.ts` | 5 个 Tab 内部表单 |
| `useAppShell()` | `shell/api.ts` | 关闭抽屉时调 `closeSettings()` |

## 3. service/ 层

| 调用 | 来源 | 何时调 |
|---|---|---|
| settings store 订阅 + mutation | `service/settings/api` | store.ts 核心 |
| 持久化加载 | `service/persistence/api` | `useSettingsApi().load()` |
| 持久化保存 | `service/persistence/api` | `useSettingsApi().save()` |
| log level / log size 应用 | `infra/logger`（v4 logger 归 infra） | log level 变化时 |
| theme 应用 | `service/settings/api`（theme 是 Settings.theme 字段） | theme 变化时 |

**关键**：settings module **不**直接调 `infra/tauri`——必须经过 `service/settings` 适配器。`service/settings` 负责把 settings 字段应用到具体的下游（`infra/logger` 等）。

## 4. 平级层（infra / service / model）

| 调用 | 来源 |
|---|---|
| `Settings` 类型 | `model/settings/types` |
| `SettingsCategory` 枚举 | `model/settings/types` |

## 5. 设计意图：settings 独立 module 的代价和收益

**收益**：

- **设置有自己的产品功能**——它是用户认知里的独立模块（"设置"页面）
- **设置可以独立演进**——加新分类、新字段都在 module 内
- **5 个 Tab 物理内聚**——在同一目录，改一个 Tab 不会跨 module 影响

**代价**：

- **settings 必须通过 service 广播**——不能直接调其他 module
- **增加了 service/settings 层**——service 层多了一个适配器

权衡：值得，因为设置是"横切关注点"，需要 service 层抽象来避免 settings 模块变成"上帝 module"。

## 6. 不允许的依赖

- ❌ `modules/settings/` → 任何其他 feature module
- ❌ `modules/settings/` → `infra/` 任何路径
- ❌ `modules/settings/` → `app/`
- ❌ `modules/settings/view/*` 被其他 module 直接 import（必须走 `api.ts`）

## 7. 依赖变更流程

1. **service/settings 接口变化**——同步更新 §3 + INTERFACE.md §3 useSettingsApi
2. **新增 Settings 字段**——同步更新 INTERFACE.md §4 + 新 Tab 或现有 Tab 增加字段
3. **新增 SettingsCategory**——加 Tab 组件 + INTERFACE.md §4 union
4. **infra/logger 接口变化**——影响 settings 副作用，更新 §3