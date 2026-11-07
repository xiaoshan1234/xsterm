# DESIGN.md — xsterm 前端设计规范

> **Standing rule for this project.** Every component, dialog, panel, button, and chrome surface must follow this document. Any UI change must read this first and apply its tokens and patterns verbatim. No ad-hoc styles.

xsterm 的 shell UI 采用**适配版 Cursor 设计语言**：把 Cursor 的纪律（排版、间距、圆角、hairline-only 深度、杂志感）应用到**暗色 IDE 语境**（这是一个终端模拟器，用户期待暗色 chrome）。

市场营销侧的原始 spec 在 [`ref/awesome-design-md/design-md/cursor/DESIGN.md`](ref/awesome-design-md/design-md/cursor/DESIGN.md)。**本文档是权威的项目适配版**——实现以本文档为准，不是直接照搬营销 spec。

---

## 1. 设计哲学

| 原则 | 规则 |
|---|---|
| **展示字重** | 标题 / 标签用 **400–500**，UI chrome **禁止 600+**。杂志感，不 tech-bombastic |
| **等宽纪律** | UI 文本用 `--font-ui`（Inter / system sans）；**只有**代码 / 终端表面用 `--font-mono`（JetBrains Mono）。UI 不是整体等宽 |
| **强调色克制** | Cursor Orange（`--accent: #f54e00`）只用于：主 CTA、聚焦输入边框、活动 tab 下划线、焦点环、选区光晕。**绝不**用于正文或默认边框 |
| **Hairline-only 深度** | 组件用 1px `var(--hairline*)` 分隔。卡片 / 分区 / 输入框**无** `box-shadow`。只有浮动浮层（Dialog、ContextMenu、popover）可带轻微阴影 |
| **两种圆角** | 按钮 / 输入框 → `--radius-md`（8px）。卡片 / 对话框 → `--radius-lg`（12px）。标签 / 徽章 → `--radius-pill` |
| **无渐变** | 无 `linear-gradient`，无 `text-shadow` 光晕。只做平面表面 |
| **Token 优先** | 颜色、间距、圆角、字体一律引用 `:root` token。组件 CSS 里**禁止**写 hex 字面量（少数已文档化例外见 §11） |

---

## 2. Token 参考

所有 token 定义在 `src/styles/global.css` 的 `:root`。**不要在其他地方重定义**。需要新值就先加到 `:root`，再用 `var()` 引用。

```css
:root {
  /* === Surfaces（暖色暗 IDE，由 Cursor cream 适配） === */
  --canvas: #1a1a1a;         /* 应用底色 */
  --canvas-soft: #1f1f1f;    /* IDE-pane 式软表面 */
  --surface-card: #242424;   /* 卡片、对话框内容 */
  --surface-strong: #2e2e2e; /* 徽章、标签 pill */
  --bg-hover: #2a2a2a;       /* 交互元素 hover */
  --bg-active: #333333;      /* pressed / active */

  /* === Hairlines（替代边框 + 阴影） === */
  --hairline: #2e2e2e;       /* 默认 1px 分隔线 */
  --hairline-soft: #262626;  /* 更浅分隔线 */
  --hairline-strong: #3a3a3a;/* 面板描边、按钮边框 */

  /* === Text === */
  --ink: #e8e6e0;            /* 展示、标题、主文本（暖） */
  --body: #b8b6b0;           /* 默认正文 */
  --muted: #7a7a78;          /* 副标题 */
  --muted-soft: #4a4a48;     /* 禁用 */
  --text-on-accent: #ffffff;

  /* === Accent（Cursor Orange 取代 VSCode 蓝） === */
  --accent: #f54e00;         /* 主 CTA、链接、焦点 */
  --accent-hover: #ff5e1a;
  --accent-active: #d04200;  /* 按下 */
  --accent-soft: rgba(245, 78, 0, 0.12); /* 焦点光晕、选区 */

  /* === Semantic === */
  --error: #cf2d56;  --error-bg: rgba(207, 45, 86, 0.12);
  --success: #1f8a65; --success-bg: rgba(31, 138, 101, 0.12);
  --warning: #f0a020; --warning-bg: rgba(240, 160, 32, 0.12);
  --info: #5cb3ff;   --info-soft: rgba(92, 179, 255, 0.18); /* 行号、信息标签 */

  /* === Typography === */
  --font-ui: "Inter", "Segoe UI", system-ui, -apple-system,
             "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", "IBM Plex Mono",
               Menlo, Monaco, "Courier New", monospace;

  /* === Spacing（4px 基准） === */
  --space-xxs: 4px;  --space-xs: 8px;  --space-sm: 12px;
  --space-base: 16px; --space-md: 20px; --space-lg: 24px;
  --space-xl: 32px;  --space-xxl: 48px; --space-section: 80px;

  /* === Radius === */
  --radius-xs: 4px;  --radius-sm: 6px;  --radius-md: 8px;
  --radius-lg: 12px; --radius-xl: 16px; --radius-pill: 9999px;

  /* === 窗口控制（特例） === */
  --close-hover: #e81123;   /* 关闭 hover 保持 Windows 红 */

  /* === Overlay === */
  --overlay: rgba(0, 0, 0, 0.55);
}
```

