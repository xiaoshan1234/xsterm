# Rust Commands Refactoring Plan

## Current State Analysis

### lib.rs Command Inventory (14 commands)

| Command | State Dependency | Service Delegation |
|---------|-----------------|-------------------|
| `create_local_session` | `Arc<Mutex<SessionManager>>` + `AppHandle` | `SessionManager::create_local()` |
| `create_ssh_session` | `Arc<Mutex<SessionManager>>` + `AppHandle` | `SessionManager::create_ssh()` |
| `write_session` | `Arc<Mutex<SessionManager>>` | `SessionManager::write()` |
| `resize_session` | `Arc<Mutex<SessionManager>>` | `SessionManager::resize()` |
| `close_session` | `Arc<Mutex<SessionManager>>` | `SessionManager::close()` |
| `list_sessions` | `Arc<Mutex<SessionManager>>` | `SessionManager::list()` |
| `save_sessions` | `AppHandle` (store) | Direct store operation |
| `load_sessions` | `AppHandle` (store) | Direct store operation |
| `save_groups` | `AppHandle` (store) | Direct store operation |
| `load_groups` | `AppHandle` (store) | Direct store operation |
| `log_message` | None | Direct tracing call |
| `get_log_config` | `AppHandle` (store) | Direct store operation |
| `set_log_config` | `AppHandle` (store) + `Arc<Mutex<reload::Handle<...>>>` | Store + filter reload |
| `get_log_dir` | `AppHandle` | Direct path resolution |

### State Management Pattern

**Session State:**
```rust
State<'_, Arc<Mutex<SessionManager>>>
```
- Every session command acquires the mutex with `.lock().map_err(|e| e.to_string())?`
- The `Mutex` wraps `SessionManager` which is the sole owner of all `Session` variants
- `AppHandle` is required for `RealAppBackend::new(app)` to emit events

**Logging Reload Handle:**
```rust
State<'_, Arc<Mutex<reload::Handle<EnvFilter, tracing_subscriber::Registry>>>>
```
- Used only by `set_log_config` to reload the tracing filter at runtime

**Store Access:**
- Commands needing persistence use `app.store("filename.json")` directly
- No additional state wrapping needed—just `AppHandle`

### Error Mapping Strategy

All commands return `Result<T, String>`. Error paths:

1. **Mutex lock failure** (poisoned mutex):
   ```rust
   .lock().map_err(|e| e.to_string())?
   ```
   Converts `PoisonError` to `"lock error: ..."`

2. **Service errors**: Already returned as `String` from `SessionManager` methods (e.g., `"Session not found"`, `"PTY open failed"`)

3. **Store/serde errors**: Mapped inline with `.map_err(|e| e.to_string())?`

**Proposed error handling standardization:**
```rust
// In each thin command handler:
let mut manager = state.lock().map_err(|e| format!("session manager lock: {e}"))?;
manager.some_operation(...).map_err(|e| format!("operation failed: {e}"))
```

## Proposed Module Structure

```
src-tauri/src/
├── lib.rs                         # Minimal: module declarations, run(), logging setup
├── commands/
│   ├── mod.rs                     # Re-exports, Tauri handler aggregation
│   ├── session.rs                 # 6 session lifecycle commands
│   ├── persistence.rs             # 4 persistence commands (sessions + groups)
│   └── logging.rs                 # 4 logging commands
├── session.rs                     # [EXISTING] SessionManager, AppBackend traits
├── local_session.rs               # [EXISTING] PTY implementation
├── ssh_session.rs                 # [EXISTING] SSH implementation
└── groups.rs                      # [EXISTING] SessionGroup types
```

## Command Groupings & File Layout

### 1. `commands/session.rs` — Session Lifecycle Commands

**Group purpose:** All commands that operate on `SessionManager` via `Arc<Mutex<SessionManager>>`

**Commands:**
- `create_local_session(config, state, app) -> Result<SessionInfo, String>`
- `create_ssh_session(config, state, app) -> Result<SessionInfo, String>`
- `write_session(session_id, data, state) -> Result<(), String>`
- `resize_session(session_id, rows, cols, state) -> Result<(), String>`
- `close_session(session_id, state) -> Result<(), String>`
- `list_sessions(state) -> Result<Vec<SessionInfo>, String>`

**Handler pattern:**
```rust
#[tauri::command]
async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    let backend = RealAppBackend::new(app);
    manager.create_local(config, backend)
}
```

