# Bug 001
## 现象
对pane进行垂直/水平split会导致原pane的内容丢失
## 理想效果
split不会导致原来的 pane 内容丢失
## BUG 原因
pane split 时 React 会重新 mount 原 pane 的 Terminal 组件，xterm.js 实例被销毁并重新创建，导致之前的历史输出无法保留。
## 解决方案
1. 新增 `src/utils/sessionOutputBuffer.ts`，按 session 维护一个原始输出缓冲区。
2. 在 `useTauriTerminalOutput` 中把收到的后端输出同时追加到该缓冲区，并在 Terminal 重新挂载时先重放缓冲区内容，再开始接收新事件。
3. 在 `useSessionActions` 中关闭 session 时（`closeSession`、`closePane`、`closeWindow`、`closeWorkspace`、`reconnectSession`、`removeConfig` 等）清理对应缓冲区，避免内存泄漏。
## 是否解决
YES

# Bug 002 
## 现象
从select session 点击多次option 会创建多个session.
## 理想效果
请修改为一次最多创建一个，如果失败，显示提示.
## BUG原因
SelectSessionDialog 中的每个 option 按钮直接调用 onSelectSession/onSelectConfig，没有做并发/重复点击保护。快速点击时，同一个保存配置会多次调用 `createSessionFromSavedConfig`，导致后端重复创建多个 session；同时已存在的 session 也可能被重复绑定到 pane。
## 解决方案
1. 在 SelectSessionDialog 增加 `disabled` 属性，在创建/绑定过程中禁用所有 option 按钮。
2. 在使用 SelectSessionDialog 的两个父组件（PaneInitCard、Pane）中维护 `isSubmitting` 状态，并使用同步的 ref 锁（`isSubmittingRef`）作为第一道防线，确保第一次点击后立即拦截后续点击。
3. 对 onSelectSession/onSelectConfig 的异常进行统一捕获：已占用的 session 保留原有提示，其他失败通过 `window.alert` 提示用户。
## 是否解决
YES

# Bug 003
## 现象
在xterm终端中粘贴一次，输入内容出现双倍数据。
## 理想效果
粘贴一次应该只输入一次数据，不应重复。
## BUG原因
前期修复（本 Bug 原方案）通过 `lastKeyboardPasteRef` 阻止了键盘快捷键粘贴（`Cmd+V`/`Ctrl+Shift+V`/`Shift+Insert`）与浏览器原生 `paste` 事件的重复发送。但在实际运行中，即使非键盘触发的粘贴（如 `Ctrl+V`、右键粘贴），浏览器原生 `paste` 事件仍可能同时触发两条数据路径：
1. 文档级 `handlePaste` 处理函数读取剪贴板并调用 `writeSession` 发送数据；
2. xterm.js 的 `onData` 事件处理器也会收到同样的粘贴内容，并再次调用 `writeSession`。
`Terminal.tsx` 中 `onData` 原有的 30ms 去重窗口无法覆盖两条路径之间的实际时间差（日志中观察到约 31ms），导致后端收到两次 `writeSession` 调用，回显后终端出现双倍内容。
## 解决方案
1. 在 `src/components/Terminal.tsx` 的 `handlePaste` 中，处理文本粘贴时调用 `e.stopPropagation()`，阻止 `paste` 事件继续传播到 xterm.js 的 textarea，避免 xterm 内部路径触发 `onData`。
2. 在 `handlePaste` 发送文本后，以及键盘快捷键粘贴的 `readText().then()` 回调发送文本后，更新 `lastDataRef.current = { text, time: Date.now() }`，让后续可能到达的 `onData` 事件被去重逻辑拦截。
3. 将 `onData` 去重时间阈值从 30ms 提高到 100ms，覆盖粘贴两条路径之间的典型时间差。
## 是否解决
YES