---

## 3. 颜色用法

| Token | 用于 | 不用于 |
|---|---|---|
| `--canvas` | 应用底色 | 卡片 |
| `--surface-card` | 卡片、对话框主体、设置面板 | 应用底色 |
| `--ink` | 展示、标题、主文本 | 禁用文本 |
| `--body` | 默认正文 | 标题 |
| `--muted` | 副标题、元数据、tab 标签（默认） | 主文本 |
| `--accent` | 主 CTA、焦点边框、活动下划线、链接 | 正文、默认边框 |
| `--accent-soft` | 焦点光晕、选区行着色、drag-over | 实心填充 |
| `--error` | 破坏性 CTA、校验错误 | 装饰 |
| `--warning` | 可恢复问题（连接断开等） | 致命错误 |
| `--success` | 确认 | 装饰 |
| `--info` | 行号、信息标签 | 正文 |
| `--hairline` | 分区间的 1px 分隔线 | 阴影替代 |
| `--hairline-strong` | 面板描边、按钮边框、对话框边框 | 细分隔线 |

---

## 4. 排版

```text
display-lg { 26px / 500 / 1.2 / 0   }  /* 对话框标题 */
title-md   { 18px / 500 / 1.4 / 0   }  /* 卡片标题 */
title-sm   { 16px / 500 / 1.4 / 0   }  /* 列表标签 */
body-md    { 16px / 400 / 1.5 / 0   }  /* 默认正文 */
body-sm    { 14px / 400 / 1.5 / 0   }  /* 次级正文 */
caption    { 13px / 400 / 1.4 / 0   }  /* 表单输入默认 */
caption-uppercase { 11px / 500 / 1.4 / 0.88px / UPPERCASE }  /* 分区标签 */
button     { 14px / 500 / 1.0 / 0   }  /* CTA 标签 */
nav-link   { 14px / 500 / 1.4 / 0   }  /* 顶栏菜单 */
code       { 13px / 400 / 1.5 / 0   }  /* 永远 --font-mono */
```

**规则**：

- 大多数 chrome 用 **14–16px**；大号展示字号是保留项。
- **UI chrome 只用 400 / 500**；`font-weight: 600/700/bold` 在组件 CSS 里禁止（分区标签用 500 + 大写 + 0.88px 字距实现「标签感」）。
- 负字距只用于大号展示（如 26px 处 `-0.5px`）；正文用 0。
- 分区标签用 `caption-uppercase`。

---

## 5. 组件模式

### 按钮（`.btn` 家族）

| 变体 | 背景 | 文本 | 边框 | 圆角 | 字重 |
|---|---|---|---|---|---|
| `.btn--primary` | `var(--accent)` | `var(--text-on-accent)` | 无 | `var(--radius-md)` | 500 |
| `.btn--primary:hover` | `var(--accent-hover)` | — | — | — | — |
| `.btn--primary:active` | `var(--accent-active)` | — | — | — | — |
| `.btn--secondary` | `var(--surface-card)` | `var(--ink)` | 1px `var(--hairline-strong)` | `var(--radius-md)` | 500 |
| `.btn--ghost` | transparent | `var(--ink)` | 无 | `var(--radius-md)` | 500 |

高度 **36–44px**（默认 40px），水平内边距 16–20px。

### 表单输入（`.form-field`）

