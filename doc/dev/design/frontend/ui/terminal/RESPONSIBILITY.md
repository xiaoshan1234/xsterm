# Module · Terminal — 职责

> **位置**：`src/ui/modules/terminal/`
> **用户认知里的位置**：「打字的地方」——xterm 终端、pane 分屏、tmux 控制
> **核心依赖**：`session` module（终端渲染需要 session 数据）
> **不依赖**：`workspace`（不感知 tab）、`shell` 内部组件（除初始化）

## 1. 这个 module 负责什么

terminal module 是 xsterm 的**核心渲染模块**，负责把"一个 session 实例"变成"用户能打字的终端界面"。它承担 3 个产品功能：

1. **xterm 终端渲染**——每个 session 对应一个 xterm 实例，绑定 backend PTY 输出流
2. **pane 分屏布局**——支持任意嵌套的 horizontal/vertical split，用户可拖拽 resize
3. **tmux -CC 控制**——tmux session 时挂载 tmux 专属视图（control window、window 列表）

## 2. 这个 module **不**负责什么

- **不创建 session**——session 创建归 `session` module，terminal 只接收已存在的 session
- **不管理 window tab**——tab 切换归 `workspace` module（用户在 workspace 视角下切换 window）
- **不管理侧栏**——侧栏归 `workspace` module
- **不管理设置**——terminal 偏好（字体、字号）通过 `settings` module 的 props 注入
- **不渲染 app shell**——标题栏、布局归 `shell` module

## 3. 子结构

```
modules/terminal/
├── api.ts                            # 唯一对外入口（详见 INTERFACE.md）
├── view/                             # 本 module 内部 React 组件
│   ├── Terminal.tsx                  # 单 session 渲染入口
│   ├── Pane.tsx                      # 单个 pane 节点
│   ├── PaneTree.tsx                  # pane 树遍历与 split 布局
│   ├── ResizeHandle.tsx              # pane 边界拖拽
│   ├── SplitPane.tsx                 # 创建/切换 split
│   ├── TmuxControl.tsx               # tmux session 的 control window 视图
│   └── TmuxWindowsList.tsx           # tmux session 的 window 列表
├── store.ts                          # xterm 实例管理（key 是 sessionId）
├── model.ts                          # PaneNode / SplitDirection 类型 + 派生
├── index.ts                          # barrel：只 re-export from api.ts
└── *.test.ts
```

## 4. 用户故事（从用户视角描述 module 边界）

- **作为用户**，我希望点击"新建 pane"能把当前 pane 拆成两个 → 这是 `SplitPane.tsx` 的职责
- **作为用户**，我希望拖拽 pane 边界能调整大小 → `ResizeHandle.tsx`
- **作为用户**，我希望 tmux session 看见专属的 control window → `TmuxControl.tsx`
- **作为用户**，我希望 terminal 在切换 session 时不丢失滚动历史 → `store.ts` 持有 xterm 实例

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `shell` | shell 调用 terminal 的 `<App>` 入口，terminal 不知道 shell 的存在 |
| `workspace` | workspace 通过 `terminal/api.ts` 拿到 `<TerminalPane>` 组件，渲染在自己的 window tab 区域。**terminal 不感知 workspace** |
| `session` | terminal 订阅 session store 拿到 session 元数据（kind / display config）。**terminal 强依赖 session** |
| `settings` | terminal 通过 props 接收 `terminalFont`、`terminalFontSize`、`terminalTheme` 等设置。terminal 自己不读 settings store |

## 6. 这个 module 的"产品语言"术语

- **pane** — 一个独立的终端显示区域
- **split** — 两个 pane 之间的水平/垂直分割
- **pane tree** — 嵌套 split 形成的树状结构
- **resize** — 用户拖拽改变相邻 pane 的相对大小
- **tmux control** — tmux -CC 模式下额外的 UI 控件（不是普通 xterm）

术语在 module 内部一致；跨 module 通信时把这些术语翻译成 session/workspace 通用词汇。
