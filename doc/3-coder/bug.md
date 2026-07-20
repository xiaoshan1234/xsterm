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
## 理想效果
## BUG原因
## 解决方案
## 是否解决
NO