# Bug 004
## 现象
打开 opencode 后，session 断开并重新连接，此时在重新连接的 session 上移动鼠标，终端出现乱码。
## 理想效果
重新连接后移动鼠标不应出现乱码，应正常处理或不产生额外字符输出。
## BUG原因
重新连接（`reconnectSession`）会在后端创建一个全新的 PTY/SSH session（新的 sessionId），但前端的 xterm.js 实例是同一个对象，仍然保留着旧 session 的终端模式状态（如鼠标追踪模式）。当用户移动鼠标时，xterm.js 继续按照旧模式生成鼠标事件转义序列并发送给新 PTY；而新 PTY 没有启用对应鼠标模式，这些转义序列被当作普通字符回显到终端，于是出现乱码。原先代码在 sessionId 变化时只调用了 `xterm.clear()`，它只清屏并不会重置 xterm 内部的模式状态。
## 解决方案
在 `src/components/Terminal.tsx` 的 sessionId 变化 effect 中，将 `xterm.clear()` 替换为 `xterm.reset()`。`reset()` 相当于 RIS（Reset to Initial State），会清除屏幕并重置 xterm 的所有内部模式状态，使前端 xterm 实例与全新的 PTY session 状态保持一致，避免旧 session 的鼠标模式继续生效。
## 是否解决
YES

# Bug 005
## 现象
在终端中输入字符时存在明显延迟，部分字符被静默丢弃（例如长按同一键时只有少量字符到达、快速连打相同字符时第二个被吃掉），整体感觉"输入太慢/漏字符"。
## 理想效果
键入字符应该几乎即时到达 PTY/SSH 后端，肉眼无明显延迟；OS 长按 autorepeat 和快速连打相同字符都不应被吞；与系统终端 iTerm2、Windows Terminal 同级别。
## BUG原因
两层叠加：

1. **`xterm.onData` 的字符级时间去重窗口（曾为 100ms）** (`src/components/Terminal.tsx`)：`last.text === data && now - last.time < N` 这一条件会把任何"N 毫秒内同字符"的二次触发静默丢弃。这个窗口从 Bug 003 的 30ms → 100ms（覆盖观察到的 31ms 粘贴双路径间隔），副作用是吞掉 OS 长按 autorepeat 的 ~67% 重复键和快速连打 `aa`/`nn` 等同字符输入。Bug 003 同时加上了 `handlePaste` 里的 `e.stopPropagation()` 作为主防线，但后续分析意识到 stopPropagation 已经足够，时间窗口作为冗余保险并不必要：
   - Bug 003 的 stopPropagation 在 document 级 capture 阶段调用，能阻止事件到达 target（xterm textarea）的 handlers；
   - 如果 stopPropagation 真的失效，时间窗口也救不了 — 失效可能发生在任何延迟（同步到几百毫秒）；
   - 所以这个"保险"既不必要，也不充分。
2. **`sessionService.writeSession` 在热路径上调用 `logger.debug`** (`src/services/sessionService.ts:27,31`)：dev 模式下 `LoggerContext.debug` 同步执行 `console.debug(...)` + 序列化数据，并额外发起一次 `invoke("log_message", ...)` IPC，把每次按键的输入内容写到 Rust 日志。dev 模式下每次按键 = 1 次 `write_session` IPC + 1 次 `log_message` IPC + 控制台序列化开销。

~~【已撤回】rAF 输入批处理 + 10ms dedup~~：曾考虑通过 `requestAnimationFrame` 合并每帧按键和缩小 dedup 窗口，被实施并回滚。原因：
- rAF 批处理在正常打字场景（≥80ms/字符）下字符本就跨多帧，调度只是把发送时机推迟 0-16ms 而不减少 IPC 次数，纯粹引入延迟；
- 缩小 dedup 窗口只是把 Bug 003 的"猜一个合理时间"换成"猜一个更紧的时间"，本质问题没解决；
- 两个机制的合理解都是"相信 stopPropagation"，既然如此就把它们一起去掉。
## 解决方案
1. `src/components/Terminal.tsx`：删除 `xterm.onData` 内的字符级时间去重逻辑，包括 `lastDataRef` ref 的 declaration、onData 里的 dedup 检查、3 处 paste 路径里 `lastDataRef.current = { text, time: ... }` 的赋值。完全信任 Bug 003 的 `e.stopPropagation()`。onData 现在直接：聚焦检查 → 连接检查 → localEcho (可选) → `writeSessionRef.current(sessionId, data)`，无任何过滤。
2. `src/services/sessionService.ts`：移除 `writeSession` 内两个 `logger.debug` 调用，把 `async/await invoke(...)` 改为 `return invoke(...).then(...)` 的 fire-and-forget 形式。返回类型仍为 `Promise<void>` 以兼容 `CommandSendPanel` 中已有的 `.catch(...)` 链式调用。

