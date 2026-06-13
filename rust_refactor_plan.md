# Rust Backend Refactoring Plan

## 1. Current Duplication and Layering Issues

### 1.1 lib.rs Problems (352 lines)
- **Logging infrastructure embedded**: `cleanup_old_logs`, `init_logging`, `LogConfig`, reload handle management are mixed with commands
- **Persistence embedded**: `save_sessions`, `load_sessions`, `save_groups`, `load_groups` handlers contain store logic
- **14 commands at top level**: No organization, all in `lib.rs`
- **Duplication**: `get_log_config_impl` duplicates logic from `get_log_config` command

### 1.2 session.rs Problems (814 lines)
- **`AppBackend` trait in wrong layer**: Defined here but wraps Tauri `AppHandle` — belongs in infrastructure
- **`RealAppBackend` in wrong layer**: Tauri-specific implementation
- **`SessionManager` is a mixed bag**:
  - Business logic: `create_local`, `create_ssh`, `write`, `resize`, `close`, `list`
  - Lifecycle: stores `Session` enum variants mixing local and SSH
  - Concrete deps: `pty_system: Box<dyn PtySystem>`, `ssh_backend: Box<dyn SshBackend>`
- **Models scattered**: `SessionInfo`, `SessionType`, `LocalSessionConfig`, `SSHSessionConfig`, `SSHAuth` should be in `models/`
- **Factory functions should be services**: `create_local_session` (local_session.rs), `create_ssh_session` (ssh_session.rs)

### 1.3 local_session.rs Problems (225 lines)
- **Traits overly granular**: `PtySystem`, `PtyPair`, `Child` — three traits when one might suffice
- **`create_local_session` is a factory/service** — should be in services layer
- **`NativePtySystem` is infrastructure** — concrete implementation of `PtySystem`

### 1.4 ssh_session.rs Problems (373 lines)
- **Traits overlap with local_session.rs patterns**: `SshBackend`, `SshChannel`, `StreamIO` mirror local patterns
- **`create_ssh_session` is a factory/service** — belongs in services layer
- **`RusshBackend` (aliased as `SshBackendImpl`) is infrastructure** — SSH implementation
- **`SshConnectResult`, `SshSessionWrapper` are models** — should be in `models/`

### 1.5 groups.rs Status
- Pure data model (15 lines) — no issues, will move to `models/group.rs`

---

## 2. Proposed Module Structure

```
src/
├── lib.rs                    # Module declarations, run()
├── main.rs                   # Entry point (unchanged)
│
├── commands/                 # Tauri command handlers (UI-facing)
│   ├── mod.rs
│   ├── session.rs            # create_local_session, create_ssh_session,
│   │                         # write_session, resize_session, close_session,
│   │                         # list_sessions
│   ├── persistence.rs       # save_sessions, load_sessions,
│   │                         # save_groups, load_groups
│   └── logging.rs            # log_message, get_log_config, set_log_config,
│                             # get_log_dir
│
├── services/                # Business logic (core app logic)
│   ├── mod.rs
│   ├── session_manager.rs   # SessionManager struct + methods
│   ├── local_session.rs     # create_local_session() factory
│   └── ssh_session.rs        # create_ssh_session() factory
│
├── models/                  # Data structures (serde, no logic)
│   ├── mod.rs
│   ├── session.rs            # SessionInfo, SessionType, LocalSessionConfig,
│   │                         # SSHSessionConfig, SSHAuth, SshConnectResult,
│   │                         # SshSessionWrapper
│   └── group.rs              # SessionGroup, GroupStore
│
├── infrastructure/          # External system integration
│   ├── mod.rs
│   ├── app_backend.rs        # AppBackend trait + RealAppBackend
│   ├── pty.rs                # PtySystem, PtyPair, Child traits +
│   │                         # NativePtySystem, NativePtyPair, NativeChild
│   └── ssh.rs                # SshBackend, SshChannel, StreamIO traits +
│                             # RusshBackend, BridgedChannel, DummyStream
│
└── logging_setup.rs          # Logging initialization, cleanup_old_logs,
                              # LogConfig, reload handle management
```

---

## 3. Trait Simplification in local_session.rs and ssh_session.rs

### 3.1 Current Traits

**local_session.rs:**
```rust
pub trait PtySystem: Send {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String>;
}
pub trait PtyPair: Send {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String>;
    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String>;
    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
}
pub trait Child: Send {
    fn kill(self: Box<Self>) -> Result<(), String>;
}
```

