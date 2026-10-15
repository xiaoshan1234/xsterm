# xsterm — Frontend Architecture

> 详细规则见 [`../../doc/arch/ARCHITECTURE.md`](../../doc/arch/ARCHITECTURE.md) 和 [`../../doc/arch/LAYERS.md`](../../doc/arch/LAYERS.md)。本文件只讲 **目录结构** 和 **代码修改时该改哪里**。

## 目录对应 L 层

> M2 重整后,前端从 5 层压到 3 层。Rust 侧 L0/L1 保持。

| 目录                         | 层                                | 拥有                                                                                     | 依赖                 |
| ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- | -------------------- |
| `src/main.tsx`               | —                                 | 入口                                                                                     | L4 view              |
| `src/view/`                  | **L4 view**                       | React 视图层                                                                             | L2 data / L3 adapter |
| `src/view/App.{tsx,css}`     | L6 composition root               | —                                                                                        | —                    |
| `src/view/layout/`           | L4 布局 chrome                    | TabBar / SplitContainer                                                                  | 同 L4                |
| `src/view/components/`       | L4 叶子 chrome                    | PaneChrome / PaneInitCard                                                                | 同 L4                |
| `src/view/hooks/`            | L4 React hooks                    | usePaneTree / useTerminalSession / paneTreeContext / PaneTreeProvider                    | 同 L4                |
| `src/view/styles/tokens.css` | L8 design tokens(M2 提前落地子集) | —                                                                                        | —                    |
| `src/adapter/xterm/`         | **L3 adapter**                    | xterm.js 适配(xterm / useXterm / useContainerFit / useXtermTheme / theme / TerminalView) | `@xterm/*`           |
| `src/data/model/`            | **L2 data**(纯类型)               | shell / session / pane                                                                   | 无                   |
| `src/data/service/`          | **L2 data**(IPC)                  | pty / session / types                                                                    | `@tauri-apps/api`    |

**对照表 (Rust)**:

| `src-tauri/src/`                                 | 层     | 拥有                                                     |
| ------------------------------------------------ | ------ | -------------------------------------------------------- |
| `core/`                                          | **L0** | 纯 Rust:portable-pty 封装 / Shell trait / SessionManager |
| `commands/`、`events.rs`、`state.rs`、`error.rs` | **L1** | Tauri 胶水:`#[tauri::command]` + AppState + dispatch     |
| `lib.rs`                                         | **L1** | 入口 + Builder + handler 注册 + dispatch 启动            |

## view/ 内部子分类

按你之前提的"布局 / 组件 / 事件"三分:

| 子类             | 路径                 | 拥有                                            | 说明                       |
| ---------------- | -------------------- | ----------------------------------------------- | -------------------------- |
| 布局 chrome      | `view/layout/`       | TabBar / SplitContainer                         | 结构性 chrome,定义 UI 形状 |
| 叶子 chrome      | `view/components/`   | PaneChrome / PaneInitCard                       | 叶子 / 可复用单元          |
| 事件             | —                    | (inline onClick / 跨组件 action 进 view/hooks/) | M2 没有独立 events/ 目录   |
| Composition root | `view/App.{tsx,css}` | L6,装 Provider + 组合根布局                     | 不属于上面 3 类            |

事件 handler 归属:

- **本地事件**(按钮 onClick 改 state)— inline 到 .tsx 里
- **跨组件事件**(tab close / pane split / shell spawn)— 进 `view/hooks/`(如 `usePaneTree` 的 actions)
- **纯事件 helper**(防抖 / 格式化)— 需要时进 `view/hooks/`

## 写新代码时该放哪里

| 写什么                         | 放哪                          | 例                       |
| ------------------------------ | ----------------------------- | ------------------------ |
| 一个 React 组件(布局类)        | `src/view/layout/X.tsx`       | `<TabBar />`             |
| 一个 React 组件(叶子类)        | `src/view/components/X.tsx`   | `<PaneChrome />`         |
| 一个 React hook(副作用 / 状态) | `src/view/hooks/useX.ts`      | `usePaneTree()`          |
| 一个纯类型 / 数据结构          | `src/data/model/X.ts`         | `PaneNode` 类型          |
| 一个 IPC 封装                  | `src/data/service/X.ts`       | `spawnTerminal()`        |
| 接触 xterm 实例                | `src/adapter/xterm/`          | xterm.js 适配            |
| 视觉 token / 颜色 / 间距       | `src/view/styles/tokens.css`  | `--accent`、`--hairline` |
| Composition root               | `src/view/App.tsx`            | 装 Provider、组合根布局  |
| Rust PTY / shell / session     | `src-tauri/src/core/X.rs`     | `Shell` trait            |
| Tauri command                  | `src-tauri/src/commands/X.rs` | `spawn_terminal`         |
| 新事件 payload                 | `src-tauri/src/events.rs`     | `TerminalDataPayload`    |

## 依赖方向(强制)

```
   L8 (tokens) ← L4 view ──→ L2 data ──→ L1 (commands) ──→ L0 (core)
                  │
                  └───────────────→ L3 adapter
```

读法:列依赖行。**任何反方向 import 都是架构违规**。

### 验证命令

```bash
# R1: L4 view / L3 adapter 不得 import @tauri-apps/api(只能 L2 data import)
grep -rn "@tauri-apps" src/view src/adapter

# R3: L2 data / L4 view 不得 import @xterm/*(只能 L3 adapter)
grep -rn "from \"@xterm" src/data src/view

# R4: L0 不得 use tauri
grep -rn "use tauri" src-tauri/src/core
```

## 决策记录

### D-2025-10 A 重整(本次)

- 原 `src/ui/ + src/hooks/` → `src/view/`(L4 view)
  - `src/ui/{TabBar,SplitContainer}.{tsx,css}` → `src/view/layout/`
  - `src/ui/{PaneChrome,PaneInitCard}.{tsx,css}` → `src/view/components/`
  - `src/ui/{App.tsx,App.css}` → `src/view/`
  - `src/hooks/*.ts(x)` → `src/view/hooks/`
  - `src/ui/styles/tokens.css` → `src/view/styles/`
- 原 `src/model/ + src/service/` → `src/data/`
  - `src/model/*` → `src/data/model/`
  - `src/service/*` → `src/data/service/`
- 原 `src/lib/xterm/` → `src/adapter/xterm/`

前端层数:5(L2 service / L3 model / L4 infra / L5 hooks / L7 ui)→ **3**(L2 data / L3 adapter / L4 view)。
R 规则从 R1/R3/R4/R5/R6/R7/R8 简化为 3 条核心:单向依赖。

### D-2025-10 R1 重整

- 原 `src/components/` → `src/ui/`(语义从"组件" → "chrome UI 视图层")
- 原 `src/domain/` → `src/model/`(对齐 `ref/xsterm/src/model/`)
- 原 `src/services/` → `src/service/`(去掉复数,跟 ref 对齐)
- 原 `src/lib/xterm/` → `src/infra/xterm/`(明示是 L4 infra,跟 ref 的 `infra/` 对齐)
- 原 `src/styles/` → `src/ui/styles/`(token 跟 chrome 共生,放在 ui 下)
- 原 `src/App.tsx` → `src/ui/App.tsx`(App 是 UI 组件,不是 entry)

不改:

- `src/hooks/` 保留(ref 没有 React hook 概念,React 项目独立留更清晰)
- `src-tauri/src/{core,commands,lib.rs}`(L0/L1 边界已稳,无收益)
