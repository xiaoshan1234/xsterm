# Module · Settings — 职责

> **位置**：`src/ui/modules/settings/`
> **用户认知里的位置**：「设置」——独立的设置抽屉 / 页面
> **依赖**：service/settings（持久化）；shell 提供 UI 原子
> **影响**：所有 module（settings 是横切关注点）

## 1. 这个 module 负责什么

settings 是 xsterm 的**横切配置模块**。它承担 3 个产品功能：

1. **设置展示**——5 个分类（外观 / 输入 / session 默认值 / 终端 / 日志）的设置面板
2. **设置持久化**——通过 service/settings 读写持久化 store
3. **设置广播**——所有 module 通过 `useSettingsApi()` 订阅变化，实现"改设置 → 全 app 即时生效"

## 2. 这个 module **不**负责什么

- **不渲染 app 其他部分**——只管设置抽屉内部
- **不实现具体功能**——terminal 的 font 渲染归 terminal，theme 应用归 theme 服务
- **不管理 session / workspace**——settings 只影响它们的默认值，不管理它们的运行时状态

## 3. 子结构

```
modules/settings/
├── api.ts                            # 对外暴露 <SettingsDrawer> + useSettingsApi()
├── view/
│   ├── SettingsDrawer.tsx            # 抽屉容器（shell 嵌入）
│   ├── SettingsCategoryNav.tsx       # 左侧分类导航
│   ├── AppearanceTab.tsx             # 外观设置（dark/light theme、UI scale）
│   ├── InputTab.tsx                  # 输入设置（keymap、scrollback、paste warn threshold）
│   ├── SessionTab.tsx                # session 默认值（默认 shell、默认 ssh 用户、默认 tmux session 名）
│   ├── TerminalTab.tsx               # 终端设置（font family、font size、terminal theme）
│   └── LoggingTab.tsx                # 日志设置（log level、log file size、log retention）
├── store.ts                          # settings store（订阅 + mutation）
├── model.ts                          # Settings / SettingsCategory 类型
├── index.ts
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望点工具栏"⚙"打开设置抽屉 → shell 触发 `useAppShell().openDialog({ kind: "settings" })`
- **作为用户**，我希望改 font size 立即生效 → settings 触发 store 变更，terminal 通过 `useSettingsApi()` 订阅
- **作为用户**，我希望设置被持久化，下次打开恢复 → `useSettingsApi().saveSettings()` 调 service/persistence

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `shell` | shell 提供 `<SettingsDrawer>` 的容器（抽屉槽位）；settings 通过 `useAppShell()` 控制显示 |
| `workspace` | workspace 通过 `useSettingsApi()` 订阅 sidebar 宽度等 |
| `terminal` | terminal 通过 props 接收 font size 等（**不**直接调 `useSettingsApi()`——见 §7 设计意图） |
| `session` | session 通过 `service/settings` 读默认配置（不直接调 settings module） |

settings 是**横切 module**——它通过 service/settings 影响所有 module，但**不**直接 import 其他 feature module。

## 6. 这个 module 的"产品语言"术语

- **settings** — 应用配置
- **settings category** — 设置分类（appearance / input / session / terminal / logging）
- **settings drawer** — 设置的 UI 容器（侧滑抽屉）
- **default value** — 新建 session / window 时的默认值
- **broadcast** — 设置变更后所有订阅者即时收到通知
