# Service · Terminal — 职责

> **位置**：`src/service/terminal/`
> **类型**：派生数据 domain（xterm 实例是 React 生命周期内的派生状态）
> **被订阅方**：ui/terminal

## 1. 这个 domain 负责什么

terminal service 持有 **xterm 实例 + 渲染状态**——xterm.js 是 React 组件内的 ref，不进 zustand store，但跨多个组件（terminal + resize handle）需要共享访问。

承担 3 类职责：

1. **xterm 实例注册表**——`Map<sessionId, Terminal>`，让 resize / theme 切换能找到实例
2. **cols/rows 状态**——每个 session 的当前终端尺寸
3. **terminal 偏好应用**——font / fontSize / theme 切换时应用到所有 xterm 实例

## 2. 这个 domain **不**负责什么

- **不持有 xterm 实例的所有权**——xterm 实例由 ui/terminal 用 useRef 创建，**注册**到 terminal service，**不**由 service 创建
- **不渲染 xterm**——UI 渲染
- **不存 session 元数据**——归 `service/session`
- **不持久化**——terminal 实例是 React 生命周期内的

## 3. 子结构

```
service/terminal/
├── api.ts                ⭐ useTerminalService hook（注册/查找/更新 xterm）
├── registry.ts           Map<sessionId, TerminalInstance>
├── preferences.ts        fontFamily / fontSize / theme 应用到所有实例
└── *.test.ts
```

**关键设计**：

- xterm 实例**不存**在 zustand store——zustand 不能存非序列化对象
- 用普通 `Map<>` 做注册表，hook 暴露查找方法
- 偏好应用通过遍历注册表实现

## 4. 用户故事

- **作为用户**，我希望拖拽 pane 边界时 terminal 跟着 resize → service.findInstance(sessionId).fit()
- **作为用户**，我希望改 font size 后 terminal 立即生效 → service.applyPreferences({ fontSize }) 遍历所有实例
- **作为用户**，我希望切换 theme 后 terminal 配色变 → service.applyTheme(themeId) 调用每个实例的 xterm.options.theme

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/session` | 注册 xterm 时**需要** sessionId——但通过参数传入，不读 session store |
| `service/settings` | settings 变化时调 terminal.applyPreferences |
| `infra` | 不直接调——xterm 本身是 npm 包 |

## 6. 跟 app/ui 的关系

| module | 怎么用 service/terminal |
|---|---|
| app/terminal | `useTerminalService().applyPreferences(prefs)` (settings 触发) |
| ui/terminal | `useTerminalService().register(sessionId, termInstance)` 在 useEffect |

## 7. 这个 domain 的"产品语言"术语

- **terminal instance** — 一个 xterm.Terminal 对象
- **registry** — sessionId → instance 的查找表
- **preferences** — font / fontSize / theme / cursorBlink
