# M3 — Design System

> 状态:**规划中**,待 review。
>
> 父文档:[`../arch/ARCHITECTURE.md`](../arch/ARCHITECTURE.md)、[`../arch/LAYERS.md`](../arch/LAYERS.md)、[`../arch/frontend-quick-ref.md`](../arch/frontend-quick-ref.md)
>
> 上一里程碑:[`M2-SESSIONS.md`](./M2-SESSIONS.md)
>
> 上游约束:[`../../DESIGN.md`](../../DESIGN.md)(chrome 视觉权威)、[`../../AGENTS.md`](../../AGENTS.md)

---

## 1. 目标

把"chrome 能用"提升到"chrome 是一套设计语言"。M2 时期 chrome 是手画 tokens(M2 子集);M3 落到完整 DESIGN.md §4 + 3 个核心 chrome 组件(TitleBar / StatusBar / Dialog),并把 OS title bar 换成自定义。

## 2. 验收(V1–V11)

| # | 检查 | 通过条件 |
|---|---|---|
| V1 | tokens.css 完整 | 包含 DESIGN.md §4 全量(surface 5 级、hairline 3 级、text 5 级、accent/error/success、font、radius 5 级、space 9 级、overlay) |
| V2 | TitleBar 渲染 | 顶栏:左侧 logo + 名称(可拖动区),右侧 min / max / close 三按钮 |
| V3 | TitleBar 可拖 | TitleBar drag 区域用 `data-tauri-drag-region` 或 `-webkit-app-region: drag`;按钮 `no-drag` |
| V4 | 窗口控件工作 | min / max(restore) / close 三按钮都能调 Tauri `getCurrentWindow()` 行为 |
| V5 | 双击还原 | TitleBar drag 区双击 = 切换 max / restore |
| V6 | StatusBar 渲染 | 底栏:左 PaneTree 摘要(tab 数 / pane 数 / 焦点 shell),右预留(M5 显示) |
| V7 | Dialog 组件 | 通用 modal wrapper(overlay + card + close);M3 不带业务内容,M5 settings 用它 |
| V8 | 设计语言一致 | `grep -E "font-weight: ?(600|700|bold)" src/view` 应空;`grep -E "box-shadow:" src/view` 仅浮动层(本 M3 内零匹配);`grep -nE "#([0-9a-fA-F]{3}){2}" src/view` 应只有 `tokens.css` |
| V9 | tauri 窗口无 OS title bar | `tauri.conf.json` `decorations: false`;V4 控件工作 |
| V10 | 构建 | `npm run build` + `cargo build --release` 全绿;`lib.rs` ≤ 100 行 |
| V11 | index.html 干净 | 标题 "xsterm";M0 vite.svg favicon 替换为 xsterm 标识(简单 SVG 即可) |

## 3. 范围

**In**:

- `view/styles/tokens.css` 补全到 DESIGN.md §4
- `view/components/TitleBar.{tsx,css}` — 自定义窗口标题栏
- `view/components/StatusBar.{tsx,css}` — 底栏
- `view/components/Dialog.{tsx,css}` — 通用 modal
- `tauri.conf.json` `decorations: false` + `titleBarStyle: "Transparent"`
- `capabilities/default.json` 加 window 权限
- `index.html` 标题 / favicon

**Out** (M4/M5 再说):

- 主题切换(深/浅)— M5
- Settings 实际内容(用 Dialog)— M5
- 自定义字体加载(Inter 实际下载)— 留 fallback 给系统字体
- 多窗口 / 多 monitor — 不在范围
- 圆角 / 阴影例外集中整改 — M3 内零容忍,逐组件巡检

## 4. 文件级变更

### 新增

```
view/components/
├── TitleBar.tsx/css       (新)
├── StatusBar.tsx/css      (新)
└── Dialog.tsx/css         (新,通用 modal,无业务内容)
```

### 修改

```
view/styles/tokens.css              补全到 §4 全量
view/App.tsx                        加 <TitleBar /> + <StatusBar />
src-tauri/tauri.conf.json           decorations: false, titleBarStyle
src-tauri/capabilities/default.json 加 window 权限
index.html                          title, favicon
```

### 依赖

- L4 view:`@tauri-apps/api/window` 的 `getCurrentWindow`(仅 TitleBar 用)— **R1 红线**

> ⚠️ R1:TitleBar 是 L4 view 唯一调 `@tauri-apps/api` 的例外。其他 view 组件**严禁**。
> 解决:TitleBar 内部封装 `useWindowControls()` hook 把 `@tauri-apps/api` 调用收口;
> 其他 view 组件只用 `useWindowControls()` 拿 `{minimize, maximize, close}` 等方法。

### 不动

- L0 / L1 Rust 零修改
- L2 / L3 / L4 view 其他组件不动
- L4 view 的 hooks/ 不动
- data/model 不动

## 5. 关键设计问题(待拍板)

