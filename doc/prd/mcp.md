AI Terminal — MCP Server 规范

================================================================
版本：v0.1
协议：MCP 2025-06-18（streamable HTTP + stdio）
传输：stdio（默认）/ Streamable HTTP（可选，需显式开启）
定位：AI Terminal 内置 MCP server 的完整契约，是产品的核心差异化。

================================================================
0. 文档目的
================================================================

本文档是 dev / tm / 文档 / 第三方集成方共同遵守的契约。
任何破坏性变更必须更新版本号 + 在 CHANGELOG 写明 + 维持至少一个旧版本的兼容层。

================================================================
1. 架构总览
================================================================

1.1 进程模型

  ┌─────────────────────────────────────────────────┐
  │ ai-terminal.exe                                  │
  │                                                  │
  │  ┌──────────────┐    tokio::mpsc    ┌────────┐  │
  │  │ pty-bridge   │ ───────────────▶ │  core  │  │
  │  │ (PTY 池)     │ ◀─────────────── │ (总线) │  │
  │  └──────────────┘                 └────────┘  │
  │                                          ▲      │
  │                                          │      │
  │                          ┌───────────────┴──┐   │
  │                          │  mcp-server     │   │
  │                          │  ├─ stdio 端点  │   │
  │                          │  └─ HTTP 端点   │   │
  │                          └──────────────────┘   │
  └─────────────────────────────────────────────────┘

1.2 角色

- core（核心总线）：管理所有 session（标签页 / pane / SSH / tmux / Docker），
  维护 attach 状态、订阅者列表、权限策略。
- pty-bridge：每个 session 对应一个 PTY（portable-pty 抽象），
  负责字节 I/O、进程生命周期。
- mcp-server：实现 MCP 协议，对外暴露工具。
  所有跨 session 的副作用必须经 core，避免多 agent 互相干扰。

1.3 设计原则

- 单写者（attach 模型）：一个 session 同一时刻最多一个写者（AI attach 后屏蔽用户输入）。
- 多读者：多个订阅者可同时订阅同一 session 的输出流。
- 失败隔离：一个 session 崩溃不影响其他 session，也不影响 MCP server。
- 最小权限：MCP 工具只能操作 attach 范围内的 session，不能关闭非 attach 标签页、不能改全局配置。
- 显式优于隐式：所有副作用工具返回前必须确认已经生效（capture_screen 验证或事件回执）。

================================================================
2. 传输与端点
================================================================

2.1 stdio（默认）

- 启动：主进程 spawn mcp-server 子进程，stdin/stdout 通过 pipe 连接。
- 帧格式：MCP 规范的 JSON-RPC 2.0，每条消息一个 JSON 对象 + \n 分隔。
- 多 agent 限制：stdio 是一对一（一个 stdio 实例只能服务一个 agent）。
  多 agent 同时使用 → 全部走 HTTP 端点。
- 进程生命周期：与主进程同生共死，stdio EOF → MCP server 优雅退出。
- 启动参数（推荐给 agent 配置）：
  command: "ai-terminal-mcp"
  args: ["--stdio"]
  或：
  command: "ai-terminal.exe"
  args: ["--mcp-stdio"]

2.2 Streamable HTTP（可选，需配置开启）

- 监听地址：默认 127.0.0.1，端口可配（默认 19847）。
- 端点：
  - POST /mcp     请求（client → server 调用）
  - GET  /mcp     打开 SSE 流（订阅服务端通知 / 推送）
  - DELETE /mcp   关闭 SSE 流
- 鉴权：Bearer token，token 写到 %APPDATA%\ai-terminal\mcp.token，
  首次启用时生成 256-bit 随机值。token 文件权限 0600。
- 会话：MCP streamable HTTP 用 session id，server 在 POST 第一次请求时生成，
  client 必须在 Mcpa-Session-Id header 携带。