**Re-export from session module:**
```rust
pub use crate::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo};
```

### 2. `commands/persistence.rs` — Session & Group Persistence Commands

**Group purpose:** All commands that read/write structured data to Tauri store files

**Commands:**
- `save_sessions(sessions, app) -> Result<(), String>`
- `load_sessions(app) -> Result<Vec<SessionInfo>, String>`
- `save_groups(store_data, app) -> Result<(), String>`
- `load_groups(app) -> Result<GroupStore, String>`

**Re-exports:**
```rust
pub use crate::groups::GroupStore;
pub use crate::session::SessionInfo;
```

### 3. `commands/logging.rs` — Logging & Diagnostic Commands

**Group purpose:** Frontend-accessible logging API and log configuration management

**Commands:**
- `log_message(level, source, message, data) -> Result<(), String>`
- `get_log_config(app) -> Result<LogConfig, String>`
- `set_log_config(config, app, reload_handle_state) -> Result<(), String>`
- `get_log_dir(app) -> Result<String, String>`

**State dependencies:**
- `set_log_config` uses: `State<'_, Arc<Mutex<reload::Handle<EnvFilter, Registry>>>>`
- Others use: `AppHandle` only

**Re-exports:**
```rust
// LogConfig defined in lib.rs - needs to move to a shared location
// Recommend: move LogConfig to a new `commands/types.rs` or keep in lib.rs
```

## Module Entry: `commands/mod.rs`

```rust
// Re-exports for convenience (optional, but helpful for generate_handler!)
pub use crate::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo};

pub mod session;
pub mod persistence;
pub mod logging;

// Aggregation point for Tauri handler
pub fn all_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        session::create_local_session,
        session::create_ssh_session,
        session::write_session,
        session::resize_session,
        session::close_session,
        session::list_sessions,
        persistence::save_sessions,
        persistence::load_sessions,
        persistence::save_groups,
        persistence::load_groups,
        logging::log_message,
        logging::get_log_config,
        logging::set_log_config,
        logging::get_log_dir,
    ]
}
```

## lib.rs After Refactoring

**Before:** 352 lines with 14 commands + logging setup + module imports + state management

**After:** ~100 lines, responsibilities:
1. Declare `mod commands;`
2. `mod groups; mod local_session; mod session; mod ssh_session;` (existing)
3. `LogConfig` type (move to `commands/types.rs` or retain here)
4. `run()` function: setup, manage state, invoke handlers via `commands::all_handlers()`
5. `get_log_config_impl()` helper (used in setup, could move to logging module)

**Key change:**
```rust
.invoke_handler(tauri::generate_handler![
    // ... all 14 commands listed here
])
```

becomes:
```rust
.invoke_handler(commands::all_handlers())
```

## Key Architectural Notes

### Thin Handler Definition
Each command handler should be **max 10-15 lines**:
1. Extract parameters from Tauri State/AppHandle
2. Lock mutex if accessing SessionManager
3. Call exactly one service method
4. Return result or map error

### State Access Normalization
```rust
// Session commands always use this pattern:
let mut manager = state.lock().map_err(|e| e.to_string())?;
// manager is &mut SessionManager - call methods directly

// Logging commands with reload handle:
let handle = reload_state.lock().map_err(|e| e.to_string())?;
handle.reload(new_filter).map_err(|e| e.to_string())?;
```

### No New Abstractions Needed
The service layer (`SessionManager`, `AppBackend` trait) is already well-separated. Commands are already thin—they just need physical separation into files.

### Data Types Location
- `LogConfig` — currently in lib.rs, recommend moving to `commands/types.rs`
- `SessionInfo`, `LocalSessionConfig`, `SSHSessionConfig` — remain in `session.rs`
- `SessionGroup`, `GroupStore` — remain in `groups.rs`

## Migration Sequence

1. Create `commands/` directory
2. Create `commands/mod.rs` with module declarations and re-exports
3. Move session commands to `commands/session.rs`
4. Move persistence commands to `commands/persistence.rs`
5. Move logging commands to `commands/logging.rs`
6. Update `lib.rs` to import `commands` module and use `commands::all_handlers()`
7. Delete the 14 original `#[tauri::command]` functions from lib.rs
8. Verify `cargo check` passes
9. Run existing tests to confirm behavior unchanged
