# Backend · App 层 (= `src-tauri/src/commands/`)

> **职责**：把 service 暴露给 Tauri runtime。app 层是「翻译器」——它知道 IPC 边界在哪、能访问 `AppHandle`/`State<T>`、做参数校验与错误序列化，但**不持有任何业务规则**。
>
> **目录映射**：本层文件落 `src-tauri/src/commands/`。本 README 的"app"是**语义名**，目录沿用 Rust 习惯的 `commands/`，避免所有 import 重写。

## 1. 模块清单（现状）

```
src-tauri/src/commands/
├── mod.rs            all_handlers() — generate_handler! 注册表
├── session.rs        24 个 #[tauri::command] 入口（local/ssh/tmux/pty 全部混在一起）
├── persistence.rs    save/load sessions|groups|attached_tmux_servers
└── logging.rs        log_message + get/set log_config + get_log_dir
```

## 2. 关键约束

- **不持有业务状态**。`State<SessionManager>`、`State<Store>` 通过 `tauri::State` 注入，commands 内部仅做「取参数 → 调 service → 包结果」。
- **不做格式校验以外的处理**。任何"如果 X 则 Y"的分支应下沉到 service。
- **错误返回 `String`**（当前约定）。`AppError` 还没统一，未来可换成 `tauri::Result<T, AppError>` —— 见「改进方向」。
- **不直接 import infra**。commands 必须经 service 调用 infra trait，禁止 `use crate::infrastructure::pty::*` 这种跨层跳跃。
- **不在 commands 里 spawn 长任务**。需要 `tokio::spawn` 的，统一在 service 层做。

## 3. 入口链

`src-tauri/src/lib.rs::run()` → `tauri::Builder::default().invoke_handler(commands::mod::all_handlers())` → 每个 `#[tauri::command]` 函数。

事件推送方向相反：service 拿 `AppHandle` → `app.emit("session-output", payload)` → 前端 `listen("session-output", ...)`。事件名 / payload 形状是 IPC 契约，见 [`../../flows/`](../../flows/)。

## 4. 依赖方向

```
commands/  ──►  services/  ──►  infrastructure/  ──►  models/
   │
   └─►  models/  (直接读纯数据类型，不通过 service)
```

commands 可直接读 `models::*`（参数 / 返回类型），但不能跨过 service 直接写 `infra::*`。

## 5. 改进方向

- **`session.rs` 拆分**：24 个 command 按 sub-domain 拆为 `commands/session/{local,ssh,tmux,pty}_commands.rs`，对应 `services/{local,ssh,tmux}_session/` 的目录结构。
- **统一错误类型**：现状每个 command `map_err(|e| e.to_string())`，丢失结构。引入 `AppError { code, source }`，`#[tauri::command]` 返回 `Result<T, AppError>`，前端 `invoke` 端能拿到 `error.code` 而不是裸字符串。
- **参数校验下沉**：把现在散在 command 里的字段 trim / 长度校验，收到 `models/` 的 `TryFrom<RawConfig>` 里。
- **capability 集中**：当前每个 command 的权限在 `src-tauri/capabilities/default.json` 里手动维护，将来把「command 名 → 所需 permission」的映射也写进这一层 README 末尾。