- 并发：单个 HTTP 端点支持多个并发 client，每个 client 一个独立 MCP session。
- CORS：默认关闭（同源）。如果需要 Web 客户端访问需在配置显式允许 origin。

2.3 关闭 / 重启

- 主进程退出 → 所有 MCP 连接关闭，订阅自动清理。
- MCP 配置变更（端口、token）→ 当前连接断开后下次生效，不强踢。

================================================================
3. 工具清单
================================================================

通用约定：
- 所有工具接受一个对象参数，返回一个对象。
- 异步工具（subscribe_output / wait_for）返回前必须等副作用生效。
- 错误格式：{ "code": "...", "message": "...", "details"?: {...} }。
- session_id 格式："{type}-{uuid_short}"，如 "tab-7f3a9b"，"ssh-9c1e4d"。

================================================================
3.1 list_sessions
================================================================

列出所有可见 session。

Input:
  {} (无参数)
  filter?: {
    type?: "tab" | "pane" | "ssh" | "wsl" | "docker" | "tmux"  // 按类型过滤
    profile?: string                                            // 按 profile 过滤
    attached?: boolean                                          // true 只返回被 AI attach 的
  }

Output:
  {
    sessions: [
      {
        session_id: string
        type: "tab" | "pane" | "ssh" | "wsl" | "docker" | "tmux"
        profile: string                  // profile 名
        title: string                    // 用户设置或自动生成
        cwd?: string                     // 当前工作目录（能取到时）
        attached: boolean                // 是否被 AI attach
        attached_by?: string             // attach 的 agent 名（来自 MCP initialize）
        pid?: number                     // 后端进程 pid
        created_at: string               // ISO 8601
        cols: number
        rows: number
      }
    ]
  }

错误码：
  - INTERNAL_ERROR

实现要点：
- 列出顺序按 created_at 升序（稳定）。
- 列表里不包含 attach_by 之外的敏感信息（不暴露 host / user 等）。

================================================================
3.2 create_session
================================================================

创建新 session（标签页 / pane / 远程等）。

Input:
  {
    type: "tab" | "pane" | "ssh" | "wsl" | "docker" | "tmux"
    profile?: string                    // 用户配置里的 profile 名（默认 "default"）
    parent_session_id?: string          // pane / tmux 需要父 session
    cwd?: string                        // 覆盖 profile 的 cwd
    env?: Record<string, string>        // 额外环境变量
    title?: string                      // 自定义标题
    cols?: number                       // 默认 80
    rows?: number                       // 默认 24
    // ssh 专属：
    host?: string
    port?: number
    user?: string
    auth?: {
      method: "password" | "private_key" | "agent"
      password?: string
      private_key_path?: string
      private_key_passphrase?: string
    }
    // docker 专属：
    container_id?: string
    shell?: string                      // 容器内 shell，默认 /bin/bash
    // tmux 专属：
    tmux_session?: string               // attach 已有 session，不存在则创建
  }

Output:
  {
    session_id: string
    type: ...
    pid: number
    cols: number
    rows: number
  }

错误码：
  - INVALID_PARAMS（参数缺失 / 类型错误）
  - PROFILE_NOT_FOUND
  - SSH_AUTH_FAILED
  - SSH_HOST_KEY_VERIFY_FAILED
  - SSH_NETWORK_ERROR
  - DOCKER_CONTAINER_NOT_FOUND
  - DOCKER_DAEMON_UNAVAILABLE
  - WSL_DISTRO_NOT_FOUND
  - TMUX_SERVER_ERROR
  - PERMISSION_DENIED（agent 没权限创建该类型）
  - QUOTA_EXCEEDED（session 数超过上限，默认 100）

实现要点：
- 创建成功立即返回；PTY 初始输出（如 shell banner）通过 subscribe_output 推送。
- 配额限制防止恶意 agent 开 10000 个 session。
- 权限策略：默认 agent 可以创建 tab/pane/ssh/wsl/docker/tmux。
  企业版可配置禁止某些类型。