**未动 → flag-based → 已用 preventDefault 彻底简化**：原本的 `lastKeyboardPasteRef` 时间窗口 → flag → 全部移除。键盘粘贴 handler 现在**只**为 `Ctrl+Shift+V` 这种浏览器默认不合成 paste 事件的快捷键服务（`src/components/Terminal.tsx:155-165`）；`Cmd+V`/`Ctrl+V`/`Shift+Insert` 这些浏览器默认会合成 paste 事件的快捷键**完全不进键盘 handler**，让浏览器合成 paste 事件 → document handler 处理 —— 这样 document handler 才能拿到 clipboardData 里的 `text` 和 `files` 两类数据，**恢复 SSH 图片粘贴功能**。

`preventDefault()` 是个二元操作：要么全阻止要么全放行，没办法区分剪贴板里是文本还是图片。所以只能针对"浏览器本来就不合成 paste 事件"的快捷键用 preventDefault，对"浏览器默认会合成"的快捷键必须让事件触发，让 document handler 自己读完整的 clipboardData。

三条 paste 路径 → 两条互斥路径：
- **键盘 handler 路径**：`Ctrl+Shift+V` 唯一，因为浏览器不为它合成 paste 事件
- **document handler 路径**：`Cmd+V`/`Ctrl+V`/`Shift+Insert`/右键/浏览器菜单，全部统一走这里

不再需要任何 flag、queueMicrotask、时间窗口或"猜延迟"的去重机制。
## 是否解决
YES

# Bug 006
## 现象
在 UI 创建 SSH session 时，后端返回错误 `invalid args 'config' for command 'create_session': missing field 'authType'`，session 创建失败。
## 理想效果
前端通过 CreateSession的 SSH tab 提交配置后，`create_session` Tauri 命令应能成功反序列化配置并创建 SSH session，无 IPC 反序列化错误。
## BUG 原因
后端 `SSHSessionConfig` 的 `auth` 字段（`src-tauri/src/models/session.rs:67-103`）通过 `#[serde(flatten)]` 嵌入了一个 `SSHAuth` tagged enum（`session.rs:129-139`），该 enum 使用 `#[serde(tag = "authType", rename_all = "camelCase")]`。serde 反序列化时，`SSHAuth` 的 enum 判别 tag `authType` 成为 `SSHSessionConfig` 的必需字段。

前端 `SSHSessionConfig`（`src/types/session.ts:84-118`）和 spec 文档（`doc/requirements/prd-0.1/create-session-config.md:112-117`）都把认证字段定义为扁平结构：`auth_type: "password" | "key"` + 独立 `password` / `key_file` / `passphrase`。前端发送的 JSON 形如 `{ "auth_type": "password", "password": "..." }`，但后端期望 `{ "authType": "password", "password": "..." }` —— 缺少 `authType` tag，serde 直接抛错。

该不匹配在 commit `7dbfa27`（feat(rust): mirror spec fields to backend structs + Default derive + test fixture update）引入新 `SSHAuth` enum 时出现，TypeScript 侧、spec 文档、表单、持久化层均未同步更新。
## 解决方案
1. 删除 `src-tauri/src/models/session.rs` 中的 `SSHAuth` enum。
2. 将 `SSHSessionConfig.auth: SSHAuth` 字段替换为 4 个扁平字段：`auth_type: String`、`password: Option<String>`、`key_file: Option<String>`、`passphrase: Option<String>`。在 `auth_type` 和 `key_file` 字段上加 `#[serde(rename = "...")]` 覆盖 `rename_all = "camelCase"`，保留 snake_case JSON key。
3. 在 `SSHSessionConfig` 上加 `#[serde(deny_unknown_fields)]`，使旧 `authType` payload 被显式拒绝（不静默通过）。
4. 更新 `Default` impl 用 `auth_type: "password".to_string()`。
5. 更新 `models/session.rs::mod tests` 中所有 11 处 serde roundtrip 测试的 fixture 语法。
6. 新增 2 个回归测试：`ssh_session_config_deserializes_flat_auth_type_field` 和 `ssh_session_config_deserializes_key_file_auth`，覆盖前端实际发送的 JSON 形状。
7. 更新 `infrastructure/ssh.rs::authenticate` 函数（`ssh.rs:500-530`）：签名从 `(handle, username, &SSHAuth)` 改为 `(handle, &SSHSessionConfig)`，body 用 `match config.auth_type.as_str() { "password" => ..., "key" => ..., _ => Err(...) }`；密码/key-file/passphrase 直接从 `config.password` / `config.key_file` / `config.passphrase` 读取。
8. 更新 `services/session_manager.rs` 中 7 处 mockall fixture 的语法。
9. 保持前端、spec 文档、持久化层、表单代码均不动（它们本来就与 spec 一致）。

