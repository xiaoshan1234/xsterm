# xsterm 0.2.2 发布说明

- 发布日期：2026-11-11
- 对比基线：`0.2.1`（`329c624`）
- 发布代码基线：`0.2.2`（`b7a0289`）
- 变更规模：18 个提交、114 个文件，新增 3796 行、删除 794 行

## 发布摘要

0.2.2 是一次以终端交互效率、tmux 可观测性和会话输出性能为核心的版本。本版本新增
可调速的全局 Sender，完善 tmux 状态树、窗口尺寸同步与 TUI 恢复，支持 SSH/tmux
剪贴板图片粘贴，并将终端原始输出改为按会话订阅的二进制通道。

现有会话、分组、Workspace、tmux 配置和 Tauri 事件名保持兼容，无需手动迁移数据。

## 主要新功能

### 全局 Sender

- 新增多标签文本输入，可在发送前新增、切换和关闭输入标签。
- 支持显式选择本地 Pane 或 tmux Pane，并显示终端标题、状态和带 Window 序号的
  breadcrumb，例如 `1. Main`。
- 支持按行和按字符两种发送模式，两种模式分别保存发送速率。
- 按行模式逐行发送并用 CR 模拟 Enter；按字符模式按 Unicode code point 发送，
  换行同样转换为 CR。
- 发送过程中可暂停、继续或取消，并显示待发送数量、实时进度、完成状态和错误信息。
- Sender 面板默认高度 400px，可拖拽或使用方向键在 180–720px 范围内调整，并持久化到
  `ui-shell.json`。
- BottomBar 入口调整为左侧 `Sender` 按钮，打开时具有明确的活动状态。

### tmux 状态与管理

- tmux 状态面板升级为可折叠的会话、Window、Pane 三层树，显示连接状态、Window/Pane
  序号、尺寸、当前命令和 Active Pane。
- 增加真实 tmux 会话名、tmux Window ID、Pane ID、Window 名称及 Pane 元数据同步。
- 支持从状态面板聚焦指定 Pane，并可从会话行执行 Detach。
- tmux 控制客户端的尺寸会跟随 xsterm Pane 树同步，`%layout-change` 事件会合并刷新，
  解决附加窗口长期停留在启动尺寸的问题。
- 附加已有 tmux 会话时会枚举全部 Window 和 Pane；布局变化后会更新前端几何信息。
- 新增 alternate-screen 捕获与回放：重新挂载包含 vim、less、htop 等 TUI 的 Pane 时，
  可恢复主屏和 TUI 备用屏，而不是显示到错误的终端缓冲区。

### 图片粘贴

- SSH 会话支持从剪贴板读取图片并上传到远端临时目录，然后将图片路径写入终端。
- SSH tmux Pane 使用相同远端上传流程；本地 tmux Pane 写入本机临时目录并插入路径。
- 剪贴板读取优先使用浏览器 `ClipboardEvent`，失败时回退到 Tauri clipboard manager，
  并将 RGBA 位图重新编码为 PNG。
- 上传文件使用安全的小写扩展名；缺失或不安全的扩展名回退为 `.png`。
- 兼容部分 SSH 服务端先发送 EOF、后发送退出状态的行为，避免图片上传被误判为失败。

### Manager 与 Workspace

- Terminal、Terminal Status、Tmux、Window 和 Workspace Manager 统一了列表选中态与
  右键上下文菜单。
- Terminal Manager 新增 Delete Group 操作，并保留默认分组保护。
- Manager 行支持单击选中、双击打开；鼠标右键打开操作菜单。
- Workspace 快速切换菜单支持关闭非 Default Workspace。
- 统一 Manager Footer、滚动区域和滚动条样式，操作按钮不再随列表内容滚动。

### 品牌与资源

- 更新 XSTerm M 波形品牌标识及桌面、Windows Store、Android 图标资源。
- 移除未使用的 React 默认 SVG 资源。
- 同步更新 `UI_COMPONENTS.md` 中 GlobalTextSender、tmux 状态和布局契约说明。

## 性能与可靠性

- 每个终端会话通过 `subscribe_terminal_output` 订阅独立 Tauri `Channel`，后端直接发送
  原始字节，前端以 `ArrayBuffer` 接收，移除逐字节 JSON 数组序列化开销。
- 会话关闭时通过 `unsubscribe_terminal_output` 释放通道；旧订阅的延迟注销不会误删
  新订阅，兼容 React StrictMode 的重复挂载流程。
- 后端将终端输出合并为最多 64 KiB、约 8ms 的批次，减少 IPC 调用与前端写入频率。
- 主动 Detach tmux 会话时不再显示为意外控制器退出错误。
- 新增终端输出路由、tmux ID/元数据、布局刷新、图片路径、Sender 发送流程和 Manager
  交互相关单元测试。

## 兼容性与升级

- 保存的 Local、SSH、tmux 会话配置可直接沿用，无 schema 迁移。
- 分组、Workspace、Window 快照和 `ui-shell.json` 结构保持兼容。
- 原有 `tmux-*` 和终端生命周期事件名未更改；新增
  `subscribe_terminal_output`、`unsubscribe_terminal_output`、
  `resize_tmux_window` 和 `detach_tmux_session` 命令。
- SSH host-key 校验仍按当前发布策略保持关闭。
- 图片粘贴只适用于 SSH 终端和 tmux Pane；普通本地终端不提供远程上传能力。
- 本版本未引入 MCP 或 AI 接管功能，也未新增 profile、reverse-tunnel 等能力。

## 发布验证

以下命令在 Windows 工具链下执行：

```powershell
npm run format
npm run build
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- `npm run format`：通过。
- `npm run build`：通过，245 个模块完成生产构建。
- `npm test`：41 个测试文件通过；288 个用例通过，1 个既有 todo。
- `npm run lint`：0 个错误；13 个既有 Hook 依赖警告，与本次发布文档和版本号修改无关。
- `cargo fmt`：通过。
- `cargo test`：49 个用例通过，0 个失败。