| # | 问题 | 我推荐 |
|---|---|---|
| Q1 | TitleBar 高度 | **36px** — 与 TabBar 同高,视觉一致 |
| Q2 | StatusBar 高度 | **24px** — 次要信息,薄一点 |
| Q3 | Dialog overlay | **scrim(50–55% 黑)**,无 blur;card 居中,圆角 12px |
| Q4 | TitleBar 双击行为 | **只双击拖动区切换 max/restore**;按钮不双击 |
| Q5 | StatusBar 显示什么 | 左:tab 数 / pane 数 / 焦点 shell;右:版本号 / 留空;**M3 不显示 session exit**(避免太噪) |
| Q6 | tokens.css 加哪些 | **DESIGN.md §4 全量**,不只是 M3 用到的;为 M4/M5 预铺 |
| Q7 | TitleBar 拖动用哪个 | **`data-tauri-drag-region`** 属性(Tauri 官方支持,Windows 有效);不用 CSS `-webkit-app-region`(虽然也工作,后者不跨平台) |

## 6. tokens.css 完整版(diff 思路)

```css
:root {
  /* Surfaces (5) */
  --canvas, --canvas-soft, --surface-card, --surface-strong, --bg-hover, --bg-active
  
  /* Hairlines (3) */
  --hairline, --hairline-soft, --hairline-strong
  
  /* Text (5) */
  --ink, --body, --body-strong, --muted, --muted-soft, --text-on-accent
  
  /* Accent (1+soft) */
  --accent, --accent-hover, --accent-active, --accent-soft
  
  /* Semantic */
  --error, --error-soft, --warning, --warning-soft, --success, --success-soft
  
  /* Typography */
  --font-ui, --font-mono, --font-size-*, --line-height-*
  
  /* Spacing (9) */
  --space-xxs, --space-xs, --space-sm, --space-base, --space-md, --space-lg, --space-xl, --space-xxl, --space-section
  
  /* Radius (5) */
  --radius-xs, --radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-pill
  
  /* Overlay */
  --overlay
}
```

完整值按 DESIGN.md §4 一一对应。

## 7. Tauri 配置变更

### `tauri.conf.json` `app.windows[0]`

```json
{
  "title": "xsterm",
  "width": 1280,
  "height": 800,
  "minWidth": 480,
  "minHeight": 320,
  "decorations": false,
  "titleBarStyle": "Transparent",
  "transparent": true
}
```

(`titleBarStyle: "Transparent"` 仅 macOS 有意义,Windows 用 `decorations: false` 即可去掉 OS title bar。)

### `capabilities/default.json` `permissions`

加:
```
"core:window:allow-minimize"
"core:window:allow-maximize"
"core:window:allow-unmaximize"
"core:window:allow-close"
"core:window:allow-is-maximized"
"core:window:allow-start-dragging"
```

(参考 ref/xsterm/AGENTS.md。)

## 8. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| `decorations: false` 移除 resize 边框 | 窗口不能拖边放大 | `tauri.conf.json` 加 `minWidth/minHeight`;resize 由用户拖 TitleBar bottom edge 体验稍弱,M4 补 |
| `getCurrentWindow` 在 webview dev (非 Tauri) 抛 | 浏览器里 TitleBar 按钮报错 | `if (window.__TAURI_INTERNALS__)` 守卫;不守卫就 try/catch |
| tokens.css 一次写 50+ 变量,易错 | 颜色值跟 DESIGN.md 不一致 | 严格从 DESIGN.md §4 复制粘贴;grep 验证 |
| TitleBar 拖动 + 双击 = OS 行为冲突 | 拖动区双击可能不是 toggleMaximize | 用 Tauri `getCurrentWindow().onResized` 监听;测试两个交互 |
| 字体 fallback | Inter 没装时丑 | 栈 `"Inter", "Segoe UI", system-ui, ...` 已正确;不加 `@font-face` |

## 9. 实施顺序

1. `view/styles/tokens.css` 补全(DESIGN.md §4 逐项)
2. `tauri.conf.json` + `capabilities/default.json` 改
3. `view/components/TitleBar.tsx/css` + `view/hooks/useWindowControls.ts`(L4 内 R1 例外的口子)
4. `view/components/StatusBar.tsx/css`(数据从 `usePaneTree` 读 tab 数 / pane 数 / 焦点 shell)
5. `view/components/Dialog.tsx/css`(纯 UI,无业务)
6. `view/App.tsx` 改 layout:`<TitleBar />` 顶 / `<TabBar />` / `<SplitContainer />` / `<StatusBar />` 底
7. `index.html` 改 title / favicon(用 1 行 inline SVG,简单)
8. 巡检所有 chrome 文件:`grep` 验证 V8(无 hex / 无 bold ≥ 600 / 无 box-shadow)
9. 静态验证:tsc / cargo check / npm run build / prettier / fmt
10. **你** Windows 跑 `./scripts/xsterm.sh dev`,验 V2–V9

## 10. 不在 M3 范围(避免 scope creep)

- 自定义 Settings 内容(M5)
- 主题切换(深/浅)— M5
- 字体打包(Inter / JetBrains Mono woff2)— 暂用系统 fallback
- 拖动窗口 resize 边缘 — M4 polish
- Dialog 实际内容(只搭壳)— M5

## 11. Definition of Done

- V1–V10 静态验证全过(grep + tsc + build)
- V11 index.html 标题和 favicon 都对
- 没有任何 chrome 文件写 hex(除了 `tokens.css` 唯一文件)
- `cargo fmt --check` + `prettier --check` clean
- 上一里程碑(M2)的 V1–V11 行为不退化(4 pane 仍然工作、reconnect 仍然工作)

---

## 修订记录

| 日期 | 变更 |
|---|---|
| 初版 | M3 设计系统蓝图:完整 tokens.css + TitleBar/StatusBar/Dialog |