修复 commit: `e42cec4 fix(ssh-config): flatten SSHAuth enum to match spec/frontend payload`
## 是否解决
YES

# Bug 007
## 现象
`isSessionUsedInOtherWindow(workspaces, currentWorkspaceId, currentWindowId, sessionId)` 在"session 只存在于当前窗口"的情况下错误地返回 `true`。新增的单元测试套件（`src/contexts/session/paneUtils.test.ts`）中对应用例被标记为 `.todo` —— 其期望值为 `false` 而当前实现返回 `true`。
## 理想效果
仅当 `sessionId` 出现在一个**不是**当前 workspace/window 的窗口中时返回 `true`；当 session 仅存在于当前窗口时返回 `false`；当 `currentWorkspaceId` 或 `currentWindowId` 为 `null` 时维持现有语义（视为"无当前窗口"，找到即返回 `true`）。
## BUG原因
`src/contexts/session/paneUtils.ts` 第 174–188 行。函数遍历 `workspaces[].windows[]`，对**第一个**含目标 session 的窗口立即 `return true`，完全跳过了与 `currentWorkspaceId` / `currentWindowId` 的比对。文档注释明确说"any window other than the currently active one"，但实现里的早返回路径没有遵循该约束。
## 解决方案
在含目标 session 的窗口命中分支中，按以下顺序判断：
1. 若 `currentWorkspaceId === null || currentWindowId === null`，按现有语义返回 `true`；
2. 若 `workspace.id === currentWorkspaceId && window.id === currentWindowId`，`continue` 到下一个窗口；
3. 否则返回 `true`。
循环结束后返回 `false`。修复后把测试文件里的 `it.todo("isSessionUsedInOtherWindow returns false when session is only in the current window")` 改回 `it(...)`，断言期望值 `false`，验证全绿。
## 是否解决
NO

# Bug 008
## 现象
主工作区（workspace 容器）只占屏幕左侧约 40% 宽度，剩余约 60% 是空白背景。窗口越窄空白越明显，800×600 时主区只剩 ~350px。
## 理想效果
主工作区应占满 sidebar 之外的全部可用宽度。
## BUG原因
`src/components/AppLayout.tsx` 第 99-108 行 `workspaces.map` 外层 Box 缺 `flexDirection: column`。父级 `Box`（包含 sidebar + workspaces + WorkspaceBottomBar）正确设了 `flexDirection: column`，但 workspaces map 出来的 Box 没有指定方向，默认 `flexDirection: row`，导致 `<WorkspaceContainer>`（其内部是 `display:flex, flexDirection:column`）在 row 方向上只取自然宽度（≈TabBar + +/save 图标宽度 ≈ 350px），而不是 `flex: 1` 应有的拉伸宽度。
## 解决方案
给该 Box 加上 `flexDirection: "column"` 和 `minWidth: 0`，使 WorkspaceContainer 在 cross axis（width）上能正确填满父容器。
## 是否解决
YES