================================================================
3.3 close_session
================================================================

关闭 session。

Input:
  { session_id: string, force?: boolean }

Output:
  { closed: true }

错误码：
  - SESSION_NOT_FOUND
  - SESSION_ATTACHED（被其他 agent attach，必须 force=true 或先 detach）
  - INTERNAL_ERROR

实现要点：
- force=true 时直接关闭，detach 其他 agent。
- tmux / ssh session 关闭时按配置决定是否清理远端资源（默认 detach tmux 不杀 session）。

================================================================
3.4 send_keys
================================================================

向 session 注入按键或文本。

Input:
  {
    session_id: string
    // 二选一：
    text?: string                       // 普通文本
    keys?: Array<string | KeySpec>      // 按键序列
    // 可选：
    press_enter?: boolean               // text 末尾是否补 Enter，默认 false
    bracketed?: boolean                 // 是否用 bracketed paste 包裹，默认 false（仅 text 生效）
    delay_ms?: number                   // keys 之间延时，默认 0
  }

  KeySpec:
    | { "type": "char", "value": string }
    | { "type": "key", "value": "Enter" | "Tab" | "Escape" | "Backspace" | "Space" | "Up" | "Down" | "Left" | "Right" | "Home" | "End" | "PageUp" | "PageDown" | "Delete" | "Insert" | "F1"-"F12" }
    | { "type": "combo", "modifiers": Array<"Ctrl" | "Alt" | "Shift" | "Meta">, "value": string }
    | { "type": "raw", "bytes": string }  // base64 编码的原始字节（高级用法）

Output:
  {
    delivered: boolean                  // 字节已写入 PTY
    bytes_sent: number
    warnings?: Array<string>            // 如"破坏性快捷键未在白名单"
  }

错误码：
  - SESSION_NOT_FOUND
  - SESSION_NOT_ATTACHED（必须先 attach 才能 send_keys）
  - INVALID_KEY_SPEC
  - PERMISSION_DENIED（破坏性快捷键被策略拦截）

破坏性快捷键策略（默认安全模式）：
- 默认禁止：Ctrl+C / Ctrl+D / Ctrl+Z / Ctrl+\ 在 non-attach session 注入
- 配置项 mcp.destructive_keys.policy：
  - "deny"（默认）：拒绝注入，返回 PERMISSION_DENIED
  - "ask"：工具内部 prompt 用户确认（MCP 协议层不允许交互，所以 ask 退化为返回错误 + 提示用户在 UI 确认）
  - "allow"：直接放行
- attach session 不受限（agent 既然 attach 了就是主写者）