- 容器：`display: flex; flex-direction: column; gap: 6–8px`
- 标签：`var(--body)` 14px 500；必填用 `var(--accent)` 标记，不加星号样式
- 输入 / 选择：`var(--surface-card)` 背景、`var(--ink)` 文本、1px `var(--hairline-strong)` 边框、`var(--radius-md)` 8px、12px 16px 内边距、高度 40–44px
- 聚焦：边框 → `var(--accent)`，可选 `outline: 2px solid var(--accent-soft)`
- 占位符：`var(--muted)`

### 卡片（设置面板、列表行）

- 背景：`var(--surface-card)`
- 边框：1px `var(--hairline)`（或全出血无边框）
- 圆角：`var(--radius-lg)` 12px（卡片）或 `var(--radius-md)` 8px（紧凑行）
- 内边距：`var(--space-base)` 16px（紧凑）或 `var(--space-lg)` 24px（特性卡）
- 标题：`var(--ink)`，500，14–16px
- **无** `box-shadow`、**无** `linear-gradient`

### 对话框

- 遮罩：`var(--overlay)`（rgba(0,0,0,0.55)）
- 对话框：`var(--surface-card)` 背景、`var(--radius-lg)` 12px、1px `var(--hairline-strong)` 边框，允许轻微浮动阴影（`0 8px 32px rgba(0,0,0,0.35)`）
- 头部：`var(--surface-card)` 背景、1px `var(--hairline)` 底部线、标题 500
- 底部：`var(--surface-card)` 背景，按钮右对齐，主按钮在最右
- 宽度：小 320–400px，中 400–640px，大 720–880px

### Tabs

- 背景：transparent
- 文本：`var(--muted)`（默认），`var(--ink)`（活动）
- 活动指示器：2px `var(--accent)` 下划线（不是背景填充）
- Hover：`var(--bg-hover)` 背景
- tab 按钮无圆角（下划线即 chrome）

### 侧边栏（对话框内的左侧导航）

- 项：`var(--body)` 文本，transparent 背景
- 活动：`var(--accent-soft)` 背景 + `var(--ink)` 文本 + 可选 2px `var(--accent)` 左侧轨
- Hover：`var(--bg-hover)` 背景
- 圆角：`var(--radius-sm)` 6px（项上）

### 横幅（如会话断开）

- 背景：`var(--warning-bg)`（可恢复）或 `var(--error-bg)`（校验）
- 文本：`var(--warning)` / `var(--error)`
- 底部边框：1px 同色
- `pointer-events: none` 让点击穿透到内容
- 居中文本，13px 500

---

## 6. 层级与深度

| 层级 | 处理 | 用于 |
|---|---|---|
| Flat（canvas） | `--canvas` 背景 | 主体、底部 |
| Inset | `--canvas-soft` 背景，无边框 | 卡片内的 IDE pane |
| Card | `--surface-card` 背景 + 1px `--hairline` 边框 | 设置面板、列表容器 |
| Pane | `--canvas-soft` 背景 + 1px `--hairline-strong` 边框 | tab 内容、对话框面板 |
| Floating | `--surface-card` 背景 + 1px `--hairline-strong` + 轻微 `box-shadow` | Dialog、ContextMenu、popover |

**除浮动浮层外禁止 drop shadow。** 卡片、分区、行只靠 hairline 分隔。

---

## 7. 间距节奏

| 用途 | Token | 值 |
|---|---|---|
| 行内元素间距 | `--space-xxs` / `--space-xs` | 4px / 8px |
| 字段间距（分区内） | `--space-base` | 16px |
| 分区间距（对话框内） | `--space-xl` | 32px |
| 页面主分区 | `--space-section` | 80px |

默认对话框面板：字段间 16px，不同分区组间 32px。

---

## 8. 圆角决策树

```text
容器或分区？      → 无圆角
卡片或对话框？    → --radius-lg (12px)
列表内行？        → --radius-sm (6px)
按钮或输入框？    → --radius-md (8px)
内联标签/徽章？   → --radius-xs (4px) 或 --radius-pill
头像/状态点？     → --radius-pill (9999px)
```

---

## 9. 新组件工作流