**ssh_session.rs:**
```rust
pub trait StreamIO: Read + Write + Send + Sync {}
pub trait SshChannel: Read + Write + Send {
    fn request_pty(&mut self, term: &str, cols: u16, rows: u16) -> Result<(), String>;
    fn shell(&mut self) -> Result<(), String>;
    fn tcp_stream(&self) -> Box<dyn StreamIO>;
}
pub trait SshBackend: Send {
    fn connect(&self, host: &str, port: u16, auth: &SSHAuth, username: &str)
        -> Result<SshConnectResult, String>;
}
```

### 3.2 Proposed Simplifications

**Keep traits for `PtySystem`, `PtyPair`, `Child` as-is** — they provide necessary abstraction for local terminal sessions and enable `mockall` testing. The three-trait pattern is standard for PTY abstraction (system → pair → child).

**Eliminate `StreamIO` trait** — It's a blanket trait (`impl<T: Read + Write + Send + Sync> StreamIO for T {}`) that adds no value. Replace with `Box<dyn Read + Write + Send + Sync>` directly.

**Simplify `SshChannel` trait** — Currently requires `Read + Write + Send` but the implementation (`BridgedChannel`) uses direct channels, not these trait methods. The `Read`/`Write` implementations return errors indicating "use direct recv/send". 

**Proposed SshChannel:**
```rust
pub trait SshChannel: Send {
    fn request_pty(&mut self, term: &str, cols: u16, rows: u16) -> Result<(), String>;
    fn shell(&mut self) -> Result<(), String>;
    fn tcp_stream(&self) -> Box<dyn Read + Write + Send + Sync>;
}
```

**Keep `SshBackend` trait** — Required for mocking in tests (see test suite in session.rs). This is the correct abstraction point.

---

## 4. Extracting Logging and Persistence from lib.rs

### 4.1 Logging Extraction

Create `src/logging_setup.rs` with:

| Item | Description |
|------|-------------|
| `LogConfig` | Struct (move from lib.rs lines 15-31) |
| `LogConfig::default()` | Default impl (move from lib.rs lines 23-31) |
| `cleanup_old_logs()` | Function (move from lib.rs lines 180-209) |
| `init_logging()` | Function (move from lib.rs lines 211-248) |
| `get_log_config_impl()` | Helper (move from lib.rs lines 343-352) |

### 4.2 Persistence Extraction

Create `src/commands/persistence.rs` with:

| Command | Original Location |
|---------|------------------|
| `save_sessions` | lib.rs lines 124-133 |
| `load_sessions` | lib.rs lines 136-146 |
| `save_groups` | lib.rs lines 150-160 |
| `load_groups` | lib.rs lines 162-176 |

### 4.3 Logging Commands Extraction

Create `src/commands/logging.rs` with:

| Command | Original Location |
|---------|------------------|
| `log_message` | lib.rs lines 250-266 |
| `get_log_config` | lib.rs lines 268-278 |
| `set_log_config` | lib.rs lines 280-295 |
| `get_log_dir` | lib.rs lines 297-301 |

---

## 5. Files to Create/Modify/Delete

### Files to CREATE (new modules):

| File | Purpose |
|------|---------|
| `src/commands/mod.rs` | Command module declarations |
| `src/commands/session.rs` | Session commands |
| `src/commands/persistence.rs` | Persistence commands |
| `src/commands/logging.rs` | Logging commands |
| `src/services/mod.rs` | Services module declarations |
| `src/services/session_manager.rs` | SessionManager (moved from session.rs) |
| `src/services/local_session.rs` | create_local_session (moved from local_session.rs) |
| `src/services/ssh_session.rs` | create_ssh_session (moved from ssh_session.rs) |
| `src/models/mod.rs` | Models module declarations |
| `src/models/session.rs` | Session-related models (moved from session.rs, ssh_session.rs) |
| `src/models/group.rs` | Group models (moved from groups.rs) |
| `src/infrastructure/mod.rs` | Infrastructure module declarations |
| `src/infrastructure/app_backend.rs` | AppBackend + RealAppBackend (moved from session.rs) |
| `src/infrastructure/pty.rs` | PtySystem traits + implementations (from local_session.rs) |
| `src/infrastructure/ssh.rs` | SshBackend + SshChannel traits (from ssh_session.rs) |
| `src/logging_setup.rs` | Logging infrastructure (moved from lib.rs) |

### Files to MODIFY:

| File | Changes |
|------|---------|
| `src/lib.rs` | Remove all extracted code, update module declarations, update `run()` |
| `src/session.rs` | Remove models, traits, SessionManager, keep re-exports for backward compat |
| `src/local_session.rs` | Delete after moving contents |
| `src/ssh_session.rs` | Delete after moving contents |
| `src/groups.rs` | Delete after moving to models/group.rs |

### Files to DELETE:

- `src/local_session.rs`
- `src/ssh_session.rs`
- `src/groups.rs`

