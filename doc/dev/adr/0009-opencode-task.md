# opencode 任务：tmux-control-window 落地

> **任务说明**：按照 ADR `doc/dev/adr/0009-tmux-control-window.md` 实施 xsterm tmux-control-window 功能。ADR 是 source of truth，下面只是任务分阶段 + 文件级指引。**所有字段名 / 命令名 / 事件名 / UI 文案以 ADR 为准**。

## 0. 项目基础

> 用户原始需求文本：`doc/dev/adr/0009-tmux-control-window.md` —— 用户原始 brainstorm 的来源（**不作为 source of truth**）。所有决策以本 ADR 为准（已校正术语和范围）。

- 仓库根：`/mnt/c/Users/LONER/1111/prj/xsterm`
- dev 分支，当前 commit 干净
- 技术栈：Tauri 2 + React 19 + TypeScript 5.8 + Vite 7 + Rust 1.75+
- **WSL 环境，构建必须用 Windows 工具链**：
  - 前端构建：`powershell.exe -NoProfile -Command "Set-Location 'C:/Users/LONER/1111/prj/xsterm'; npx tsc --noEmit"` / `npx vite build`
  - 后端构建：`cargo.exe check --manifest-path src-tauri/Cargo.toml --lib` / `cargo.exe test --manifest-path src-tauri/Cargo.toml --lib`
- 设计系统：`doc/design-system.md` 必读，UI 改动前 grep `AGENTS.md` "Pre-commit verification" 三条

## 1. ADR 路径

`doc/dev/adr/0009-tmux-control-window.md` —— **先完整读完再开工**。所有决策（数据模型 / 关闭语义 / 事件 / 默认假设）都在那里。

## 2. 改动清单（按依赖顺序执行）

### Phase A：数据模型 + 类型（无行为变更）

1. `src/types/session.ts`
   - `Window` 接口：新增 `windowType: "tmux-control"` 枚举值、`tmuxControlWindowId?: number`、`tmuxControlName?: string`
   - `xstermWindowId` 注释更新：明确"仅普通 tmux-window 携带，control-window 不带"
   - 新增 `TmuxWindowListEntry` interface（如果还没有；用于 windows-control 区列表）

### Phase B：后端 3 个新命令

2. `src-tauri/src/services/tmux/protocol/wire.rs` 或 `commands.rs`
   - 新增 wire builders：`detach_client(session_name)`、`kill_server()`
   - 写单测（参考 `send_keys_quotes_payload_with_whitespace` 风格）

3. `src-tauri/src/commands/session.rs`
   - 新增 Tauri 命令：
     - `detach_tmux_controller(controller_id: u32)` —— fire-and-forget：找到 controller，写 `detach-client -s <name>` 到 stdin，等 controller 自杀（`tmux-controller-exit` 事件自然 cleanup）
     - `kill_server_via_controller(controller_id: u32)` —— fire-and-forget：写 `kill-server` 到 stdin
     - `unmark_attached_tmux(controller_id: u32)` —— 直接从 `attached_tmux.json` 删一条
   - 在 `all_handlers()` 中加这三个

4. `src-tauri/src/services/session_manager.rs`
   - 实现上面三个命令的内部逻辑
   - 单测：mock controller、验证 detach-client 被正确入队 + unmark 从 store 删除

5. `src-tauri/src/commands/session.rs` —— 注册到 Tauri handler 列表

### Phase C：前端服务包装

6. `src/services/sessionService.ts`
   - 新增 `detachTmux(controllerId: number)`
   - 新增 `killServerViaController(controllerId: number)`
   - 新增 `unmarkAttachedTmux(controllerId: number)`
   - `createTmuxWindow` 加可选 `name?: string` 参数（windows-control 新建带名字）

### Phase D：核心行为（关键路径）

7. `src/contexts/session/useTauriListeners.ts`
   - `tmux-window-list` listener（**新增**）：维护 `controllerId → { controlWindowId, windows: TmuxWindowListEntry[] }` ref
   - `tmux-window-added` listener（**修改**：src/contexts/session/useTauriListeners.ts:320-415）：
     - 找 target workspace（同 controller 的 windows 所在）
     - **若**该 workspace 没有 `tmuxControlWindowId === controllerId` 的 control-window，先插入一个
     - 再追加普通 window
   - `tmux-controller-detached` listener（**新增**）：关闭同 controller 下所有 xsterm Window

8. `src/contexts/session/useSessionLifecycle.ts`
   - `createAndActivateSession`（src/contexts/session/useSessionLifecycle.ts:155-169）：
     - **删除** tmux-cc → `createWorkspaceFromSession` 分支
     - 改为：tmux-cc 走 `createDefaultWorkspace()`（若活动 workspace 不存在）+ 插入 control-window 到活动 workspace
   - 活动 workspace 不存在时调 `createDefaultWorkspace()`

9. `src/contexts/session/useWindowActions.ts`
   - `closeWindow`（src/contexts/session/useWindowActions.ts:161-209）三分支：
     1. `window.windowType === "tmux-control"`：
        - 遍历同 workspace 内 `xstermWindowId !== undefined` 的 window
        - 每个调 `closeSession` 关 leaf pane
        - 删 control-window 自身
        - 调 `unmarkAttachedTmux(controllerId)`
     2. `window.xstermWindowId !== undefined`（普通 tmux-window）：仅 `closeSession` leaf panes（**不**调 `kill_tmux_window`，**不**改 attached_tmux.json）—— 当前行为保持
     3. 其他：当前行为
   - `renameWindow`：若 `window.xstermWindowId !== undefined` → 调 `renameTmuxWindow(xid, name)`；前端 state 不立即改（等 `tmux-window-renamed` 事件回写）
   - `createWindow`：加可选参数 `tmuxControlWindowId?: number`；若提供 → 调 `createTmuxWindow(controllerId)`

