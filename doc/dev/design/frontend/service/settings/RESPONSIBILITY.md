# Service · Settings — 职责

> **位置**：`src/service/settings/`
> **类型**：横切 domain
> **被订阅方**：app/settings、app/terminal、app/session、ui/workspace

## 1. 这个 domain 负责什么

settings service 持有**所有 settings 字段值**——xsterm 的应用配置。

承担 4 类职责：

1. **settings store**——所有字段（appearance / input / session / terminal / logging）
2. **持久化同步**——store 变化时调 persistence 写盘（debounced）
3. **订阅广播**——任意字段变化通知所有订阅者
4. **粒度订阅**——`useSetting(key)` 只在该 key 变化时 re-render

## 2. 这个 domain **不**负责什么

- **不实现字段语义**——theme 是 settings 的子集（`Settings.theme` 字段），log level 应用归 `infra/logger`
- **不渲染 UI**——UI 是 `ui/settings`
- **不存储实际值**——存储归 `service/persistence`，settings service 持有的是"运行时副本 + 同步逻辑"

## 3. 子结构

```
service/settings/
├── api.ts                ⭐ useSettingsService hook
├── store.ts              完整 settings 树
├── sync.ts               store ↔ persistence 双向同步（debounced）
├── defaults.ts           Settings 默认值
├── types.ts              （继承自 model/settings/types）
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望改 terminal font size 立即生效 → settings.set({ terminalFontSize }) → sync 写盘 → 订阅者 re-render
- **作为开发者**，我希望 settings store 字段类型安全 → useSetting<K extends keyof Settings>(key)
- **作为开发者**，我希望 settings 写盘 debounce → 避免每次 keystroke 写盘

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/persistence` | sync 调 persistence.set("settings", currentValue) |
| `infra/logger` | settings.logLevel 变化 → `infra/logger.setLevel()`（v4 logger 归 infra） |
| （已删除） `service/theme` | v4 已删除——theme 是 `Settings.theme` 字段，由 settings 自身广播 |
| （已删除） `service/terminal` | v4 已删除——terminal preferences 是 `Settings.terminalPreferences` 字段 |

**关键**：settings 是**横切 broadcast 入口**——其他横切关注点通过订阅 settings 自动响应；theme / terminal preferences 等"原 service domain"已删除并入 settings 字段。

## 6. 跟 app/ui 的关系

| module | 怎么用 service/settings |
|---|---|
| app/settings | `useSettingsService().set(patch)` 写；`.load()` 启动加载 |
| app/terminal | `useSettingsService().useSetting("terminalFontSize")` 读 |
| app/session | `useSettingsService().useSetting("defaultShell")` 读默认 |
| ui/workspace | `useSettingsService().useSetting("sidebarWidth")` 读布局 |
| ui/settings | `useSettingsService()` 显示当前值 + 修改 |

## 7. 这个 domain 的"产品语言"术语

- **settings** — 应用配置（5 个分类：appearance / input / session / terminal / logging）
- **field** — 单个设置字段
- **patch** — `Partial<Settings>`，用于更新多个字段
- **default value** — 启动时如果持久化失败用 defaults.ts 提供的值
