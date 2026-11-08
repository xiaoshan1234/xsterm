# 日志系统设计（Debug 日志 + Session 日志）

> 定稿版本。本文档是 xsterm 日志系统的权威设计；任何日志相关改动前先读本文件。

## 1. 目标

xsterm 需要两条相互独立、按「给谁看」区分的日志流水线：

1. **软件 Debug 日志**：给开发者 / 支持人员定位软件问题（崩溃、连接失败、状态机异常等）。
2. **Session 日志**：给用户记录某个终端会话「屏幕上出现了什么」。

两条线又各自横跨前端与后端，构成 2×2 矩阵。两条线不允许混写进同一个文件：Debug 日志进全局滚动日志，Session 日志进按会话隔离的日志文件。

## 2. 现状盘点

| | Debug 日志 | Session 日志 |
|---|---|---|
| 后端 | 已成型：`tracing` + 滚动文件 + stderr，`EnvFilter` 可运行时热切换，配置持久化 | 空壳：`services/session_log.rs` 只有占位类型，无落盘写入 |
| 前端 | 半成品：`logger` 写 console 并转发后端，但生产环境会截断 debug/info，后端永远收不到 | 只有表单：`LoggingTab` 的配置存在，但从未送达后端 |

关键缺口：

- 前端 `loggerService.ts` 在生产环境直接 `return`，debug/info 连 `log_message` 都不发，后端 filter 开多细都没用。
- 后端 `start_session_logging` 只打一条 `tracing::info!`，`create_local` / `create_ssh` 传的是 `SessionLoggingConfig::default()`，tmux 路径根本没调用；用户在 `LoggingTab` 里勾的任何配置都到不了后端。

## 3. 已确认决策

- Session 日志**默认关闭**，按单个 session 在 Logging 页显式开启。
- Session 日志**只记录终端输出流**（`session-output`），不单独采集用户按键。shell 回显属于输出流的一部分，会自然出现在日志中；不提供「剥离回显」的能力（如未来需要，需在终端状态机层面解析，另立需求）。
- 模板语法采用花括号占位符，见 §5。
- `LogConfig.max_file_size` 语义回归字面义：**单文件大小上限**，Debug 日志按大小轮转；`max_log_files` 表示保留的滚动文件数量。Session 日志用各自配置里的 `max_size_mb` 按大小轮转。

## 4. 目标架构

### 4.1 Debug 日志（一条合并流）

- 前端 `logger` 只负责「上报」，写 console 与转发后端是两个独立门控；后端 `tracing` 统一收口（前端消息带 `target: "frontend"`）。
- 后端默认 filter：debug 构建 `debug`，release 构建 `warn`；`set_log_config` 热切换。
- 滚动、按大小轮转、保留数量清理全部在后端完成，前端不管理文件。

### 4.2 Session 日志（按会话隔离的字节流副本）

- 在输出收口处做一次 fan-out：`session-output` 发往前端的同时，若该会话开启了日志，就把同一批 UTF-8 安全的字节块写入该会话自己的文件。
- local PTY、SSH、tmux 三种会话共用同一条日志路径，不在三个 adapter 里重复造轮子。
- 写入必须走非阻塞 appender 或专用 writer 线程，复用已经按 64 KiB 批量好的块，禁止在热路径上按字节写。

### 4.3 存储位置

- Debug 日志：app data 目录（`app_log_dir`），由 `logging_setup.rs` 管理。
- Session 日志：app data 目录下独立的 `session-logs/` 子目录，与 Debug 日志分开，避免两套清理策略互相干扰。

## 5. 模板语法

Session 日志的文件名模板与行格式使用花括号占位符：

| 占位符 | 含义 | 可用位置 |
|---|---|---|
| `{{name}}` | 会话显示名 | 文件名模板 |
| `{{id}}` | xsterm 会话 id（数字） | 文件名模板 |
| `{{ts}}` | 时间戳，默认 `YYYY-MM-DD HH:mm:ss` | 文件名模板 / 行格式 |
| `{{ts:<strftime>}}` | 自定义 strftime 格式的时间戳 | 文件名模板 / 行格式 |
| `{{line}}` | 输出块文本 | 仅行格式 |

默认值：

- `enabled: false`
- `append: true`
- `fileNameTemplate: "{{name}}_{{ts:%Y-%m-%d_%H-%M-%S}}.log"`（无冒号，Windows 文件名安全）
- `maxSizeMb: 10`（`0` 表示不限）
- `lineFormat: "[{{ts}}] {{line}}"`

> 选择花括号而非 `%n` / `%v`，是为了避开 strftime 里 `%n` 表示换行的歧义。`{{ts:<strftime>}}` 内部仍可用 `%` 转义，但作用域被花括号明确限定。

## 6. 分阶段计划

- **Phase 0 — 统一口径**：定模板语法与 `max_file_size` 语义（已完成，见本文档），更新 `LoggingTab` 占位文案与前后端类型注释。
- **Phase 1 — 补齐 Debug 链路**：修复前端生产截断；补 `get_log_config` / `set_log_config` / `get_log_dir` 前端包装；新增日志设置界面。
- **Phase 2 — Session 日志后端落盘**：实现 `SessionLogWriter` + `SessionLogRegistry`，打通 `displayConfig.logging` 到 `create_*`，在三个输出点接上 `write_output`，实现模板渲染与按大小轮转。
- **Phase 3 — 用户可用 UI**：session 的「打开日志目录 / 查看 / 导出 / 清理」入口。
- **Phase 4 — 打磨**：轮转与清理策略补齐、磁盘配额提示、隐私提示（日志含终端输出，可能包含敏感内容）。

## 7. 约束与坑

- UI 改动遵循根目录 `DESIGN.md`，禁止 ad-hoc 样式。
- TS 命名遵循 `rules/ts-name-rules.md`，Rust 命名遵循 `rules/rust-name-rules.md`。
- 分层边界：组件不得直接 `import { invoke }`，必须走 `src/services/*`；前端监听收敛在 `useTauriListeners.ts`。
- 事件名 `session-output` / `session-closed` 是前端依赖的稳定契约，不可改名。
- `logging_setup.rs` 中故意泄漏的 non-blocking guard（`std::mem::forget`）保持不动。
- Session 日志写入不得阻塞 PTY 输出热路径；在已有批量点（64 KiB drain）上做 fan-out，而不是逐字节写。