### Files to KEEP UNCHANGED:

- `src/main.rs` — only calls `xsterm_lib::run()`, no changes needed

---

## 6. Step-by-Step Execution Order

**Principle: `cargo check` passes after each step.**

### Phase 1: Create Module Skeleton (4 steps)

**Step 1.1: Create all `mod.rs` files with empty content**
- Create `src/commands/mod.rs` (empty)
- Create `src/services/mod.rs` (empty)
- Create `src/models/mod.rs` (empty)
- Create `src/infrastructure/mod.rs` (empty)
- Add `mod commands; mod services; mod models; mod infrastructure; mod logging_setup;` to lib.rs
- **Verify**: `cargo check` passes

**Step 1.2: Verify initial state compiles**
- Run `cargo check` to confirm empty modules compile

---

### Phase 2: Create Models (5 steps)

**Step 2.1: Create `src/models/group.rs`**
- Move `SessionGroup`, `GroupStore` from groups.rs
- **Verify**: `cargo check` passes

**Step 2.2: Create `src/models/session.rs`**
- Move from session.rs: `SessionType`, `SessionInfo`, `LocalSessionConfig`, `SSHSessionConfig`, `SSHAuth`
- Move from ssh_session.rs: `SshConnectResult`, `SshSessionWrapper`
- **Verify**: `cargo check` passes

**Step 2.3: Update `src/models/mod.rs`**
```rust
pub mod group;
pub mod session;
```
- **Verify**: `cargo check` passes

**Step 2.4: Update `src/session.rs` re-exports**
- Keep re-exports for backward compatibility: `pub use crate::models::session::*; pub use crate::models::group::*;`
- **Verify**: `cargo check` passes

**Step 2.5: Delete `src/groups.rs`**
- File no longer needed
- **Verify**: `cargo check` passes

---

### Phase 3: Create Infrastructure Layer (6 steps)

**Step 3.1: Create `src/infrastructure/app_backend.rs`**
- Move from session.rs: `AppBackend` trait, `RealAppBackend` struct + impl
- **Verify**: `cargo check` passes

**Step 3.2: Create `src/infrastructure/pty.rs`**
- Move from local_session.rs: `PtySystem`, `PtyPair`, `Child` traits
- Move from local_session.rs: `NativePtySystem`, `NativePtyPair`, `NativeChild`
- Move from local_session.rs: `LocalSession`, `LocalSessionHandles`
- Update imports to use `crate::models::session::*`
- **Verify**: `cargo check` passes

**Step 3.3: Create `src/infrastructure/ssh.rs`**
- Move from ssh_session.rs: `StreamIO` trait (simplified), `SshChannel` trait (simplified), `SshBackend` trait
- Move from ssh_session.rs: `RusshBackend`, `BridgedChannel`, `DummyStream`, `SshSessionHandles`
- Move from ssh_session.rs: `create_ssh_session` function
- Update imports to use `crate::models::session::*`, `crate::infrastructure::app_backend::*`
- **Verify**: `cargo check` passes

**Step 3.4: Create `src/infrastructure/mod.rs`**
```rust
pub mod app_backend;
pub mod pty;
pub mod ssh;

pub use app_backend::{AppBackend, RealAppBackend};
pub use pty::{PtySystem, PtyPair, Child, NativePtySystem, LocalSession, LocalSessionHandles};
pub use ssh::{SshBackend, SshChannel, RusshBackend, SshSessionWrapper, SshSessionHandles, create_ssh_session, SshConnectResult};
```
- **Verify**: `cargo check` passes

**Step 3.5: Delete `src/ssh_session.rs`**
- All contents moved to infrastructure/ssh.rs and services/ssh_session.rs
- **Verify**: `cargo check` passes

**Step 3.6: Delete `src/local_session.rs`**
- All contents moved to infrastructure/pty.rs
- **Verify**: `cargo check` passes

---

### Phase 4: Create Logging Setup (2 steps)

**Step 4.1: Create `src/logging_setup.rs`**
- Move from lib.rs: `LogConfig`, `LogConfig::default()`, `cleanup_old_logs()`, `init_logging()`, `get_log_config_impl()`
- Update imports
- **Verify**: `cargo check` passes

**Step 4.2: Update `src/lib.rs` to use logging_setup**
- Remove `LogConfig`, `cleanup_old_logs`, `init_logging`, `get_log_config_impl`
- Add `use crate::logging_setup::*;`
- **Verify**: `cargo check` passes

---

### Phase 5: Create Services Layer (4 steps)

**Step 5.1: Create `src/services/local_session.rs`**
- Move `create_local_session` from infrastructure/pty.rs
- Keep `use crate::infrastructure::{AppBackend, PtySystem, LocalSession, LocalSessionHandles};`
- Keep `use crate::models::session::{LocalSessionConfig, SessionInfo, SessionType};`
- **Verify**: `cargo check` passes

