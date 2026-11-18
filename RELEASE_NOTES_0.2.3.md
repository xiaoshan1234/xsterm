# xsterm 0.2.3 发布说明

- 发布日期：2026-11-18
- 对比基线：`0.2.2`（`d994d93`）
- 发布代码基线：`0.2.3`（`4c424f6`）
- 变更规模：18 个提交、88 个文件，新增 5376 行、删除 2155 行

## 发布摘要

0.2.3 聚焦终端入口、tmux 生命周期、工作区可恢复性和端到端验证。本版本重新整理
NavBar 与 AppShell 的菜单和状态展示，增强 tmux 会话的重连、分组、WSL 传输与
尺寸同步，并补充真实 tmux TUI 的 E2E 覆盖。

现有保存配置、分组、Workspace、Window 快照和 Tauri 事件名保持兼容，无需手动迁移。

## 主要更新

### 导航与 Shell

- NavBar 新增 Terminal 菜单，可直接选择并打开已保存的终端配置。
- 统一 NavBar、Workspace 快速切换、帮助入口和 AppShell 状态展示。
- BottomBar RuntimeStatus 显示当前 Pane 的类型、连接状态、尺寸和层级信息。
- Manager 列表统一选中态、右键菜单和滚动区域行为。

### tmux 与终端生命周期

- 增强 tmux 控制器的创建、恢复、退出和重连流程。
- 支持 tmux 会话按基础配置自动分组。
- 增加 WSL 与多种 tmux 传输方式的支持。
- 同步 tmux Window、Pane 几何信息与前端 Pane 树尺寸。
- 修复 tmux detach 后 Workspace 未保留可用初始 Window 的问题。
- 忽略 tmux 泄漏的设备属性回复，避免污染终端输出。
- 优化终端输出缓冲，减少高频 Tauri IPC 写入。

### E2E 与测试环境

- 新增真实 tmux TUI 的 WebView E2E 流程及 tmux shim 测试环境。
- 增加 tmux TUI 回放测试和终端输出路由测试。
- 新增残留测试进程清理脚本。
- 本地 E2E 运行时和产物继续由 `.gitignore` 排除。

### 文档

- 同步更新 `DESIGN.md`、`UI_COMPONENTS.md` 和 `AGENTS.md` 中的 Shell、tmux 状态及
  布局约定。

## 兼容性

- Local、SSH 和 tmux 保存配置沿用现有 schema。
- 分组、Workspace、Window 快照保持现有持久化格式。
- `terminal-*`、`tmux-*` 以及会话输出订阅命令保持兼容。
- SSH host-key 校验仍按当前发布策略保持关闭。
- 本版本未引入 MCP 或 AI 接管相关功能。

## 发布验证

以下命令应在 Windows 工具链下执行：

```powershell
npm run format
npm run build
npm test
npm run lint
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- `npm run format`：通过。
- `npm run build`：通过，244 个模块完成生产构建。
- `npm test`：48 个测试文件通过，319 个用例通过，1 个既有 todo。
- `npm run lint`：0 个错误；10 个既有 Hook 依赖警告。
- `cargo fmt`：通过。
- `cargo test`：62 个用例通过，2 个需要 WSL2/tmux 的用例按设计忽略。