### Phase E：UI 组件

10. `src/components/TmuxControlWindowView.tsx` + `.css`（**新增**）
    - 入口 props：`window: Window`、`controllerId: number`、`tmuxControlName: string`
    - 两区并排：
      - 左 `TmuxSessionControl`：状态 + 3 按钮（Disconnect / Reconnect / Remote delete）
      - 右 `TmuxWindowsControl`：列表 + Rename/Disconnect/Delete + "+ New Window" 按钮
    - 状态从 useTauriListeners 的 ref 拿

11. `src/components/TmuxSessionControl.tsx` + `.css`（**新增**）
    - props：`controllerId`、`onDisconnect`、`onReconnect`、`onRemoteDelete`
    - 三个按钮 → 调 service + 错误时 `window.alert()`

12. `src/components/TmuxWindowsControl.tsx` + `.css`（**新增**）
    - props：`controllerId`、`windows: TmuxWindowListEntry[]`
    - 每行三个 icon button + rename prompt
    - "+ New Window" 按钮 → `window.prompt("New window name:", "")` → `createTmuxWindow(controllerId, name)`

13. `src/components/WorkspaceContainer.tsx`（src/components/WorkspaceContainer.tsx:126-146）
    - render 分支：`window.windowType === "tmux-control"` → 渲染 `<TmuxControlWindowView />`
    - `onAdd` 处理：传当前活动 window 的 `tmuxControlWindowId`（若有）给 `createWindow`，让"+" 按钮在 control-window 区域下变成 `createTmuxWindow`

14. `src/components/WindowTabBar.tsx`
    - `WindowTab`：检测 `window.windowType === "tmux-control"` → tab 名称加 `▶ ` 前缀
    - `onCloseWindow` / `handleDoubleClick`：control-window 触发前 `window.confirm(...)` 防误关
    - 不动 drag-reorder、其它 tab 行为

15. `src/components/Pane.tsx` + `src/components/paneContextMenu.ts`（src/components/paneContextMenu.ts:72-78）
    - 文案 "Close Tmux Window" → "Delete from tmux server"
    - 不动其它 item

### Phase F：ADR README 索引

16. `doc/dev/adr/README.md`
    - Index 表追加：`[0009](0009-tmux-control-window.md) | tmux-control-window：workspace 顶部挂 session/window 控制 UI | Accepted (待落地)`

### Phase G：验证

```
cd /mnt/c/Users/LONER/1111/prj/xsterm

# 前端类型检查
powershell.exe -NoProfile -Command "Set-Location 'C:/Users/LONER/1111/prj/xsterm'; npx tsc --noEmit"

# 前端构建
powershell.exe -NoProfile -Command "Set-Location 'C:/Users/LONER/1111/prj/xsterm'; npx vite build"

# 后端 check + test
cargo.exe check --manifest-path src-tauri/Cargo.toml --lib
cargo.exe test  --manifest-path src-tauri/Cargo.toml --lib
```

**全绿才能算完成**。

### Phase H：Pre-commit UI 验证

如果改了 `src/components/**/*.css`，跑 AGENTS.md §"Pre-commit verification" 三条 grep：

```bash
# 1. 禁用 token / VSCode 蓝 / 渐变
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/components/ --include="*.css"

# 2. chrome 上无 font-weight 600+
grep -rn "font-weight: ?(600|700|bold)" src/components/ --include="*.css"

# 3. box-shadow 只允许 doc/design-system.md §10.2/§10.3 列出的 5 例
grep -rn "box-shadow:" src/components/ --include="*.css"
```

(1)(2) 必须 0 匹配；(3) 只能匹配 5 个允许位置；新加的必须在 ADR 或 doc 注释里登记。

## 3. 实施约束

- **不**改 tmux controller 内部（`src-tauri/src/services/tmux/controller/*`）—— 这是 v0，纯前端 + service 边界
- **不**改 `dispatch.rs` —— 已有 `tmux-window-list` 事件足够
- **不**碰 `attached_tmux.json` 的 schema —— 只增删条目
- 所有新文件遵循现有命名风格：`src/components/<Name>.tsx` + `<Name>.css`
- UI 颜色 / 圆角 / hairline 用 `var(--...)` token，**不**写 hex / rgb
- Rust 错误用 `TmuxError` 变体，**不**返 `String`（除非边界必要）
- Rust 单测用 `mockall`（已有 `PtySystem` / `PtyPair` / `Child` / `SshBackend` 的 mock 模板）
- TS / TSX 单测文件命名 `*.test.ts(x)`，用项目现有的 vitest 配置（如果有）
- 提交前 **不** commit（AGENTS.md 规则），把改动留在工作树交付

## 4. 交付格式

任务完成后输出一份交接，包含：
- 改动的文件清单（新增 / 修改）+ 关键 diff 摘要
- `cargo.exe check` / `cargo.exe test` / `npx tsc --noEmit` / `npx vite build` 四条命令的**实际输出**（贴最后 5 行）
- Phase H 三条 grep 实际结果
- 任何 **未完成** / **偏离 ADR** / **新发现风险** —— 明说，不要藏
- 任何对 ADR A1-A9 默认假设的偏离 —— 先停下来问用户，不要擅自改

## 5. 不要做

- 不要 commit
- 不要 push
- 不要碰 `.env` / 凭证文件
- 不要新增 / 删除后端命令超过 ADR §2.9 规定的 3 个
- 不要改 design-system.md / 现有颜色 token
- 不要在 dev 真实环境跑 `tauri dev`（留给 tm 验收）
- 不要把"vs iTerm2 怎么怎么"等竞品讨论写到代码注释里