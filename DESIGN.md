# xsterm — Design

> xsterm 前端设计语言。来源：[Cursor 营销站设计分析](../../ref/awesome-design-md/design-md/cursor/DESIGN.md)（[`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/cursor/DESIGN.md)）。本文件是**本项目的权威落地版**——实现按本文件走，不是营销站原版。
>
> 适用范围：**shell chrome**（titlebar、status bar、buttons、dialogs、banners、settings panels、所有 xterm 容器外的 UI）。
>
> **不适用**：xterm 终端内容（PTY 输出的文字 / 光标 / 选区），由独立的 `src/types/theme.ts` xterm theme object 管理——见 §3。

---

## 1. 设计哲学（继承 Cursor 的纪律）

| 原则 | 规则 |
|---|---|
| **杂志声调** | Display 字体权重 **400**，标题 / 标签 **500**。**绝不用 600+** 于 chrome。 |
| **单色调 + 单一电气感** | Cursor Orange（`--accent: #f54e00`）**只用于**：primary CTA、focus border、active underline、focus ring、wordmark。绝不用于 body 文字或默认边框。 |
| **UI 字体 ≠ 等宽** | UI 用 `--font-ui`（Inter / system sans）。**只** terminal 内容 / 代码片段用 `--font-mono`（JetBrains Mono）。整个 UI 不是等宽。 |
| **Hairline-only 深度** | 组件靠 `var(--hairline*)` 1px 边框分层。**没有** cards / sections / inputs 上的 `box-shadow`。浮动层（Dialog / popover）例外。 |
| **两档圆角** | buttons / inputs → `var(--radius-md)` 8px。cards / dialogs → `var(--radius-lg)` 12px。tags / badges → `var(--radius-pill)`。 |
| **没有渐变 / 发光** | 不用 `linear-gradient`，不用 `text-shadow` glow。平涂表面。 |
| **Token 优先** | 每个颜色 / 间距 / 圆角 / 字体引用必须从 `:root` 来。组件 CSS 不用 hex（`:root` 入口本身除外）。 |

---

## 2. 与 Cursor 营销站的对应

Cursor 营销站用**暖奶油画布**配暖黑 ink。xsterm 是桌面终端模拟器，**用户期待暗色 IDE 风格的外壳**——所以保留 Cursor 的**纪律**（字体 / 间距 / 圆角 / hairline-only / 杂志声调 / 单一电气感），把 canvas 翻成**暖深灰**。

| Cursor（营销） | xsterm（暗色 IDE 适配） |
|---|---|
| Canvas `#f7f7f4` 暖奶油 | `--canvas` `#1a1a1a` 暖深灰 |
| Ink `#26251e` 暖黑 | `--ink` `#e8e6e0` 暖浅灰 |
| Cursor Orange `#f54e00` | `--accent` `#f54e00`（全保留） |
| 80px section 节奏 | 同节奏；窗内缩到 16 / 24 / 32 |
| Timeline pastel 5 色（Thinking / Grep / Read / Edit / Done） | **不继承**——本项目无 in-product AI timeline |

不做的事：
- 不引入第二种品牌电气感色。Cursor Orange 是唯一的。
- 不在 chrome 上做 bold（≥ 600）。
- 不在 cards / sections / inputs 上做 `box-shadow`。
- 不在 chrome 上用 timeline pastel——它们是营销站 in-product 用的，本项目语境里没意义。

---

## 3. 双主题系统（**先读这一节**——xsterm 唯一的特例）

xsterm 的视觉由**两个独立**主题系统组成。两者解耦，不要试图统一。

### 3.1 Shell chrome（本文档约束）

- **适用**：titlebar、status bar、buttons、dialogs、banners、settings panels、任何**xterm 容器之外**的 UI。
- **实现**：`src/styles/tokens.css` `:root`，组件用 `var(--...)`。
- **受本文档约束**。

### 3.2 xterm terminal 内容（不在本文档范围）

- **适用**：PTY 输出（文字 / 光标 / 选区 / 256-color / 24-bit truecolor）。
- **实现**：xterm.js 的 `theme` 选项对象（参考 `src/components/Terminal.tsx` 第 20–39 行的硬编码对象）。后续提取到 `src/types/theme.ts` 集中管理。
- **不读 CSS 变量**——xterm 是 canvas 渲染（WebGL / DOM），与 CSS 变量不在同一个栈。所以这层主题有自己独立的 hex 集合。

| 关注点 | Shell chrome | xterm content |
|---|---|---|
| 配置文件 | `src/styles/tokens.css` `:root` | `src/types/theme.ts`（未来） |
| 当前生效位置 | N/A（还没有 tokens.css） | `Terminal.tsx` 内联 theme 对象 |
| 主题入口 | CSS class / `data-theme` attr | xterm `theme` prop |
| 用户切换 | `--theme` 切换 CSS | 重建 xterm 传入新 theme |

> **新增 chrome 时**：用 §4 的 CSS 变量。**修改 PTY 输出样式时**：改 xterm theme 对象。两者不要互相串。

---

## 4. Token Reference（`src/styles/tokens.css` `:root`）

> Token 还没有创建。本节是**首次落地时的目标值**。创建文件时，按本节贴入 `:root`，并把组件里的硬编码值替换成 `var(--...)`。

```css
:root {
  /* === Surfaces（暖深 IDE 灰阶） === */
  --canvas:           #1a1a1a;   /* 应用底色 */
  --canvas-soft:      #1f1f1f;   /* pane 内嵌软底色 */
  --surface-card:     #242424;   /* cards / dialog 内容 */
  --surface-strong:   #2e2e2e;   /* badges / tag pills */
  --bg-hover:         #2a2a2a;   /* interactive hover */
  --bg-active:        #333333;   /* 按下 / active */

  /* === Hairlines（替代 border + shadow） === */
  --hairline:         #2e2e2e;   /* 默认 1px 分隔 */
  --hairline-soft:    #262626;   /* 更弱分隔 */
  --hairline-strong:  #3a3a3a;   /* 面板描边 / button border */

  /* === Text === */
  --ink:              #e8e6e0;   /* display / heading / 重要文字（暖） */
  --body:             #b8b6b0;   /* 默认正文 */
  --body-strong:      #e8e6e0;   /* ink 同色别名（语义化复用） */
  --muted:            #7a7a78;   /* 副标题 / metadata */
  --muted-soft:       #4a4a48;   /* 禁用文字 */
  --text-on-accent:   #ffffff;

  /* === Accent（Cursor Orange——唯一电气感） === */
  --accent:           #f54e00;
  --accent-hover:     #ff5e1a;
  --accent-active:    #d04200;
  --accent-soft:      rgba(245, 78, 0, 0.12);  /* focus halo / 选区底 */

  /* === Semantic === */
  --error:            #cf2d56;
  --error-bg:         rgba(207, 45, 86, 0.12);
  --warning:          #f0a020;   /* 可恢复异常（连接掉线） */
  --warning-bg:       rgba(240, 160, 32, 0.12);
  --success:          #1f8a65;
  --success-bg:       rgba(31, 138, 65, 0.12);

  /* === Typography === */
  --font-ui:          "Inter", "Segoe UI", system-ui, -apple-system,
                       "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono:        "JetBrains Mono", "Fira Code", "IBM Plex Mono",
                       Menlo, Monaco, "Courier New", monospace;

  /* === Spacing（4px base） === */
  --space-xxs:        4px;
  --space-xs:         8px;
  --space-sm:         12px;
  --space-base:       16px;       /* 默认字段间距 */
  --space-md:         20px;
  --space-lg:         24px;
  --space-xl:         32px;       /* 区分性 section 间距 */
  --space-xxl:        48px;
  --space-section:    80px;

  /* === Radius === */
  --radius-xs:        4px;        /* inline tags（少用） */
  --radius-sm:        6px;        /* 紧凑行 */
  --radius-md:        8px;        /* buttons / inputs */
  --radius-lg:        12px;       /* cards / dialogs */
  --radius-xl:        16px;       /* 罕见 feature card */
  --radius-pill:      9999px;

  /* === Overlay === */
  --overlay:          rgba(0, 0, 0, 0.55);
}
```

---

## 5. 颜色用途

| Token | 用在 | 不用在 |
|---|---|---|
| `--canvas` | 应用底色 | cards |
| `--surface-card` | cards / dialog body / settings panels | 应用底色 |
| `--ink` | display / heading / 主文字 | 禁用 |
| `--body` | 默认正文 | headings |
| `--muted` | 副标题 / metadata / 未激活 tab 文字 | 主文字 |
| `--accent` | primary CTA / focus border / active underline / link | body 文字、默认边框 |
| `--accent-soft` | focus halo / 选区底色 / drag-over | 实心填充 |
| `--error` | 销毁性 CTA / 校验报错 | 装饰 |
| `--warning` | 可恢复异常 | 致命错误 |
| `--success` | 确认提示 | 装饰 |
| `--hairline` | 1px section 分隔 | drop shadow 替代 |
| `--hairline-strong` | 面板描边 / button border / dialog 框 | 细分隔 |

---

## 6. 字体层级

| Token | Size | Weight | Line | Tracking | 用途 |
|---|---|---|---|---|---|
| `display-lg` | 26px | 500 | 1.2 | 0 | dialog 标题、面板 hero（罕见） |
| `title-md`   | 18px | 500 | 1.4 | 0 | card 标题 |
| `title-sm`   | 16px | 500 | 1.4 | 0 | 列表 label |
| `body-md`    | 16px | 400 | 1.5 | 0 | 默认正文 |
| `body-sm`    | 14px | 400 | 1.5 | 0 | 次要正文 |
| `body-md-mono` | 16px | 400 | 1.5 | 0 | code/terminal 外部但要等宽（命令回显、snippet 卡） |
| `caption`    | 13px | 400 | 1.4 | 0 | form input default |
| `caption-uppercase` | 11px | 600 | 1.4 | 0.88px | section label、pill 文案（**uppercase**） |
| `button`     | 14px | 500 | 1.0 | 0 | CTA 文案 |
| `code`       | 13px | 400 | 1.5 | 0 | 代码块（永远 `--font-mono`） |

**规则**：
- 大部分 chrome 用 **14–16px**。display-lg 是保留位。
- Bold（≥ 600）**只允许**于 wordmark、caption-uppercase、code block 内。chrome 别用。
- 大 display 可用负 tracking（`-1px` @ 26px）。body 文字 tracking = 0。
- `--font-mono` **只**用于：xterm 容器包裹层（如果需要）、code block、命令回显、显式等宽段。

---

## 7. 间距 / 圆角

### 间距节奏

| 场景 | Token | 值 |
|---|---|---|
| 元素内联间隙 | `--space-xxs` / `--space-xs` | 4 / 8px |
| 字段间距（section 内） | `--space-base` | 16px |
| section 之间 | `--space-xl` | 32px |
| 主要页面章节 | `--space-section` | 80px |

### 圆角决策树

```
容器 / section         → 不设圆角（或 0）
card / dialog body     → --radius-lg (12px)
list 内的 row          → --radius-sm (6px)
button / input         → --radius-md (8px)
inline tag / badge     → --radius-xs (4px) 或 --radius-pill
avatar / status dot    → --radius-pill (9999px)
```

**禁用**：cards 上用 4 / 6px。buttons / inputs 用 12 / 16px。

---

## 8. 组件（当前实现 / 即将落地）

> 本项目的 UI 尚处于早期。当前只有一个组件 **`Terminal`**（xterm 容器），未来会引入 titlebar、status bar、settings dialog、command palette。下面的规格是**未来 chrome 落地时**直接套的模板。

### 8.1 Terminal host（**当前已存在**）

```tsx
<div ref={terminalRef} style={{ width: "100%", height: "100vh" }} />
```

当前在 `src/components/Terminal.tsx`，全屏包裹 xterm。当前没有任何 chrome 元素。

**适配设计系统的方向**：
- host 容器本身是 `--canvas` 底色，与 `--bg` 平涂，避免 xterm background 与外壳出现色差。
- xterm 的 `theme.background` 必须与 `--canvas` **同色或邻色**（建议后期提取到 `src/types/theme.ts` 时让 dark theme 的 bg = `--canvas`）——否则 PTY 边距会出现"色带"。
- host 将来需要被包在 titlebar / statusbar 之间时，要用 `--hairline` 1px 分隔，**不用** shadows。

### 8.2 Button（未来）

| Variant | Background | Text | Border | Radius | Weight |
|---|---|---|---|---|---|
| `--primary` | `var(--accent)` | `var(--text-on-accent)` | none | `var(--radius-md)` | 500 |
| `--primary:hover` | `var(--accent-hover)` | — | — | — | — |
| `--primary:active` | `var(--accent-active)` | — | — | — | — |
| `--secondary` | `var(--surface-card)` | `var(--ink)` | 1px `var(--hairline-strong)` | `var(--radius-md)` | 500 |
| `--ghost` | transparent | `var(--ink)` | none | `var(--radius-md)` | 500 |

Height：36–44px（默认 40px）。Horizontal padding：16–20px。

### 8.3 Form input（未来）

- 容器：`display: flex; flex-direction: column; gap: 6–8px`
- Label：`var(--body)` 14px / 500，无 `*` 装饰；如要标红，用 `var(--error)`。
- Input / select：`var(--surface-card)` 底 / `var(--ink)` 文 / 1px `var(--hairline-strong)` 边 / `var(--radius-md)` 8px / padding 12px 16px / height 40–44px。
- Focus：border → `var(--accent)`；可选 `outline: 2px solid var(--accent-soft)`。
- Placeholder：`var(--muted)`。

### 8.4 Card / settings panel（未来）

- Background：`var(--surface-card)`
- Border：1px `var(--hairline)`（或 full-bleed 时不设）
- Radius：`var(--radius-lg)` 12px（卡片）/ `var(--radius-md)` 8px（紧凑行）
- Padding：`var(--space-base)` 16px（紧凑）/ `var(--space-lg)` 24px（feature card）
- Header：`var(--ink)`，weight 500，14–16px
- **禁用** `box-shadow`、**禁用** `linear-gradient`

### 8.5 Dialog / popover（未来）

- Overlay：`var(--overlay)`
- Dialog 框：`var(--surface-card)` 底 / `var(--radius-lg)` 12px / 1px `var(--hairline-strong)` 边 / **允许**轻微浮起阴影（`0 8px 32px rgba(0, 0, 0, 0.35)`，这是 floating overlay 的例外）
- Header：`var(--surface-card)` 底，1px `var(--hairline)` 下边线，title weight 500
- Footer：buttons 右对齐，primary 在右侧
- 宽度：small 320–400px / medium 400–500px / large 720–780px

### 8.6 Tab / navigation（未来）

- Background：transparent
- Text：`var(--muted)`（默认）/ `var(--ink)`（active）
- Active 指示器：**2px `var(--accent)` 下划线**（**不**用 background fill）
- Hover：`var(--bg-hover)` 底
- tab buttons 不要 `border-radius`——下划线就是 chrome

### 8.7 Banner（连接断线 / 致命错误，未来）

- Background：`var(--warning-bg)`（可恢复）/ `var(--error-bg)`（致命 / 校验）
- Text：`var(--warning)` / `var(--error)`
- Border-bottom：1px 同色
- `pointer-events: none`（让点击透过到内容）
- Centered text，13px / 500

---

## 9. 深度

| Level | 表现 | 用在 |
|---|---|---|
| Flat（canvas） | `--canvas` 底 | body / footer |
| Inset | `--canvas-soft` 底，无 border | 卡片内 IDE pane |
| Card | `--surface-card` + 1px `--hairline` | settings panels / list 容器 |
| Pane | `--canvas-soft` + 1px `--hairline-strong` | tab 内容 / dialog 面板 |
| Floating | `--surface-card` + 1px `--hairline-strong` + 轻微 `box-shadow` | Dialog / ContextMenu / popover |

**禁用规则**：`box-shadow` 只允许在 floating overlay 上。cards / sections / rows 全靠 hairline。

---

## 10. 当前 vs 即将

| 区域 | 当前状态 | 打算 |
|---|---|---|
| 全局 CSS tokens | 不存在 | 创建 `src/styles/tokens.css`，按 §4 贴入 `:root` |
| Terminal host | `src/components/Terminal.tsx` 全屏包裹 xterm | 在 titlebar / statusbar 落地前保持全屏 |
| Titlebar | 不存在 | 跟 Tauri `decorations: false` 配套实现，组件 `src/components/TitleBar.tsx` |
| Status bar | 不存在 | 底部 1px `--hairline` 分隔，行内 session name / status indicator |
| Settings dialog | 不存在 | 跟 `create_session` Tauri command 配套，第一弹就是 session 配置 |
| xterm theme | 内联在 `Terminal.tsx` | 提取到 `src/types/theme.ts`，导出多个预设（dark / light / solarized 等），切换时重建 xterm |
| Banner（连接断线） | 不存在 | 监听 `session-closed` / PTY writer error，渲染 `<Banner variant="warning" />` |

新 UI 工作：先读本文档 §1–§9 + AGENTS.md，再写代码。

---

## 11. 反模式（禁用）

- ❌ 组件 CSS 里硬编码 hex（用 `var(--...)`；唯一例外见 §12）。
- ❌ Chrome 上 `font-weight: 600` 或更高（用 400 / 500）。
- ❌ cards / sections / inputs 上的 `box-shadow`。
- ❌ `linear-gradient` / `radial-gradient` / `text-shadow` glow。
- ❌ cards 用 `border-radius: 4px` 或 `6px`（用 `--radius-lg` 12px）。
- ❌ 整个 UI 全等宽（只有 xterm / 代码块用 mono）。
- ❌ `--bg-primary` / `--bg-secondary` / `--border-color` 这类旧语义名（用本文档的 token）。
- ❌ VSCode 蓝 hex：`#0e639c` / `#1177bb`。
- ❌ Tailwind / CSS-in-JS / CSS Modules（项目是平涂全局 CSS）。
- ❌ xterm 的 ANSI 色塞进 `--accent`——那是 §3.2 的事。
- ❌ 把 `--accent` 用在 body 文字上——accent 只用于 CTA / focus / underline / wordmark。

---

## 12. 文档化的例外（落地时按需补）

引用占位。新例外落地时按"文件:行 / 选择器 / 原因"三列填入，与 §9 的 floating 例外一致。

### 12.1 Hex literals

| Where | Hex | Why |
|---|---|---|
| `src/styles/tokens.css` → `.form-field select` background-image | `#b8b6b0`（data URI 内） | data URI 不能插值 CSS 变量；与 `--muted` 等色 |

### 12.2 `box-shadow` on floating overlays

引用占位。当前还没有 floating overlay 实现。落地 Dialog / ContextMenu / popover 时，按"文件:行 / 选择器 / 阴影值 / 原因"四列补。

### 12.3 `inset` shadow as visual indicator

引用占位。当前还没有 inset 用法。`outline` 不能用于 tab / pane focus 指示器（会被遮挡），用 `box-shadow: inset ...` 绘内框——落地时按"文件:行 / 选择器 / 原因"三列补。

---

## 13. 验证脚本

```bash
# 1. 禁用 token / VSCode 蓝 / 渐变 —— 必须为空
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ \
  --include="*.ts" --include="*.tsx" --include="*.css"

# 2. Chrome 上的 bold 权重 —— 必须为空
grep -rn -E "font-weight: ?(600|700|bold)" src/ \
  --include="*.ts" --include="*.tsx" --include="*.css"

# 3. Box-shadow 出现位置 —— 只允许 §12.2 / §12.3 的例外
grep -rn "box-shadow:" src/components/ --include="*.css"
```

`grep` 跑前先确保 `src/styles/tokens.css` 存在并接入了 `main.tsx`；否则会出现大量漏匹配。

---

## 14. 引用

- **Cursor 设计来源**：[`awesome-design-md/design-md/cursor/DESIGN.md`](../../ref/awesome-design-md/design-md/cursor/DESIGN.md)（[`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/cursor/DESIGN.md)）
- **项目 AGENTS.md**：[`../../AGENTS.md`](../../AGENTS.md)（working tree 状态 + 命名规则 + 工具链）
- **xterm.js theme API 文档**：在 xterm.js 内部，**与本文档解耦**
- **TypeScript 命名规范**：`doc/rules/ts-name-rules.md`
- **Rust 命名规范**：`doc/rules/rust-name-rules.md`