# Bug 009
## 现象
系统偏好为浅色时，AppBar / Drawer / SettingsView 走 MUI 浅色主题（白底），但 `PaneInitCard` / `InitWindowView` / `Pane` 等组件仍显示深色背景——出现"半白半黑"的撕裂 UI。把 Chrome theme 切到 Light 即可复现。
## 理想效果
任意 Chrome theme（system / dark / light）下，所有面板（AppBar、Drawer、Workspace、Pane 容器、Card）的背景、文字、边框都跟随同一个主题。
## BUG原因
`src/theme/globalStyles.tsx` 在 `MuiGlobalStyles` 里用 `:root { '--bg-primary': '#1e1e1e', ... }` 把这些 CSS 变量**硬编码为深色值**，不跟随 `effectiveMode`。组件里多处直接引用 `var(--bg-*)`（如 `PaneInitCard`、`InitWindowView`、`Pane`），所以即便 MUI 切到 light，这些组件仍然渲染深色。
## 解决方案
1. 删掉 `globalStyles.tsx` 里 `:root` 的 CSS 变量块。
2. 在 `src/main.tsx` 的 `ThemedApp` 中新增 `applyThemeCssVars(theme)`，通过 `useEffect` 在主题变化时把 MUI theme 派生的 CSS 变量写到 `document.documentElement.style`：
   - `--bg-primary / --bg-secondary / --bg-tertiary / --bg-hover / --bg-active` 从 `palette.background` 派生（light/dark 各自一套 hover/active 透明度）。
   - `--border-color` ← `palette.divider`
   - `--text-primary / --text-secondary / --text-muted` ← `palette.text`
   - `--accent / --accent-hover` ← `palette.primary`
   - `--accent-bg / --error-bg` ← 由 hex 转 `rgba(r,g,b, a)`（dark 0.15 / 0.1，light 0.08 / 0.08）保证浅色背景下也可见。
   - `--font-stack` ← `theme.typography.fontFamily`，`--font-mono` 保留 monospace fallback。
3. 修复后 dark/light 模式下 SettingsView 与 welcome 卡片背景、文字、边框全部跟随主题，CSS 变量通过 `getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')` 实测分别为 `#1e1e1e` / `#fafafa`。
## 是否解决
YES

# Bug 010
## 现象
新建窗口首次启动时默认 800×600，对终端模拟器来说太小，sidebar（48px）+ 左半边 workspace 实际只剩 ~350px 宽，根本看不清内容。
## 理想效果
首次启动时默认尺寸足以容纳 sidebar + workspace + 多 pane，例如 1280×800，并设置合理的最小尺寸防止窗口被拖到无法使用的大小。
## BUG原因
`src-tauri/tauri.conf.json` 第 16-17 行 `width: 800, height: 600`，无最小尺寸约束。
## 解决方案
改为 `width: 1280, height: 800`，并新增 `minWidth: 800, minHeight: 500`。
> 注意：tauri.conf.json 改动只在 Rust 二进制被重新构建后生效。开发态 xsterm.exe（已构建于 8 月 3 日）仍使用旧 800×600；本地可通过 `npm run tauri dev` 重启或在 WebDriver REPL 用 `driver.manage().window().setRect({width:1280, height:800})` 临时模拟新尺寸验证。
## 是否解决
YES

# Bug 011
## 现象
点击侧边栏 "New Session" 打开新建会话对话框时，整个应用崩溃（React 根节点卸载，窗口变空白）。
## 理想效果
新建会话对话框应正常打开，用户能创建本地/SSH 会话。
## BUG原因
`src/components/dialogs/LocalSessionForm.tsx` 第 93 行使用了 `<Typography variant="subtitle2">` 渲染 "Environment Variables" 标题，但第 2 行的 MUI import 语句中 **没有导入 `Typography`**。`CreateSessionDialog` 默认停在 "Local Shell" 标签页并渲染 `LocalSessionForm`，渲染时遇到未定义的 `Typography` 标识符抛出 `ReferenceError: Typography is not defined`。React 19 在无错误边界时卸载整个根节点，导致 `#root` 变空、应用崩溃。该问题也导致 `npm run build`（tsc）报 TS2304 失败，是生产级阻塞。
## 解决方案
在 `src/components/dialogs/LocalSessionForm.tsx` 第 2 行的 MUI import 中补上 `Typography`：
```diff
-import { Box, Button, MenuItem, Select, TextField, IconButton, FormControl, InputLabel, Stack } from "@mui/material";
+import { Box, Button, MenuItem, Select, TextField, IconButton, FormControl, InputLabel, Stack, Typography } from "@mui/material";
```
修复后重新运行 spike/UI 测试可正常创建本地会话。
## 是否解决
YES