实现要点：
- text 走 UTF-8 编码，bracketed=true 时包 \x1b[200~ ... \x1b[201~。
- keys 序列按顺序注入，delay_ms 模拟人类节奏（必要时绕开 IDE 的 keychord 检测）。
- raw 用于注入 ANSI / DCS 等高级序列，慎用。

================================================================
3.5 capture_screen
================================================================

捕获 session 当前屏幕内容。

Input:
  {
    session_id: string
    mode: "text" | "ansi" | "screenshot"
    // 文本模式：
    start_line?: number                 // 0 索引，-1 表示从屏幕顶部开始（默认 0）
    end_line?: number                   // 不含，-1 表示到屏幕底部（默认 -1）
    strip_ansi?: boolean                // 仅 text 模式，默认 true
    trim_trailing?: boolean             // 去掉每行末尾空格，默认 true
    // screenshot 模式：
    format?: "png"                      // 后续可能加 jpeg，默认 png
    scale?: number                      // 0.5-2.0，默认 1.0
  }

Output:
  // text 模式
  {
    mode: "text"
    content: string
    cursor: { row: number, col: number }
    rows: number
    cols: number
  }
  // ansi 模式
  {
    mode: "ansi"
    content: string                     // 含 ANSI 颜色码
    cursor: ...
  }
  // screenshot 模式
  {
    mode: "screenshot"
    format: "png"
    width: number
    height: number
    data: string                         // base64
  }

错误码：
  - SESSION_NOT_FOUND
  - INVALID_MODE
  - SCREENSHOT_FAILED（WebGL / 离屏渲染失败）

实现要点：
- text 模式：直接读 terminal grid，去掉 ANSI 后返回。
- ansi 模式：从 grid 重新生成 ANSI 流（保留颜色但去控制字符），可用于 AI 还原界面。
- screenshot 模式：xterm.js 离屏渲染到 canvas → toDataURL。
  注意性能，单次截图不应超过 500ms。

================================================================
3.6 subscribe_output
================================================================

订阅 session 的输出流（增量文本）。

Input:
  {
    session_id: string
    // 可选：
    from_sequence?: number              // 从指定序号开始，缺省从当前最新
    include_ansi?: boolean              // 是否包含 ANSI 码，默认 false
    buffer_size?: number                // 客户端缓冲行数，默认 10000
  }

Output（首次返回）：
  {
    subscribed: true
    from_sequence: number               // 实际起始序号
  }

后续推送（服务端通知，类型 mcp/notifications/output）：
  {
    method: "notifications/output"
    params: {
      session_id: string
      sequence: number                  // 递增序号
      delta: string                     // 增量文本
      full?: string                     // 重传时携带完整快照（极少）
    }
  }

Output（取消订阅）：
  // 通过 unsubscribe_output 工具（见 3.7）

错误码：
  - SESSION_NOT_FOUND
  - SUBSCRIBE_FAILED（buffer 满 / 内部错误）

实现要点：
- 序号从 0 开始单调递增，client 应记录已处理序号。
- 客户端断线重连时可用 from_sequence 续传。
- 服务端维护环形缓冲（默认保留最近 100000 行），超出丢弃最旧 + 通知客户端（full 字段携带快照）。
- 一个 session 可被多个 client 同时订阅，互不影响。

================================================================
3.7 unsubscribe_output
================================================================

取消订阅。

Input:
  { session_id: string }

Output:
  { unsubscribed: true }

错误码：
  - SESSION_NOT_FOUND
  - NOT_SUBSCRIBED

================================================================
3.8 attach_session
================================================================

agent 独占 session，获得写权限。

Input:
  { session_id: string }

Output:
  {
    attached: true
    cols: number
    rows: number
    prev_attached_by?: string           // 之前 attach 的 agent（如有）
  }

错误码：
  - SESSION_NOT_FOUND
  - SESSION_ALREADY_ATTACHED（其他 agent 已 attach，必须带 force=true 抢占）

  扩展：{ session_id, force: true }
  - ALREADY_ATTACHED_FORCED（抢占成功）

副作用：
- 用户键盘输入被丢弃（鼠标可选，默认禁用）。
- UI 顶部出现 banner：显示 agent 名 + 释放口令。
- close_session / send_keys 工具仅对 attached session 有效（其他人调 close 需 force）。
- 60 分钟无活动自动释放（防止 agent 崩溃导致 session 永久锁定），超时时间可配。

================================================================
3.9 detach_session
================================================================

释放 session 控制权。

Input:
  { session_id: string, reason?: string }

Output:
  { detached: true }

错误码：
  - SESSION_NOT_FOUND
  - NOT_ATTACHED

副作用：
- 恢复用户键盘输入。
- 移除 UI banner。
- 用户在终端输入释放口令也走这个工具（reason="user_release_command"）。

================================================================
3.10 wait_for
================================================================

等待 session 输出匹配正则。

Input:
  {
    session_id: string
    pattern: string                     // 正则表达式（re2 语法）
    timeout_ms: number                  // 最长等待
    include_ansi?: boolean              // 匹配时是否考虑 ANSI，默认 false
    from_sequence?: number              // 从指定序号开始，缺省从当前最新
  }

Output（匹配成功）：
  {
    matched: true
    sequence: number                    // 匹配发生时的序号
    line: string                        // 匹配的行
    elapsed_ms: number
  }

Output（超时）：
  // 返回错误码 WAIT_TIMEOUT，message 含 elapsed_ms

错误码：
  - SESSION_NOT_FOUND
  - INVALID_PATTERN
  - WAIT_TIMEOUT
  - INTERNAL_ERROR

实现要点：
- 实现基于 subscribe_output 的内部订阅 + 取消订阅。
- timeout_ms 包含初次订阅时间，避免长 timeout + 立即匹配时返回慢。
- pattern 编译失败时立即返回 INVALID_PATTERN。

================================================================
3.11 list_profiles（辅助）
================================================================

列出可用的 profile。

Input:
  {}

Output:
  {
    profiles: [
      {
        name: string
        type: "local" | "ssh" | "wsl" | "docker"
        description?: string
        default: boolean
      }
    ]
  }

================================================================
3.12 get_config / set_config（受限）
================================================================

get_config（仅读）：
Input: { keys?: Array<string> }  // 不指定返回全部可读字段
Output: { config: object }

set_config（仅写白名单字段）：
Input: { patches: Array<{ op: "set" | "del", path: string, value?: any }> }
Output: { applied: number, rejected: Array<{ path: string, reason: string }> }

白名单字段（v1）：
- mcp.destructive_keys.policy
- mcp.http.enabled
- mcp.http.port
- mcp.idle_timeout_seconds
- terminal.copy_on_select
- terminal.bracketed_paste_default

非白名单字段写入被拒绝，返回 rejected 列表说明原因。

错误码：
  - CONFIG_PATH_NOT_WRITABLE
  - INVALID_PATH

================================================================
4. 资源（Resources）
================================================================

MCP 协议除了工具还支持 Resources。AI Terminal v1 不实现 Resources
（用工具足够），保留扩展点。v1.1 计划：
- file:// 读 session 输出日志
- terminal://{session_id} 实时快照（类 Read resource）

================================================================
5. 提示模板（Prompts）
================================================================

v1 不实现 prompt 模板。AI Terminal 自身不是 agent，是 agent 的工具。

================================================================
6. 安全
================================================================

6.1 鉴权

stdio：依靠文件系统权限（process owner 隔离）。任何能启动该进程的用户都能用。
HTTP：Bearer token，必须在 Authorization header 携带。token 错误 → 401。
       无 token / 错误 token / token 过期 → 一律拒绝。
       token 可在 UI 重新生成（旧 token 立即失效）。

6.2 权限策略

- 工具级：每个 MCP session 启动时由 agent 在 initialize 阶段声明 client_info，
  server 据此应用权限策略。
- session 级：agent 只能 send_keys / capture_screen 自己 attach 的 session，
  不能操作其他 session（除非有 elevated scope，企业版功能）。
- 命令级：破坏性快捷键默认拒绝。
- 速率限制：每个 MCP session 每秒最多 100 个请求，超过返回 RATE_LIMITED。

6.3 审计

- 默认不记录任何调用日志。
- 配置 mcp.audit.enabled=true 时，写 %LOCALAPPDATA%\ai-terminal\audit.log：
  { ts, agent, method, params_hash, result_code }
  params_hash 是参数 JSON 的 SHA256，不写明文（避免泄露用户输入）。
- 日志 7 天自动清理。

================================================================
7. 状态机
================================================================

7.1 Session 生命周期

  ┌─────────┐  create_session  ┌─────────┐
  │         │ ───────────────▶ │         │
  │ (none)  │                  │ created │
  │         │ ◀─────────────── │         │
  └─────────┘  init failed    └────┬────┘
                                  │
                                  ▼
                            ┌──────────┐
                            │          │ ◀────────┐
                            │ running  │          │
                            │          │          │
                            └────┬─────┘          │
                  attach_session ││ detach_session│
                                 ▼│               │
                           ┌──────────┐           │
                           │ attached │───────────┘
                           │          │
                           └────┬─────┘
                                │ close_session
                                ▼
                           ┌──────────┐
                           │  closed  │ (终态)
                           └──────────┘

7.2 异常转移

- PTY 进程退出（normal exit / crash） → running → closed，触发事件 session_closed。
- MCP server 崩溃 → 所有 session 状态丢失，UI 提示用户重连。
- agent 失联（stdio EOF / HTTP stream 关闭） → 自动 detach 所有该 agent 的 session。

================================================================
8. 并发模型
================================================================

- pty-bridge 单写者：attach 模型下 PTY 写入是互斥的。
- 读取无锁：所有订阅者共享一个 broadcast channel。
- MCP 工具调用在 tokio runtime 上，每个调用一个 task，
  长任务（wait_for / subscribe）不阻塞其他调用。
- 同一 agent 的工具调用串行执行（避免 send_keys + close 竞态）。
- 不同 agent 的工具调用并行。

================================================================
9. 错误码全集
================================================================

通用：
- INTERNAL_ERROR         服务端内部错误
- INVALID_PARAMS         参数校验失败（含详细字段错误）
- TIMEOUT                通用超时
- RATE_LIMITED           速率限制
- PERMISSION_DENIED      权限不足
- UNAUTHORIZED           未鉴权（仅 HTTP）
- SESSION_NOT_FOUND      session 不存在
- SESSION_ALREADY_ATTACHED session 已被其他 agent attach

工具专属：
- PROFILE_NOT_FOUND
- SSH_AUTH_FAILED
- SSH_HOST_KEY_VERIFY_FAILED
- SSH_NETWORK_ERROR
- DOCKER_CONTAINER_NOT_FOUND
- DOCKER_DAEMON_UNAVAILABLE
- WSL_DISTRO_NOT_FOUND
- TMUX_SERVER_ERROR
- INVALID_KEY_SPEC
- INVALID_PATTERN
- WAIT_TIMEOUT
- NOT_SUBSCRIBED
- CONFIG_PATH_NOT_WRITABLE
- INVALID_PATH
- SCREENSHOT_FAILED
- QUOTA_EXCEEDED

错误格式：
{
  "code": "WAIT_TIMEOUT",
  "message": "wait_for timed out after 5000ms",
  "details": {
    "elapsed_ms": 5000,
    "pattern": "READY"
  }
}

================================================================
10. 测试要求
================================================================

10.1 单元测试（必须）

- 每个工具的入参校验（schema 拒绝坏数据）
- 每个工具的错误码路径（mock PTY 各种失败模式）
- 状态机转移（attach → detach → attach → close 全路径）
- 并发安全（多个工具并发调用同一 session）
- 速率限制
- 审计日志记录（开启 / 关闭）

10.2 集成测试（必须）

- stdio 端到端：Python `mcp` SDK 连入 → 跑完所有工具
- HTTP 端到端：curl + SSE 客户端
- 真实 PTY：在本地跑 PowerShell、WSL、sshd，跑 send_keys + capture_screen
- 真实 TUI：在 vim / lazygit 中 send_keys 验证交互
- MCP 协议兼容：用 rmcp 自带 conformance test

10.3 E2E（必须有手动 checklist）

- Claude Desktop 配置 stdio → 真实让 Claude "在终端里运行 git status"
- Cursor 配置 stdio → 真实让 Cursor 执行命令
- Codex CLI 配置 → 真实调用
- 反向 SSH tunnel：远端 agent 通过 tunnel 连本地 HTTP 端点 → 跨机器操作

================================================================
11. 集成示例
================================================================

11.1 Claude Desktop 配置

  ~/.config/claude_desktop_config.json (Windows: %APPDATA%\Claude\config.json):
  {
    "mcpServers": {
      "ai-terminal": {
        "command": "ai-terminal-mcp",
        "args": ["--stdio"]
      }
    }
  }

11.2 Claude Desktop（HTTP 模式）

  {
    "mcpServers": {
      "ai-terminal": {
        "url": "http://127.0.0.1:19847/mcp",
        "headers": {
          "Authorization": "Bearer <从 UI 复制的 token>"
        }
      }
    }
  }

11.3 Cursor

  Settings → MCP → Add:
  Name: ai-terminal
  Command: ai-terminal-mcp
  Args: --stdio

11.4 Codex CLI

  ~/.codex/config.toml:
  [mcp_servers.ai-terminal]
  command = "ai-terminal-mcp"
  args = ["--stdio"]

11.5 反向 SSH tunnel 一键脚本（PowerShell）

  # AI Terminal UI 生成的脚本
  ssh -R 19847:127.0.0.1:19847 user@your-server.example.com
  # 远端 agent 访问 http://127.0.0.1:19847/mcp + Bearer token

11.6 Python SDK 调用示例

  from mcp import ClientSession, StdioServerParameters
  from mcp.client.stdio import stdio_client

  params = StdioServerParameters(
      command="ai-terminal-mcp",
      args=["--stdio"],
  )
  async with stdio_client(params) as (read, write):
      async with ClientSession(read, write) as session:
          await session.initialize()

          # 列出 session
          sessions = await session.call_tool("list_sessions", {})
          print(sessions)

          # attach
          await session.call_tool("attach_session", {"session_id": "tab-7f3a9b"})

          # 执行命令
          await session.call_tool("send_keys", {
              "session_id": "tab-7f3a9b",
              "text": "git status\n",
          })

          # 等待输出
          result = await session.call_tool("wait_for", {
              "session_id": "tab-7f3a9b",
              "pattern": "On branch",
              "timeout_ms": 5000,
          })

          # 捕获屏幕
          screen = await session.call_tool("capture_screen", {
              "session_id": "tab-7f3a9b",
              "mode": "text",
          })

          # 释放
          await session.call_tool("detach_session", {"session_id": "tab-7f3a9b"})

================================================================
12. 版本兼容
================================================================

- 主版本号 v1.0 起锁定。
- 工具签名只在 minor 版本追加 / 弃用，不破坏性修改。
- 弃用流程：标记 deprecated → 保留 ≥ 2 个 minor 版本 → 主版本移除。
- 客户端 initialize 时声明 protocol_version，
  server 返回支持的最高版本，协商失败时降级或拒绝。
- 重大破坏性变更（如工具语义变化）必须 bump 主版本号。

================================================================
13. 性能预算
================================================================

- send_keys 延迟：< 10ms（写入 PTY）
- capture_screen (text) 延迟：< 50ms（1000 行内）
- capture_screen (screenshot) 延迟：< 500ms（1080p）
- subscribe_output 推送延迟：< 20ms（从 PTY 读到 SSE 发出）
- wait_for 平均响应：取决于 pattern 出现时间，框架开销 < 30ms
- 内存：100 个 session × 10000 行 buffer ≤ 200MB

================================================================
14. 后续规划（非 MVP）
================================================================

v1.1：
- Resources（terminal:// session 快照）
- Audio cues（attach / detach 提示音）
- Workspace 快照（一次性 attach 多个 session）

v1.2：
- 远程协作：多个 agent 协作同一 session（带光标所有权转移）
- 会话回放（asciinema 格式）

v2.0：
- 自定义 MCP 扩展协议（AI Terminal 专属）

================================================================
15. 文档维护
================================================================

- 本文档 owner: pdm（产品）
- 实现 owner: dev
- 任何破坏性变更必须先 PR 到本文档 + RFC，72 小时讨论窗口。
- 所有工具的 schema 改动必须同步更新：
  1. crates/mcp-server/src/tools/*.rs（实现）
  2. crates/mcp-server/src/schema.rs（JSON Schema）
  3. docs/mcp.md（本文档）
  4. docs/api/mcp-tools.json（机器可读规范）

================================================================
文档结束
================================================================