**Step 5.2: Create `src/services/ssh_session.rs`**
- Move `create_ssh_session` from infrastructure/ssh.rs
- Keep necessary types
- **Verify**: `cargo check` passes

**Step 5.3: Create `src/services/session_manager.rs`**
- Move `Session` enum, `SessionManager` struct + impl from session.rs
- Update imports to use new module paths:
  - `crate::models::session::*`
  - `crate::infrastructure::{AppBackend, PtySystem, SshBackend, NativePtySystem, SshBackendImpl, LocalSession, LocalSessionHandles}`
  - `crate::services::local_session::create_local_session`
  - `crate::services::ssh_session::create_ssh_session`
- **Verify**: `cargo check` passes

**Step 5.4: Create `src/services/mod.rs`**
```rust
pub mod local_session;
pub mod ssh_session;
pub mod session_manager;

pub use session_manager::SessionManager;
pub use local_session::create_local_session;
pub use ssh_session::create_ssh_session;
```
- **Verify**: `cargo check` passes

---

### Phase 6: Create Commands (4 steps)

**Step 6.1: Create `src/commands/session.rs`**
- Move session commands: `create_local_session`, `create_ssh_session`, `write_session`, `resize_session`, `close_session`, `list_sessions`
- Update imports to use `crate::services::SessionManager`, `crate::models::session::*`
- **Verify**: `cargo check` passes

**Step 6.2: Create `src/commands/persistence.rs`**
- Move: `save_sessions`, `load_sessions`, `save_groups`, `load_groups`
- Update imports
- **Verify**: `cargo check` passes

**Step 6.3: Create `src/commands/logging.rs`**
- Move: `log_message`, `get_log_config`, `set_log_config`, `get_log_dir`
- Update imports
- **Verify**: `cargo check` passes

**Step 6.4: Create `src/commands/mod.rs`**
```rust
pub mod session;
pub mod persistence;
pub mod logging;

pub use session::*;
pub use persistence::*;
pub use logging::*;
```
- **Verify**: `cargo check` passes

---

### Phase 7: Final Cleanup (3 steps)

**Step 7.1: Rewrite `src/lib.rs`**
- Remove all extracted code (commands, logging setup, models)
- Keep only module declarations, `run()` function, and setup logic
- Update invoke_handler to use `crate::commands::`
- **Verify**: `cargo check` passes

**Step 7.2: Rewrite `src/session.rs`**
- Keep only re-exports for backward compatibility (types used by tests)
- Remove all implementations
- **Verify**: `cargo check` passes

**Step 7.3: Run full build verification**
```bash
cargo build 2>&1
```
- Confirm no warnings or errors

---

## Summary of File Movements

| Original Location | New Location |
|------------------|-------------|
| lib.rs: LogConfig, cleanup_old_logs, init_logging | logging_setup.rs |
| lib.rs: session/persistence/logging commands | commands/session.rs, commands/persistence.rs, commands/logging.rs |
| session.rs: AppBackend, RealAppBackend | infrastructure/app_backend.rs |
| session.rs: SessionManager, Session enum | services/session_manager.rs |
| local_session.rs: PtySystem, PtyPair, Child + impls | infrastructure/pty.rs |
| local_session.rs: create_local_session | services/local_session.rs |
| ssh_session.rs: SshBackend, SshChannel, StreamIO + impls | infrastructure/ssh.rs |
| ssh_session.rs: create_ssh_session | services/ssh_session.rs |
| session.rs: SessionInfo, SessionType, configs, SSHAuth | models/session.rs |
| ssh_session.rs: SshConnectResult, SshSessionWrapper | models/session.rs |
| groups.rs: SessionGroup, GroupStore | models/group.rs |
| local_session.rs: LocalSession, LocalSessionHandles | infrastructure/pty.rs |
| ssh_session.rs: SshSessionHandles | infrastructure/ssh.rs |

---

## Traits Summary

| Trait | Status | Reason |
|-------|--------|--------|
| `AppBackend` | Keep | Abstraction for Tauri emit/spawn, essential for testability |
| `PtySystem` | Keep | Enables mockall in tests, standard PTY abstraction |
| `PtyPair` | Keep | Standard separation from PtySystem |
| `Child` | Keep | Standard separation from PtyPair |
| `SshBackend` | Keep | Enables mockall in tests (see MockSshBackendM in session.rs tests) |
| `SshChannel` | Simplify | Remove Read+Write requirements, keep only async operations |
| `StreamIO` | Eliminate | Replace with `Box<dyn Read + Write + Send + Sync>` directly |