# Bug 012
## 现象
每次新建本地 shell（PowerShell、bash 等）后，pane 顶部立刻出现橙色横幅 `Connection lost. Press Enter to reconnect.`，但 shell 提示符（`PS C:\Users\LONER>` 等）仍正常渲染在横幅下方，看起来"提示符活着却显示连接丢失"。
## 理想效果
打开新 shell 后横幅不应出现；只有当 PTY/SSH 真正断开时才显示。
## BUG原因
`src-tauri/src/services/local_session.rs` 的 `spawn_output_forwarder`（原 205–232 行）在 `reader.read()` 返回 `Ok(0)` 时**无条件**判定为"shell 退出"，立刻 emit `session-disconnected` 并 break 循环：
```rust
Ok(0) => {
    let payload = serde_json::to_vec(&session_id).unwrap();
    let _ = backend_clone.emit("session-disconnected", &payload);
    break;
}
```
Windows ConPTY（portable-pty）在 `pair.master_reader()`（`try_clone_reader()`）返回的克隆句柄上，**第一次** `read()` 在子进程产生任何输出之前可能返回 `Ok(0)`（EOF）—— 这是 ConPTY 初始化竞态的已知表现。之后 shell 正常把 prompt 写到 PTY，但 forwarder 线程已经在第一次 Ok(0) 时自杀、emit 过 `session-disconnected`，前端 listener (`src/contexts/session/useTauriListeners.ts:27`) 立即把 `session.is_connected` 置 `false`，触发 `src/components/Pane.tsx:245` 的横幅。

附带次要问题：原代码 `Err(_) => break` 静默退出 forwarder，read 出错时前端永远看不到通知；SSH forwarder (`src-tauri/src/services/ssh_session.rs`) 有同样的 Ok(0)+silent-error 模式，虽然 SSH 用 `recv()` 阻塞而非 PTY 直读，但保留一致的 EOF 语义以便未来扩展。
## 解决方案
1. 在 `src-tauri/src/services/local_session.rs` 的 `spawn_output_forwarder` 引入 `seen_data: bool` 标志：
   - `Ok(0)` 且 `!seen_data` → `tracing::debug!` 记录 + `std::thread::sleep(100ms)` 继续循环（**不** emit `session-disconnected`）。这覆盖 ConPTY 首读 EOF 场景；shell 真正活着时下一轮 `read()` 就能拿到数据。
   - `Ok(0)` 且 `seen_data` → `tracing::info!` + emit `session-disconnected` + break。这是真正的 EOF（shell 已退出）。
   - `Err(e)` → `tracing::error!` + emit `session-disconnected` + break。修复原来静默死亡的次要 bug。
   - `Ok(n)` → `seen_data = true` + emit `session-output`（不变）。
2. 同样为函数补上 docstring，说明三种 EOF 分支的语义，避免后人误改。
3. `src-tauri/src/services/ssh_session.rs` 的 SSH forwarder 同步加 `seen_data`（写入 `tracing::info!` 时附带，便于定位"是首读就断还是运行中断"），`eprintln!` 升级为 `tracing::error!` 走统一日志通道。
4. `cargo check` 干净通过，`cargo test --lib` 68 个原有 mockall 测试全部 pass（`spawn_output_forwarder` 在测试里走 `TestAppBackend::spawn` no-op，forwarder 闭包根本不执行，故原有断言不受影响）。
## 是否解决
YES