1. **读** `src/styles/global.css` 的 `:root`，并浏览 §3–§8。
2. **写 JSX**，优先复用已有全局 class（`.btn--primary`、`.btn--secondary`、`.form-field` 等）。
3. **仅在需要时**加组件专属 CSS——与组件同目录 `<Component>.css`，引用 `var(--...)`，**不写 hex 字面量**。
4. **提交前验证**：

   ```bash
   # 禁止的旧 token / VSCode 蓝 / 渐变 —— 必须为空
   grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/

   # 禁止 600/700/bold 字重 —— 必须为空
   grep -rn "font-weight: ?(600|700|bold)" src/

   # 禁止 drop shadow —— 只允许 §11 已文档化的浮层例外
   grep -rn "box-shadow:" src/components/
   ```

5. **类型检查**：`npm run build`（或 `npx tsc --noEmit`）。

---

## 10. 终端内容主题（独立系统）

终端**内容**（ANSI 前景/背景/光标 + 16 色板）是独立于 shell chrome 的另一套主题系统，定义在 `src/types/theme.ts`，内置 5 个预设（dark / light / monokai / oneDark / dracula），用户可切换。**本文档不约束终端内容主题**，也不要与 chrome 的 `:root` token 混用。

---

## 11. 已文档化例外

以下条目有意违反 §1–§9 的某条规则，已经评审。

### 11.1 Hex 字面量

| 位置 | Hex | 原因 |
|---|---|---|
| `src/styles/global.css` — `.form-field select` 的 background-image | `#b8b6b0`（内联在 `data:` URI） | 自定义 select 箭头是 SVG data-URI，CSS 变量无法插入 `data:` URL；颜色等于 `--muted` |
| `src/components/NavBar.css` — `.window-control--close:hover` | `#e81123` | Windows 约定关闭 hover 红，token `--close-hover` |
| 图标组件内的 SVG `stroke=` | various | 图标用 `currentColor` 传播，无需 token |

### 11.2 浮动浮层的 box-shadow

浮动浮层（§6）可带轻微 drop shadow。目前允许：

| 文件 | 选择器 | 原因 |
|---|---|---|
| `src/components/ui/Dialog.css` | `.dialog` | 浮动模态，需要盖过页面的深度 |
| `src/components/ui/ContextMenu.css` | `.context-menu` | 浮动右键菜单 |
| `src/components/sidebar/Sidebar.css` | `.layout-popover` | 侧边栏上的浮动面板 |
| `src/components/WorkspaceBottomBar.css` | `.workspace-switcher-item-list` | 浮动 workspace 切换 popover |

### 11.3 inset box-shadow（视觉指示器）

`inset` 阴影**不是 drop shadow**——它画在元素内部，用作强调指示器：

| 文件 | 选择器 | 原因 |
|---|---|---|
| `src/components/sidebar/Sidebar.css` | `.session-group.drag-over` | 1px 内强调轨表示 drag-over 目标 |
| `src/styles/pane.css` | `.workspace-pane--active::before` | 2px 内强调环表示聚焦 pane |

新增例外时必须在此登记文件路径、选择器和理由。

---

## 12. 反模式（禁止）

- ❌ 组件 CSS 里写死 hex（用 `var(--...)`）。
- ❌ UI chrome 上 `font-weight: 600` 及以上（用 400/500）。
- ❌ 卡片 / 分区 / 输入框用 `box-shadow`。
- ❌ `linear-gradient` / `radial-gradient` / `text-shadow` 光晕。
- ❌ 卡片用 4px / 6px 圆角（用 `--radius-lg` 12px）。
- ❌ 整个 UI 用等宽字体（只有代码表面用 mono）。
- ❌ 旧 token 名：`--bg-primary`、`--bg-secondary`、`--bg-tertiary`、`--text-primary`、`--text-secondary`、`--text-muted`、`--border-color`。
- ❌ VSCode 蓝：`#0e639c`、`#1177bb`。
- ❌ Tailwind、CSS-in-JS、CSS Modules（项目用纯全局 CSS）。
- ❌ chrome 中使用 `--font-ui` / `--font-mono` / `inherit` 之外的字体。

---

## 13. 参考

- Cursor 设计源：`ref/awesome-design-md/design-md/cursor/DESIGN.md`
- Token 实现：`src/styles/global.css` 的 `:root`
- 终端内容主题（独立系统）：`src/types/theme.ts`