# Bug 013
## 现象
每次新建本地 shell（PowerShell、bash 等）后，pane 顶部**始终**显示橙色横幅 `Connection lost. Press Enter to reconnect.`，无论 shell 是否在输出、用户是否操作。Bug 012 修过的 PTY forwarder EOF 路径走完后日志里所有 `createSession:result` 都是 `isConnected:true`，但横幅依然常驻；用户按 Enter 触发 reconnect → 创建新 session → 关闭旧 session → EOF → 横幅继续 → 死循环。日志证据：连续 4 次 `createSession` 紧跟 `closeSession` 前一个 id，`PTY EOF for session N after data — shell exited` 也按时打，但 `Transient PTY EOF before data` 一条都没有出现 —— 说明 forwarder 并没有"误判"提前断开。
## 理想效果
打开新 shell 后横幅不应出现；只有当 PTY/SSH 真正断开（且真的读出过数据之后 EOF）时才显示。
## BUG原因
Rust 后端的 `SessionInfo` 在 `src-tauri/src/models/session.rs:21-28` 标了 `#[serde(rename_all = "camelCase")]`：
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
    pub capabilities: CapabilityFlags,
}
```
所以 IPC 返回的 JSON 是 `{"id":1,"name":"pws","sessionType":{...},"isConnected":true,"capabilities":{...}}`（日志中可见 `"isConnected":true`）。但 TypeScript 这一侧的接口仍然是蛇形：
- `src/services/sessionService.ts:11-17` 的 `SessionInfo.is_connected`、`SessionInfo.session_type`
- `src/types/session.ts:46-55` 的 `Session.is_connected`、`Session.session_type`

`invoke<SessionInfo>` 拿到的对象里 `info.is_connected === undefined`（字段名根本没匹配上），`info.session_type === undefined`。`buildFrontendSession`（`useSessionActions.ts:73-88`）把它原样拷到 React state：`{ is_connected: undefined, ... }`。`Pane.tsx:245` 渲染条件是 `!session.is_connected` —— `!undefined === true` —— 横幅从创建那一刻起就**永远**显示。同理 `Terminal.tsx` 的 `isConnectedRef.current` 也是 `undefined`，`onData` handler 在 `!isConnectedRef.current` 分支里吃掉所有非 `\r` 字符，用户输入根本进不到 PTY；只能按 Enter 触发 `reconnectSession`，导致日志里密集的 create+close 循环。

Bug 012 是同一个表象的另一种成因（ConPTY 首读 EOF → forwarder 自杀 → emit `session-disconnected` → React state 真把 `is_connected` 设成 `false`），但本次用户日志里没有触发 Bug 012 路径（没有 `Transient` 日志）。所以 Bug 012 仍然保留作为防御性修复；Bug 013 才是主因。
## 解决方案
1. 把所有从 IPC JSON 读出的 snake_case 字段改成 camelCase，与 Rust `rename_all = "camelCase"` 对齐：
   - `src/types/session.ts`：`Session.is_connected` → `isConnected`，`Session.session_type` → `sessionType`
   - `src/services/sessionService.ts`：`SessionInfo.is_connected` → `isConnected`，`SessionInfo.session_type` → `sessionType`
   - `src/contexts/session/useSessionActions.ts` `buildFrontendSession`：复制字段时同步改名
   - `src/contexts/session/useTauriListeners.ts:30`：`{...s, is_connected: false}` → `{...s, isConnected: false}`（保持 listener 仍能正确把已断开的 session 标 false）
   - `src/components/Pane.tsx`：3 处 `session.is_connected` / `isConnected={session.is_connected}` 同步改名
   - `src/contexts/session/paneUtils.test.ts:65`：测试 fixture 同步改名
2. 不要动 `Terminal.tsx` 里 `isConnected` 这个 prop 名字 —— 它本来就是 camelCase，命名跟 props 一致。
3. Rust 端不动 —— `SessionInfo`、`LocalSessionConfig`、`SSHSessionConfig` 仍用 `rename_all = "camelCase"`，这是和 Tauri IPC 默认约定一致的方向；改前端让前端对齐。
4. 验证：
   - `npx tsc --noEmit`：TSC OK（0 errors）
   - `npx vitest run src/contexts/session/paneUtils.test.ts`：47 passed, 1 todo
   - `cargo test --lib`：68 passed（Bug 012 的 forwarder 修复依然在位）
5. 手动验证：在 dev 环境打开新 shell，横幅应消失；按 Enter 走 reconnect 也应不再出现 `create+close+EOF` 死循环（除非用户真的关掉 shell）。
## 是否解决
YES
