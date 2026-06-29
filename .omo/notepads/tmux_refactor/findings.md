---

# tmux Module Dependency Analysis

## File Listing

| File | Lines | Role |
|------|-------|------|
| `mod.rs` | 19 | Module root, re-exports |
| `commands.rs` | 364 | Pure tmux command string builders |
| `parser.rs` | 739 | Tmux control-mode byte stream parser |
| `state.rs` | 349 | Frontend-facing data models + events |
| `state_tracker.rs` | 101 | Per-session mutable pause/copy-mode state |
| `channel_io.rs` | 115 | Sync I/O adapters over async tokio mpsc |
| `events.rs` | 92 | Event emission helpers (→ frontend) |
| `notification.rs` | 148 | tmux notification name → TmuxControlEvent mapper |
| `handlers.rs` | 61 | Message dispatcher (parser → events) |
| `forwarder.rs` | 115 | Background forwarding thread |
| `session.rs` | 232 | TmuxSession handle + integration tests |
| `session/local.rs` | 98 | Local PTY-backed session creation |
| `session/ssh.rs` | 118 | SSH exec-channel-backed session creation |

---

## Dependency Graph (per-file imports from tmux modules)

```
commands.rs       — NO tmux imports (pure string builders)
parser.rs         — NO tmux imports (self-contained protocol logic)
state_tracker.rs  — NO tmux imports (self-contained mutable state)
channel_io.rs     — commands (build_tmux_argv)

state.rs          — parser (PaneListEntry, WindowListEntry)

events.rs         — parser (PaneListEntry, WindowListEntry)
                    state  (TmuxControlEvent, TmuxPaneOutput)

notification.rs   — commands  (list_windows)
                    state     (TmuxControlEvent)
                    state_tracker (StateTracker)

handlers.rs       — events        (emit_* functions)
                    notification  (map_notification)
                    parser        (TmuxMessage)
                    state_tracker (StateTracker, DispatchState alias)

forwarder.rs      — channel_io (CapturePaneQueue)
                    events     (emit_closed)
                    handlers   (handle_message, DispatchState)
                    parser     (TmuxControlParser)

session.rs        — channel_io (CapturePaneQueue)
                    [also uses crate::services::tmux::commands::capture_pane via qualified path]
                    [test only: commands::{list_panes, list_windows}, state::TmuxControlEvent]

session/local.rs   — channel_io (CapturePaneQueue)
                    commands   (build_tmux_argv)
                    forwarder  (spawn_control_forwarder)
                    session    (TmuxSession, TmuxSessionHandles)

session/ssh.rs    — channel_io (build_tmux_command, CapturePaneQueue, ChannelReader, ChannelWriter)
                    commands   (list_windows)
                    forwarder  (spawn_control_forwarder)
                    session    (TmuxSession)
```

---

## Layer Architecture

```
Layer 0 — Pure infrastructure (no tmux imports)
├── commands.rs     — string builders only
├── parser.rs       — byte stream → TmuxMessage
└── state_tracker.rs — in-memory mutable state

Layer 1 — Depends on layer 0
├── channel_io.rs  — depends on commands
└── state.rs       — depends on parser (for From impls)

Layer 2 — Depends on layers 0–1
├── events.rs       — depends on parser, state
├── notification.rs — depends on commands, state, state_tracker
└── forwarder.rs    — depends on channel_io, events, handlers, parser

Layer 3 — Depends on layers 0–2
├── handlers.rs     — depends on events, notification, parser, state_tracker
├── session.rs      — depends on channel_io, commands, state
├── session/local.rs — depends on channel_io, commands, forwarder, session
└── session/ssh.rs  — depends on channel_io, commands, forwarder, session

Layer 4 — External consumer
└── services/session_manager.rs — depends on mod.rs re-exports only
```

---

## Public Exports

### From mod.rs (re-exported)
| Symbol | Source module | External consumer |
|--------|-------------|-------------------|
| `create_tmux_session` | `session` → `local` | `session_manager.rs` |
| `create_ssh_tmux_session` | `session` → `ssh` | `session_manager.rs` |
| `TmuxSession` | `session` | `session_manager.rs` |
| `TmuxSessionHandles` | `session` | `session_manager.rs` |
| `resize_window_for_pane` | `commands` | `session_manager.rs` |
| `send_keys` | `commands` | `session_manager.rs` |

### Internal cross-module imports (not re-exported)
| Importing file | Imported from | Items |
|----------------|--------------|-------|
| `state.rs` | `parser.rs` | `PaneListEntry`, `WindowListEntry` |
| `events.rs` | `parser.rs` | `PaneListEntry`, `WindowListEntry` |
| `events.rs` | `state.rs` | `TmuxControlEvent`, `TmuxPaneOutput` |
| `handlers.rs` | `events.rs` | `emit_*` functions |
| `handlers.rs` | `notification.rs` | `map_notification` |
| `handlers.rs` | `parser.rs` | `TmuxMessage` |
| `handlers.rs` | `state_tracker.rs` | `StateTracker` |
| `forwarder.rs` | `channel_io.rs` | `CapturePaneQueue` |
| `forwarder.rs` | `events.rs` | `emit_closed` |
| `forwarder.rs` | `handlers.rs` | `handle_message`, `DispatchState` |
| `forwarder.rs` | `parser.rs` | `TmuxControlParser` |
| `notification.rs` | `commands.rs` | `list_windows` |
| `notification.rs` | `state.rs` | `TmuxControlEvent` |
| `notification.rs` | `state_tracker.rs` | `StateTracker` |
| `session.rs` | `channel_io.rs` | `CapturePaneQueue` |
| `session.rs` | `commands.rs` | `capture_pane` (qualified path only, test only) |
| `session.rs` | `state.rs` | `TmuxControlEvent` (test only) |
| `session/local.rs` | `channel_io.rs` | `CapturePaneQueue` |
| `session/local.rs` | `commands.rs` | `build_tmux_argv` |
| `session/local.rs` | `forwarder.rs` | `spawn_control_forwarder` |
| `session/local.rs` | `session.rs` | `TmuxSession`, `TmuxSessionHandles` |
| `session/ssh.rs` | `channel_io.rs` | `build_tmux_command`, `CapturePaneQueue`, `ChannelReader`, `ChannelWriter` |
| `session/ssh.rs` | `commands.rs` | `list_windows` |
| `session/ssh.rs` | `forwarder.rs` | `spawn_control_forwarder` |
| `session/ssh.rs` | `session.rs` | `TmuxSession` |
| `channel_io.rs` | `commands.rs` | `build_tmux_argv` |

---

## Circular Dependencies

**None found.** The dependency graph is a DAG with no cycles.

---

## Tight Coupling Issues

### 1. `session.rs` depends on 5 internal modules
`TmuxSession` owns a `CapturePaneQueue` (from `channel_io`), calls `commands::capture_pane` (qualified path), and its integration test imports `commands` and `state`. This is the most coupled file.

**Potential fix:** Move `capture_pane` call into a helper in `channel_io`, or pass it as a closure. The integration test should move to a separate `tests/` integration file.

### 2. `session.rs` uses qualified path for `commands::capture_pane`
```rust
let command = crate::services::tmux::commands::capture_pane(...);
```
This suggests `session.rs` wasn't `use`-importing from `commands` intentionally, but this qualified path is ugly and fragile. However, the call itself is only exercised in integration tests. See dead code section.

### 3. `handlers.rs` is a hub with 4 imports
`handlers.rs` imports `events`, `notification`, `parser`, and `state_tracker`. This is acceptable for a dispatcher but signals the file may grow unwieldy as new message types are added.

### 4. `session/local.rs` and `session/ssh.rs` import from `session.rs`
Both submodules depend on `TmuxSession`/`TmuxSessionHandles` from the parent `session.rs`. This creates a subtle parent-child coupling. Since `TmuxSession` is `pub`, this could theoretically be avoided by having submodules construct the session directly. Currently the parent module holds the shared session logic (`write_command`, `request_capture_pane`) and the submodules provide constructors.

### 5. `channel_io.rs` imports from `commands.rs`
`channel_io::build_tmux_command` wraps `build_tmux_argv`. This is a thin delegation — `channel_io` could be said to own this functionality. Alternatively, `build_tmux_command` could move to `commands.rs` (since it builds a command string) and `build_tmux_argv` could be made `pub(crate)`.

---

## Modules That Could Be Merged or Split

### Merge candidates

**`events.rs` + `notification.rs`**
These are tightly coupled (events imports `map_notification` from notification; notification emits `TmuxControlEvent` defined in `state`). Together they form the "frontend event emission" layer. Merging into a single `events.rs` (renaming `notification.rs` content to `events/notification.rs`) would eliminate one cross-module boundary. However, separation of concerns is reasonable: notification mapping is pure logic, events are the I/O layer.

**`session/local.rs` + `session/ssh.rs` → into `session.rs`**
Both are small (~100 lines each) and exist solely to construct `TmuxSession`. Their creation logic is transport-specific but simple. Merging them into `session.rs` as `pub fn create_tmux_session` and `pub fn create_ssh_tmux_session` would eliminate the `session/` subdirectory and simplify imports across the module. The cost: `session.rs` goes from 232 to ~448 lines.

### Split candidates

**`session.rs` — extract `TmuxSessionHandles`**
`TmuxSessionHandles` is used only to keep the child/PTY alive. Its construction is entirely in `local.rs`. Splitting it into `session/handles.rs` would make the dependency chain clearer, but the gain is marginal given the file is small.

---

## Dead Code Analysis

### `commands.rs` — `#![allow(dead_code)]` at module level

The entire module suppresses dead code warnings. The comment explains this is intentional: "Most functions are consumed by the frontend through `write_tmux_command` rather than by other Rust code."

**Truly used** (called through `write_tmux_command` or other paths):
- `send_keys` — used in `session_manager.rs::send_keys_to_tmux_pane`
- `resize_window_for_pane` — used in `session_manager.rs::resize_tmux_pane`
- `capture_pane` — called from `TmuxSession::request_capture_pane` in `session.rs` (only exercised in tests, see below)
- `list_windows` — called from `notification.rs::request_state_sync` and `session/ssh.rs::schedule_initial_sync`
- `build_tmux_argv` — called from `channel_io::build_tmux_command` and `session/local.rs`
- `escape_tmux_keys` — called by `send_keys`
- `quote_tmux_arg` — called by `new_session`, `attach_session`

**Likely dead** (never called anywhere outside tests):
- `NO_CMD_NUM` — never used
- `new_session` — never called
- `attach_session` — never called
- `list_sessions` — never called
- `kill_session` — never called
- `list_panes` — called in `session.rs` test only
- `kill_window` — never called
- `kill_pane` — never called
- `display_message_window_layout` — never called
- `refresh_client_pane` — never called
- `set_pause_after` — never called

**Important note on `capture_pane`:** `TmuxSession::request_capture_pane` (which calls `capture_pane`) is `pub` on `TmuxSession`, but `session_manager.rs` does NOT call it. The `capture_tmux_pane` method on `SessionManager` calls `session.write_command(...)` directly, not `session.request_capture_pane(...)`. So the async capture queue mechanism is dead code at runtime — only exercised in the integration test.

### `state.rs` — `#[allow(dead_code)]` on 2 items

**`TmuxSession`** (struct + impl):
```rust
#[allow(dead_code)]
pub struct TmuxSession { ... }
```
Comment says: "Part of the frontend-facing state tree; kept available for serialization even though the backend currently emits incremental events instead of full snapshots."

This struct is never constructed or used outside tests. It represents a planned feature (full state snapshots) not yet implemented.

**`TmuxStateSnapshot`** (struct):
```rust
#[allow(dead_code)]
pub struct TmuxStateSnapshot { ... }
```
Same as above — dead, planned feature.

**Note:** The `From<WindowListEntry>` and `From<PaneListEntry>` impls on the list entry structs in `state.rs` ARE used — `events.rs` calls `windows.into_iter().map(Into::into)` to convert parser types to state types.

---

## Summary

- **13 files** across the tmux module with **no circular dependencies**.
- **5-layer architecture** from pure infrastructure (commands, parser) to session construction.
- **1 external consumer**: `session_manager.rs` — uses only the 6 re-exported items.
- **Tightest coupling**: `session.rs` imports 5 modules; `session/local.rs` and `session/ssh.rs` import from parent `session.rs`.
- **Dead code**: `commands.rs` has ~9 functions that are never called (only tests); `TmuxSession` and `TmuxStateSnapshot` in `state.rs` are dead from a deferred feature; `TmuxSession::request_capture_pane` is dead at runtime.
- **Merge candidates**: `events.rs`+`notification.rs` (reasonable split is fine), or `session/local.rs`+`session/ssh.rs` into `session.rs` (eliminates subdirectory).

## Severity Legend
- **HIGH**: Near-identical blocks (≥3 lines, same control flow), same file or cross-file
- **MEDIUM**: Same pattern but different values, or similar but not identical blocks
- **LOW**: Minor stylistic repetition, cosmetic only

---

## D-01: Identical writer.write + flush boilerplate (HIGH)

**Files**: `src-tauri/src/services/tmux/session.rs`
**Lines**: 47-51 and 67-71

```rust
// Line 47-51  (write_command)
let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
writer.write_all(command.as_bytes()).map_err(|e| e.to_string())?;
writer.flush().map_err(|e| e.to_string())

// Line 67-71  (request_capture_pane) — IDENTICAL except command variable
let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
writer.write_all(command.as_bytes()).map_err(|e| e.to_string())?;
writer.flush().map_err(|e| e.to_string())
```

**Duplicate level**: Exact 3-line duplicate
**Extraction**: `TmuxSession::write_command_raw(&str) -> Result<(), String>` or a private helper that takes `&[u8]`.

---

## D-02: Arc::clone + .lock().map_err boilerplate (HIGH)

**Files**: `src-tauri/src/services/tmux/session.rs`
**Lines**: 47, 57, 67

Pattern appears 3 times in the same impl block:
```
.lock().map_err(|e| e.to_string())?
```

Lines 47 and 67 are identical (`writer.lock().map_err...`).
Line 57 is `queue.lock().map_err...` — same pattern on a different mutex.

**Extraction**: A trait extension `LockExt` or inline helper `fn lock_str<T: ?Sized>(m: &Mutex<T>) -> Result<MutexGuard<T>, String>`.

---

## D-03: SessionInfo construction — shared fields (MEDIUM)

**Files**: `session/local.rs` (lines 60-68), `session/ssh.rs` (lines 56-71)

Both construct `SessionInfo` with identical field assignments:
```rust
id: session_id,          // same
is_connected: true,     // same
```

Only `name` and `session_type` differ.
**Extraction**: A `TmuxSession::new_common(session_id)` private constructor that sets `id` and `is_connected`.

---

## D-04: capture_queue initialization — identical (MEDIUM)

**Files**: `session/local.rs` (line 71), `session/ssh.rs` (line 74)

```rust
let capture_queue: CapturePaneQueue = Arc::new(Mutex::new(std::collections::VecDeque::new()));
```

**Extraction**: `CapturePaneQueue::new()` constructor or `impl Default`.

---

## D-05: map_err_string vs map_err(|e| e.to_string()) inconsistency (MEDIUM)

**Files**: `session/local.rs` uses `.map_err_string()?` (lines 33, 54, 57, 58)
**Files**: `session/ssh.rs` uses `Ok(...)` + manual `e` rebind
**Files**: `session.rs` uses `.map_err(|e| e.to_string())?`

**Severity**: Inconsistency means no shared error-type strategy. `map_err_string()` in `local.rs` is cleaner. Other files should align.
**Extraction**: Establish one error convention; extract a trait or type alias.

---

## D-06: commands.rs — similar format! patterns (MEDIUM)

**File**: `src-tauri/src/services/tmux/commands.rs`

These 10 functions produce near-identical `format!("<cmd> -t {}\n", id)` strings:

| Function | Lines | Pattern |
|---|---|---|
| `kill_session` | 101-102 | `format!("kill-session -t {}\n", session_id)` |
| `resize_window_for_pane` | 122-123 | `format!("resize-window -t {} -x {} -y {}\n", ...)` |
| `kill_window` | 127-128 | `format!("kill-window -t {}\n", window_id)` |
| `kill_pane` | 162-163 | `format!("kill-pane -t {}\n", pane_id)` |
| `display_message_window_layout` | 171-172 | `format!("display-message -t {} -p '...'\n", window_id)` |
| `refresh_client_pane` | 180-181 | `format!("refresh-client -A {}:continue\n", pane_id)` |
| `send_keys` | 144-145 | `format!("send-keys -t {} \"{}\"\n", pane_id, escape_tmux_keys(keys))` |
| `capture_pane` | 149-158 | mutating `format!("capture-pane -t {}", pane_id)` |

The `-t {}` suffix with `\n` terminator is a micro-pattern.

**Extraction**: `fn tmux_cmd_id(cmd: &str, id: &str) -> String` — reduces all simple `-t` commands to one line each.

---

## D-07: commands.rs — quote_tmux_arg vs escape_tmux_keys (MEDIUM)

**File**: `src-tauri/src/services/tmux/commands.rs`
**Lines**: 226-232, 199-216

Both functions process strings for tmux consumption with escaping:
- `quote_tmux_arg`: wraps in double quotes, escapes existing double quotes (`\"`)
- `escape_tmux_keys`: backslash doubling, CR/LF→Enter, quote escaping

Both use `arg.replace('\"', "\\\"")` and `String::with_capacity`.

**Extraction**: `quote_tmux_arg` could be expressed in terms of `escape_tmux_keys` or vice versa. Alternatively, a shared escape utility.

---

## D-08: parser.rs — parse_window_list vs parse_pane_list (MEDIUM)

**File**: `src-tauri/src/services/tmux/parser.rs`
**Lines**: 570-586 and 588-606

Both follow identical structure:
```rust
fn parse_...(lines: &[String]) -> TmuxMessage {
    let mut entries = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < MIN_COLUMNS { continue; }
        entries.push(EntryType { field0: parts[0].to_string(), ... });
    }
    TmuxMessage::...(entries)
}
```

**Extraction**: Generic `fn parse_tabular_list<T>(lines, min_cols, parser) -> TmuxMessage` or a `TabularParser` struct with callback.

---

## D-09: notification.rs — repeated TmuxControlEvent::Unknown branches (LOW-MEDIUM)

**File**: `src-tauri/src/services/tmux/notification.rs`
**Lines**: 64-66, 68-70, 97-99

Three distinct notification names each return identical:
```rust
TmuxControlEvent::Unknown { raw: raw.to_string() }
```

They cannot be merged into one arm (different match names), but all three use `.to_string()` on `raw`.
**Extraction**: A `fn unknown_event(raw: &str) -> TmuxControlEvent` helper.

---

## D-10: state_tracker.rs — lock unwrap_or pattern (MEDIUM)

**File**: `src-tauri/src/services/tmux/state_tracker.rs`

`is_paused` (lines 50-54) and `is_in_copy_mode` (lines 70-75) are identical:
```rust
self.xxx.lock().map(|set| set.contains(pane_id)).unwrap_or(false)
```

`mark_paused` and `mark_continued` share the `if let Ok(mut set) = self.paused_panes.lock()` pattern.

**Extraction**: A generic `fn with_lock<F, R>(&self, mutex, f: F) -> R` helper.

---

## D-11: events.rs — emit_event wrapper vs direct emit (LOW)

**File**: `src-tauri/src/services/tmux/events.rs`

`emit_window_list` (lines 70-82) and `emit_pane_list` (lines 84-92) are structurally identical after the data transformation — they both just call `emit_control_event` with a wrapped variant.

```rust
pub fn emit_...(backend: &B, session_id: u32, data: Vec<...>) {
    emit_control_event(backend, session_id, TmuxControlEvent::...(data.into_iter().map(Into::into).collect()));
}
```

**Extraction**: A generic macro or `fn emit_list<B, T>(backend, session_id, variant_fn, entries)`.

---

## D-12: spawn_control_forwarder — repeated Arc::clone boilerplate (LOW)

**File**: `src-tauri/src/services/tmux/forwarder.rs`
**Lines**: 36-40

```rust
let state_clone = Arc::clone(&state);
let capture_queue_clone = Arc::clone(&capture_queue);
// ...
let classifier_queue = Arc::clone(&capture_queue_clone);
```

Three `Arc::clone` calls that could use a `Clone` bound instead.
**Severity**: Minor, idiomatic Rust.

---

## D-13: SSH writer flush — silently ignored (MEDIUM)

**File**: `src-tauri/src/services/tmux/session/ssh.rs`
**Lines**: 107-108

```rust
let _ = w.write_all(cmd.as_bytes());
let _ = w.flush();
```

The SSH session's `schedule_initial_sync` silently ignores all write errors while `session.rs` methods propagate them. This is a behavioral inconsistency, not pure duplication, but worth noting.

---

## Summary Table

| ID | Category | Files | Severity | Fix Complexity |
|----|----------|-------|----------|----------------|
| D-01 | writer.write + flush | session.rs | HIGH | Low — extract helper |
| D-02 | lock.map_err pattern | session.rs | HIGH | Medium — trait ext |
| D-03 | SessionInfo shared fields | local.rs, ssh.rs | MEDIUM | Low — shared constructor |
| D-04 | capture_queue init | local.rs, ssh.rs | MEDIUM | Low — impl Default |
| D-05 | Error conversion inconsistency | local.rs, ssh.rs, session.rs | MEDIUM | Medium — unify error type |
| D-06 | format! cmd patterns | commands.rs | MEDIUM | Low — tmux_cmd_id helper |
| D-07 | quote/escape overlap | commands.rs | MEDIUM | Low-Medium |
| D-08 | parse_window/pane_list | parser.rs | MEDIUM | Medium — generic parser |
| D-09 | Unknown event helper | notification.rs | LOW | Low |
| D-10 | lock unwrap_or pattern | state_tracker.rs | MEDIUM | Low |
| D-11 | emit list functions | events.rs | LOW | Low |
| D-12 | Arc::clone noise | forwarder.rs | LOW | Trivial |
| D-13 | SSH silent flush | session/ssh.rs | MEDIUM | Low |

---

# Architectural Patterns, Module Organization, and Conventions Analysis

## 1. Overall Architecture

The tmux service implements a **layered pipeline** architecture with clear separation between session lifecycle, protocol parsing, message dispatch, and frontend emission.

```
Frontend (TypeScript)
    ↑ emit()
AppBackend (trait: emit + spawn)
    ↑
events.rs (emit_pane_output, emit_control_event, etc.)
    ↑
handlers.rs / notification.rs (routing + mapping)
    ↑
forwarder.rs (background thread: read → parse → dispatch)
    ↑
parser.rs (TmuxControlParser: DCS unwrapping + message framing)
    ↑
session.rs (TmuxSession: write handle)
    ↑
session/local.rs  OR  session/ssh.rs  (session creation + PTY/SSH channels)
```

**Session creation has two transport paths** that converge on shared infrastructure:
- **Local**: `session/local.rs` → spawns `tmux -CC` on a PTY pair → forwards through `spawn_control_forwarder`
- **SSH**: `session/ssh.rs` → opens SSH exec channel running `tmux -CC` → adapts async tokio channels to sync I/O via `ChannelReader`/`ChannelWriter` → `spawn_control_forwarder`

Both paths produce the same `TmuxSession` handle and use the same forwarder/parser/handler chain.

### Session Lifecycle
1. **Creation**: `create_tmux_session` (local) or `create_ssh_tmux_session` (SSH) constructs `TmuxSession` + spawns forwarder thread
2. **Running**: Forwarder thread reads bytes → parser → handlers → events → frontend
3. **Teardown**: Child exit (local) or read EOF (both) → `emit_closed` → `exited.store(true)`

### Command Building
- Pure functions in `commands.rs` returning `String` with trailing `\n`
- No validation — callers use IDs from tmux stream
- `escape_tmux_keys()` handles complex escaping for `send_keys`
- `build_tmux_argv()` normalizes session creation commands

### Parsing
- Incremental streaming parser (`parser.rs`) with byte buffer
- State machine tracks: `in_dcs` mode, `pending_response` block accumulator, `pending_dcs_messages` queue
- Command response classification via callback (`ResponseClassifier`) for out-of-order responses (capture-pane)
- List response classification by prefix pattern matching after block completion

### State Tracking
- `state_tracker.rs`: Two `Mutex<HashSet<String>>` tracking pane-level flags (paused, copy-mode)
- Both use short-lived mutexes — forwarder is single-threaded so this is defensive

### Event Handling
- `handlers.rs` dispatches parsed `TmuxMessage` → frontend events
- `notification.rs` enriches notifications with side effects (state mutations, sync requests)
- `events.rs` serializes to JSON and emits through `AppBackend`
- Flow: `forwarder reads → parser.parse() → handle_message() → map_notification() / classify → emit_*() → backend.emit()`

---

## 2. Module Boundaries and Responsibilities

| Module | Lines | Responsibility | Public API |
|--------|-------|---------------|------------|
| `mod.rs` | 19 | Module aggregator, re-exports | `TmuxSession`, `TmuxSessionHandles`, `create_tmux_session`, `create_ssh_tmux_session`, `resize_window_for_pane`, `send_keys` |
| `commands.rs` | 364 | Pure tmux command string builders | All command fns (many dead) |
| `parser.rs` | 739 | Incremental DCS/control-mode protocol parser | `TmuxMessage`, `TmuxControlParser`, `WindowListEntry`, `PaneListEntry` |
| `state.rs` | 349 | Frontend-facing data models + control events | `TmuxControlEvent`, `TmuxPaneOutput`, `TmuxPane`, `TmuxWindow`, `TmuxSession` (dead), `TmuxStateSnapshot` (dead) |
| `state_tracker.rs` | 101 | Per-session mutable pause/copy-mode state | `StateTracker` |
| `channel_io.rs` | 115 | Sync I/O adapters over async channels | `CapturePaneQueue`, `ChannelWriter`, `ChannelReader`, `build_tmux_command` |
| `events.rs` | 92 | Event emission to frontend | `emit_pane_output`, `emit_control_event`, `emit_closed`, `emit_captured_pane_output`, `emit_command_error`, `emit_window_list`, `emit_pane_list` |
| `notification.rs` | 148 | Notification name → TmuxControlEvent mapper | `map_notification` |
| `handlers.rs` | 61 | Message dispatch router | `handle_message`, `DispatchState` (alias) |
| `forwarder.rs` | 115 | Background read+dispatch thread | `spawn_control_forwarder` |
| `session.rs` | 232 | TmuxSession handle + integration tests | `TmuxSession`, `TmuxSessionHandles` |
| `session/local.rs` | 98 | Local PTY-backed session creation | `create_tmux_session` |
| `session/ssh.rs` | 118 | SSH exec-channel-backed session creation | `create_ssh_tmux_session` |

---

## 3. Naming Conventions and Inconsistencies

### Consistent Patterns
- `emit_*` prefix for event emission functions (`events.rs`)
- `*_command` suffix for command builders returning strings (`commands.rs`)
- `map_*` prefix for notification-to-event mappers (`notification.rs`)
- `spawn_*` prefix for background thread launchers (`forwarder.rs`)
- `create_*` prefix for session factory functions (`session/local.rs`, `session/ssh.rs`)
- `handle_*` prefix for message handlers (`handlers.rs`)
- `request_*` for frontend-originated sync requests (`notification.rs`)
- `check_*` for periodic status checks (`forwarder.rs`)

### Inconsistencies

**I-01: Suffix inconsistency in lifetime-management types**
- `TmuxSessionHandles` uses `Handles` suffix
- `StateTracker` uses `Tracker` suffix
- Both serve similar lifetime-management roles. Suggest standardizing on one suffix or naming convention.

**I-02: Abstraction level inconsistency in `channel_io.rs`**
- `CapturePaneQueue` is a type alias (`Arc<Mutex<VecDeque<String>>>`)
- `ChannelReader`/`ChannelWriter` are concrete structs
- Mixed abstraction levels in the same module

**I-03: `ResponseClassifier` mixing styles**
- `ResponseClassifier` is a `type` alias for `Option<Box<dyn FnMut() -> Option<String> + Send>>`
- `TmuxControlParser` uses it directly — mixing type-alias and struct-based patterns

**I-04: `DispatchState` backwards-compatible alias**
```rust
pub type DispatchState = StateTracker;
```
- Suggests the name was changed but the alias wasn't removed from a public boundary
- Should be cleaned up or documented why both names must exist

**I-05: `build_tmux_command()` vs `build_tmux_argv()`**
- Similar purpose (assemble tmux invocation), different naming conventions
- `build_tmux_command` returns a full shell command string; `build_tmux_argv` returns a Vec of args
- The naming doesn't clearly convey this distinction

**I-06: `resize_window_for_pane` naming**
- Only exposed command that takes `pane_id` but operates on the containing window
- Slightly awkward — could be `resize_window_by_pane_id` or similar

**I-07: `window-add` / `pane-add` map to `Unknown`**
- In `notification.rs`, `window-add` and `pane-add` map to `TmuxControlEvent::Unknown`
- `WindowClosed` and `PaneClosed` exist — the set is asymmetric
- Completing `WindowAdded` and `PaneAdded` would give full structural change coverage

**I-08: Error handling inconsistency**
- `session/local.rs` uses `.map_err_string()?` (custom trait)
- `session.rs` uses `.map_err(|e| e.to_string())?`
- `session/ssh.rs` uses `Ok(...)` + manual error rebind
- No shared error-type strategy across the module

**I-09: Silent error swallowing in SSH path**
```rust
// session/ssh.rs lines 107-108
let _ = w.write_all(cmd.as_bytes());
let _ = w.flush();
```
- `schedule_initial_sync` silently ignores all write errors
- `session.rs` methods propagate them — behavioral inconsistency

**I-10: Qualified path in `session.rs`**
```rust
let command = crate::services::tmux::commands::capture_pane(...);
```
- Suggests intentional avoidance of `use` import, but the pattern is inconsistent with other imports

---

## 4. Async/Blocking/Threading Patterns

### Threading Model (3 distinct thread categories)

1. **Forwarder thread** — spawned via `backend.spawn()` (→ `std::thread::spawn`). Sync `read()` loop. Handles: reading from transport, parsing, dispatching to frontend.
2. **SSH I/O thread** — spawned in `connect_ssh()` via `thread::spawn()`. Runs a `tokio::single_thread` runtime. Handles: async russh data loop.
3. **App thread** — Tauri main thread, where `backend.emit()` ultimately calls `app.emit()`.

### Sync-over-Async Bridges
- `ChannelWriter`: `impl Write` → `tokio::sync::mpsc::UnboundedSender::send()` (blocking send in sync context)
- `ChannelReader`: `impl Read` over `std::sync::mpsc::Receiver` (populated by SSH thread)

### Blocking Patterns
- `ssh.rs`: `connect_exec()` blocks on `result_rx.recv()` waiting for SSH handshake to complete
- `session/ssh.rs`: `schedule_initial_sync()` uses `thread::sleep(500ms)` on a spawned thread
- `forwarder.rs`: `check_child_status()` calls `try_wait()` which may block briefly

### Lock Contention Points
- `TmuxSession.writer: Arc<Mutex<Box<dyn Write + Send>>>` — every `write_command()` and `request_capture_pane()` acquires this mutex
- `StateTracker` uses `Mutex<HashSet>` — short-lived, single-threaded access
- `CapturePaneQueue: Arc<Mutex<VecDeque>>>` — accessed by both writer (for push) and parser (for pop via closure)

### Key Observation: No async/await in tmux service
The entire tmux service layer is synchronous. Async only exists at the SSH transport boundary (`russh`).

---

## 5. Opportunities for Shared Abstractions

### High-Priority Opportunities

**A-01: Capture response correlation (`CapturePaneQueue` + `ResponseClassifier`)**
- This is the most complex and fragile part of the codebase
- The FIFO approach works for single capture-pane requests but could race if multiple requests are in flight
- Consider a tagged response system, or using command numbers if tmux supports them in `-CC` mode
- **Current risk**: If two `capture-pane` commands are issued before the first `%begin` arrives, the queue ordering may mismatch

**A-02: State sync circular pattern (`request_state_sync`)**
- The notification handler emits an event to the frontend, which writes back a command
- This round-trip could be done internally: `notification.rs` could directly write `list-windows` through the session writer
- Or the forwarder could auto-sync on structural change notifications
- **Benefit**: Eliminates frontend round-trip latency and reduces event surface area

**A-03: `WindowAdded` / `PaneAdded` events**
- `notification.rs` maps `window-add` and `pane-add` to `Unknown` events
- `WindowClosed` and `PaneClosed` exist — completing the symmetric set would give the frontend full structural change coverage
- **Benefit**: Frontend can react to additions without relying on sync requests

**A-04: `TmuxStateSnapshot` unused**
- The full state tree types exist in `state.rs` but aren't used
- The codebase uses incremental events only
- A full snapshot could simplify frontend state management
- **Decision needed**: Implement snapshot-based sync or remove dead types

**A-05: Template method for session creation**
- `session/local.rs` and `session/ssh.rs` share nearly identical post-spawn setup code
- Could extract: `fn finish_session_setup(writer, info, exited, capture_queue, forwarder_params) -> TmuxSession`
- **Benefit**: Eliminates D-03, D-04 duplication; makes adding new transports easier

**A-06: Consolidate `CapturePaneQueue` push/pull**
- Currently `TmuxSession::request_capture_pane()` pushes to the queue, and the parser's `ResponseClassifier` closure pops from it
- The closure approach is indirect — could pass the queue directly to the parser
- **Benefit**: Clearer data flow, easier to reason about ordering

**A-07: `schedule_initial_sync` hardcoded delay**
- The 500ms sleep in `session/ssh.rs` is a heuristic
- Could use an event-based approach: wait for `session-changed` instead of sleeping
- **Benefit**: More responsive, no arbitrary delay

**A-08: Dead command builders**
- `#![allow(dead_code)]` in `commands.rs` covers many unused functions
- Consider whether these are part of a planned API or can be removed
- **Truly dead**: `NO_CMD_NUM`, `new_session`, `attach_session`, `list_sessions`, `kill_session`, `kill_window`, `kill_pane`, `display_message_window_layout`, `refresh_client_pane`, `set_pause_after`

**A-09: `Unknown` event handling**
- `handlers.rs` only trace-logs unknown messages
- Could distinguish between "expected unknown" (e.g., `%output` from `-C` mode without `-CC`) and truly unexpected messages
- **Benefit**: Better debugging, clearer logs

**A-10: Error propagation inconsistency**
- Most error paths use `tracing::error!` + early return, but errors are rarely surfaced to the user
- `events.rs` swallows errors in emission
- The `session-closed` event is the only signal for many failure modes
- **Benefit**: Better user experience if errors are surfaced to frontend

**A-11: Extract `write_command_bytes` helper**
- `session.rs` has identical 3-line `write_all + flush` blocks in `write_command` and `request_capture_pane`
- Extracting a private helper reduces duplication and makes error handling consistent
- **See D-01 in duplication analysis above**

**A-12: Generic tabular list parser**
- `parse_window_list` and `parse_pane_list` in `parser.rs` are structurally identical
- Could be a generic `fn parse_tabular_list<T>(lines, min_cols, parser_fn) -> TmuxMessage`
- **See D-08 in duplication analysis above**

**A-13: Lock helper trait**
- `state_tracker.rs` has repeated `.lock().map(...).unwrap_or(false)` and `if let Ok(mut set) = .lock()` patterns
- A generic `with_lock` helper or `LockExt` trait would clean this up
- **See D-10 in duplication analysis above**

**A-14: Unify error conversion**
- `map_err_string()` in `local.rs` vs `.map_err(|e| e.to_string())` in `session.rs`
- Establish one convention: either a trait extension or a typed error
- **See D-05 in duplication analysis above**

---

## 6. Command/Notification/Event Patterns That Could Be Generalized

### Pattern 1: Command Builder Macro/Template
Many commands follow the pattern `format!("<cmd> -t {}\n", id)`:
- `kill_session`, `kill_window`, `kill_pane`, `display_message_window_layout`, `refresh_client_pane`
- A `tmux_cmd_id(cmd: &str, id: &str) -> String` helper would reduce these to one line each

### Pattern 2: Notification → Side Effect + Event
`notification.rs` follows a consistent pattern:
1. Match notification name
2. Optionally mutate tracker state
3. Optionally request state sync
4. Return `TmuxControlEvent`

This could be generalized into a `NotificationHandler` trait or registry:
```rust
trait NotificationHandler {
    fn handle(&self, args: &[String], tracker: &StateTracker) -> Option<TmuxControlEvent>;
    fn needs_sync(&self) -> bool;
}
```

### Pattern 3: Event Emission Wrapper
All `emit_*` functions in `events.rs` follow:
1. Wrap payload in `(session_id, payload)` tuple
2. Serialize to JSON
3. Call `backend.emit(event_name, ...)`
4. Log error if emission fails

This is already partially abstracted by `emit_event`, but `emit_window_list` and `emit_pane_list` are structurally identical after data transformation. A generic `emit_list` helper or macro could reduce duplication.

### Pattern 4: Session Creation Post-Setup
Both `session/local.rs` and `session/ssh.rs` follow the same post-creation sequence:
1. Construct `SessionInfo`
2. Create `exited` atomic
3. Create `capture_queue`
4. Spawn forwarder
5. Return `TmuxSession`

Extracting a `TmuxSession::from_parts` constructor would eliminate this duplication and make the transport-specific files focus only on transport setup.

### Pattern 5: Flow Control State Machine
`state_tracker.rs` tracks two independent boolean flags per pane (paused, copy-mode) using identical `Mutex<HashSet<String>>` patterns. If more pane states are added (e.g., "search mode", "visual mode"), the current pattern scales poorly. A `PaneState` bitflags struct or enum would be more extensible.

---

## 7. Module Documentation Comments

### Well-documented modules
- `mod.rs`: Clear module-level doc explaining service/session type and relationship to `SessionManager`
- `channel_io.rs`: Excellent module-level doc explaining the sync-over-async bridge problem and each type's purpose
- `commands.rs`: Good module-level doc with category grouping
- `parser.rs`: Extensive module-level doc explaining DCS wrapping, protocol format, and response blocks
- `session.rs`: Good module-level doc explaining handle purpose and submodule roles
- `session/local.rs`: Clear doc explaining PTY spawning and lifetime management
- `session/ssh.rs`: Clear doc explaining SSH exec channel and adapter wiring
- `state.rs`: Good doc explaining camelCase for TypeScript compatibility
- `state_tracker.rs`: Good doc explaining pause/copy-mode tracking purpose

### Lightly documented modules
- `events.rs`: Module doc is good but function-level docs are minimal (no `///` on individual `emit_*` functions)
- `forwarder.rs`: Module doc is good but `check_child_status` has no doc comment
- `handlers.rs`: Module doc is good but `handle_message` has no doc comment
- `notification.rs`: Module doc is good but `map_notification` has no doc comment, and `request_state_sync` has no doc comment

### Missing documentation
- `TmuxSessionHandles` has no doc comment on the struct fields (only the struct itself)
- `ResponseClassifier` type alias has a good doc comment but could explain the FIFO assumption more explicitly
- `NO_CMD_NUM` constant has a doc comment but is never used

---

## 8. Summary of Key Findings

| Category | Finding | Severity |
|----------|---------|----------|
| **Architecture** | Clean layered pipeline with two transport paths converging on shared infrastructure | Good |
| **Architecture** | State sync round-trip through frontend is unnecessary complexity | Medium |
| **Architecture** | Capture-pane FIFO queue is fragile under concurrent requests | Medium |
| **Threading** | All tmux service code is sync; async only at SSH boundary | Good design |
| **Threading** | 3 thread categories with sync-over-async bridges | Acceptable |
| **Threading** | `schedule_initial_sync` uses hardcoded 500ms sleep | Low |
| **Naming** | `DispatchState` alias, `build_tmux_command` vs `argv`, `Handles` vs `Tracker` | Low |
| **Naming** | `window-add`/`pane-add` map to `Unknown` while close events exist | Low |
| **Error Handling** | Three different error conversion styles across 3 files | Medium |
| **Error Handling** | SSH `schedule_initial_sync` silently ignores write errors | Medium |
| **Dead Code** | ~9 command builders never called; `TmuxSession`/`TmuxStateSnapshot` unused | Low-Medium |
| **Dead Code** | `TmuxSession::request_capture_pane` dead at runtime | Medium |
| **Duplication** | `write_all + flush` duplicated in `session.rs` | High (easy fix) |
| **Duplication** | `SessionInfo` construction shared between local/ssh | Medium |
| **Duplication** | `parse_window_list` / `parse_pane_list` structurally identical | Medium |
| **Generalization** | Command builder template pattern could be extracted | Low |
| **Generalization** | Notification handler registry could replace match arms | Medium |
| **Generalization** | Session creation post-setup could be templated | Medium |
| **Generalization** | `PaneState` bitflags could replace two HashSets | Low |

---

*Analysis completed on 2026-06-29. All 13 files in `src-tauri/src/services/tmux/` were read and analyzed.*

---

# Test Coverage & Test Infrastructure Analysis

Scope: `src-tauri/src/services/tmux/**` (13 files). Analysis only, no files modified.

## 1. Cargo.toml - Test Configuration

**`src-tauri/Cargo.toml`** (34 lines, full read):

- `[package]` edition = "2021", crate-type `["staticlib", "cdylib", "rlib"]`, lib name `xsterm_lib`.
- **No `[features]` section.** No `tmux-test`, `integration`, or feature flags gating tests.
- **No `[[test]]` targets.** No `src-tauri/tests/` directory (confirmed absent).
- **No `[[bench]]` targets.**
- **No `[profile.test]` overrides.**

### `[dependencies]` (relevant to tests)
- `serde` v1 with `derive` feature (used by state/parser serialization tests).
- `serde_json` v1 (used directly in state.rs tests; used via `serde_json::to_vec` in events.rs/notification.rs).
- `tokio` v1 with `full` feature (production; no `#[tokio::test]` exists in tmux module — `macros`/`rt` already in `full`).
- `tauri` v2 with `"test"` feature enabled.
- `tracing` + `tracing-subscriber` (no test harness wiring).

### `[dev-dependencies]`
- `mockall = "0.12"` + `mockall_derive = "0.12"` — **NOT used anywhere in tmux module**. Zero call sites. Infrastructure for mocking `AppBackend`, `SshBackend`, `PtySystem` exists but is unused.

### Gaps
- No `tempfile`, `wiremock`, `mockito`, `tokio-test`, `pretty_assertions`, `proptest`, `rstest`, `serial_test`.
- No feature flag to disable the tmux integration test (`session.rs`) when tmux binary is missing — it uses a runtime `tmux -V` probe with an `eprintln!` early-return (does NOT mark `#[ignore]`).

## 2. `#[cfg(test)]` Modules and Test Functions

### `parser.rs` (739 lines) — 7 tests, lines 612–739

All synchronous, no async runtime, no fixtures.

| Line | Test | Covers |
|------|------|--------|
| 616 | `parses_output_with_octal_escape` | Plain `%output` line with `\134` (backslash) + `\012` (newline) octal decoding. |
| 631 | `parses_dcs_wrapped_block` | DCS-wrapped (`\x1bP1000p` ... `\x1b\\`) block containing `%output` + `%window-add`. |
| 654 | `parses_streaming_dcs_session` | Streaming DCS `%begin`/`%output`/`%end` producing a `CommandResponse`. |
| 666 | `parses_dcs_terminator_then_plain_line` | DCS terminator with plain `%exit` notification. |
| 678 | `parses_command_response_block` | DCS-wrapped `%begin`/`%end` with tab-separated data line. |
| 696 | `parses_list_windows_response` | `list-windows` reply → `WindowList`. Validates `window_id`, `session_id`, `name`, `active`, `layout`. |
| 718 | `parses_list_panes_response` | `list-panes` reply → `PaneList`. Validates `pane_id`, dimensions, `active` flag. |

**Coverage**: DCS framing, octal escaping, command response aggregation, list parsing (windows + panes).
**Missing**: partial-DCS-without-terminator, malformed input, single-line `%output` outside DCS, `ExtendedOutput` variant, `CapturedPaneOutput`, long inputs / buffer boundaries, multi-byte UTF-8, multiple concurrent DCS blocks (parser re-use).

### `commands.rs` (364 lines) — 17 tests, lines 238–364

Pure string-format unit tests.

| Line | Test | Covers |
|------|------|--------|
| 242 | `send_keys_simple_text` | Basic `send-keys` quoting. |
| 247 | `send_keys_with_space` | Space inside quoted text. |
| 255 | `send_keys_enter` | `\r`, `\n`, `\r\n` → `"Enter"`. |
| 262 | `send_keys_mixed_with_enter` | Text + `\r` produces inline `"Enter"`. |
| 270 | `resize_window_for_pane_format` | `resize-window -t X -x W -y H`. |
| 278 | `new_session_with_name` | `new-session -s "name"`. |
| 286 | `build_tmux_argv_new_session_adds_attach_flags` | Argv builder adds `-A -D` for `new-session`. |
| 292 | `build_tmux_argv_new_session_without_target` | Omits `-s` when target=None. |
| 298 | `build_tmux_argv_attach_session_uses_new_session_with_attach_flags` | `attach-session` rewritten to `new-session -A -D -s`. |
| 304 | `build_tmux_argv_does_not_duplicate_flags` | Dedupes pre-existing `-A -D -s`. |
| 314 | `no_cmd_num_is_zero` | Compile-time sanity check for `NO_CMD_NUM`. |
| 319 | `attach_session_format` | `attach-session -t X`. |
| 327 | `list_sessions_format` | `list-sessions`. |
| 332 | `kill_session_format` | `kill-session -t X`. |
| 337 | `kill_window_format` | `kill-window -t X`. |
| 342 | `kill_pane_format` | `kill-pane -t X`. |
| 347 | `display_message_window_layout_format` | `display-message -t X -p '#{window_layout}'`. |
| 355 | `refresh_client_pane_format` | `refresh-client -A X:continue`. |
| 360 | `set_pause_after_format` | `refresh-client -p N`. |

**Coverage**: All public string builders + argv dedupe logic.
**Missing**: `list_windows`, `list_panes` formats (referenced in `session.rs` integration but no unit test), `send_keys` with tabs / backslashes / double-quotes (escape semantics), empty string input, Unicode. Tests at 314+ explicitly exist only to keep `pub` API from being dead-code-eliminated (per in-file comment) — they assert const values, not behavior.

### `state.rs` (349 lines) — 5 tests, lines 201–349

Serialization tests only.

| Line | Test | Covers |
|------|------|--------|
| 206 | `window_list_serializes_to_camel_case` | `TmuxControlEvent::WindowList` → `windowId`/`sessionId`, no snake_case. |
| 235 | `pane_list_serializes_to_camel_case` | `TmuxControlEvent::PaneList` → `paneId`/`windowId`/`sessionId`. |
| 271 | `pane_output_serializes_to_camel_case` | `TmuxPaneOutput` → `paneId`. |
| 294 | `tmux_session_serializes_to_camel_case` | `TmuxSession` → `activeWindowId` (kept to avoid dead-code). |
| 315 | `tmux_state_snapshot_serializes_to_camel_case` | `TmuxStateSnapshot` → `activeWindowId`, `activePaneId`, `inCopyMode`. |

**Coverage**: camelCase serialization contract for IPC payloads.
**Missing**: `CommandResponse`, `CommandError`, `Exit`, `SessionChanged`, `SessionRenamed`, `WindowClosed`, `WindowRenamed`, `WindowActivated`, `LayoutChanged`, `PanePaused`, `PaneContinued`, `PaneClosed`, `PaneTitleChanged`, `PaneModeChanged`, `Unknown` variants — none tested. No deserialization round-trip tests. `TmuxWindow` / `TmuxPane` constructed only via `..Default::default()` (defaults untested).

### `session.rs` (232 lines) — 1 test (INTEGRATION, requires tmux), lines 80–232

Module is named `integration_tests`.

| Line | Test | Covers |
|------|------|--------|
| 113 | `real_tmux_session_emits_window_list` | Spawns real `tmux -CC` via `NativePtySystem`, drives `list-windows` + `list-panes`, asserts backend receives `tmux-control-event`, `tmux-pane-output`, `tmux-request-sync`, an active `WindowList`, and a non-empty `PaneList`. |

**Runtime guards** (lines 115–122): if `tmux -V` fails, prints `tmux not installed, skipping integration test` and returns. **Does NOT use `#[ignore]`** — silently passes on missing tmux. Helpers `wait_for_window_list` (193) and `wait_for_session_changed` (214) defined inline.

**Requires**: real `tmux` binary on `$PATH`.

### `state_tracker.rs` (101 lines) — 2 tests, lines 78–101

| Line | Test | Covers |
|------|------|--------|
| 82 | `tracks_paused_and_continued_panes` | `mark_paused` / `mark_continued` / `is_paused`. |
| 92 | `toggles_copy_mode` | `toggle_copy_mode` / `is_in_copy_mode` boolean flip. |

**Coverage**: Pause + copy-mode flags.
**Missing**: concurrent access (thread-safe by design but untested under contention), multiple distinct pane_ids independence, internal collection growth/replacement (verify during refactor — may be `HashSet`).

## 3. Files With ZERO Tests

| File | LOC | Public surface | Test risk |
|------|-----|----------------|-----------|
| `mod.rs` | 19 | Module wiring + re-exports | None (declarative only). |
| `events.rs` | 92 | `emit_pane_output`, `emit_control_event`, `emit_closed`, `emit_captured_pane_output`, `emit_command_error`, `emit_window_list`, `emit_pane_list` | **HIGH.** Payload wrapping `(_, T)`, JSON shape, backend error logging, `emit_captured_pane_output` empty-lines early-return, `WindowListEntry::into` / `PaneListEntry::into` — all untested. |
| `notification.rs` | 148 | `map_notification` (16-arm match), `request_state_sync` | **HIGH — biggest hole.** 16 match arms, 0 tests. Args-length guards, side effects on `tracker`/`exited`, `tmux-request-sync` emission — all uncovered. |
| `forwarder.rs` | 115 | `spawn_control_forwarder`, `check_child_status` | **MEDIUM.** Spawns OS threads; needs `mockall` for `AppBackend`/`Child`/`Read`. Genuinely hard to unit-test without scaffolding. |
| `handlers.rs` | 61 | `handle_message`, `DispatchState` alias | **HIGH.** 7-variant dispatch matrix, 0 tests. Pause-state suppression of `Output` is critical and uncovered. `Unknown` trace-only branch uncovered. |
| `channel_io.rs` | 115 | `CapturePaneQueue`, `ChannelWriter` (Write), `ChannelReader` (Read), `build_tmux_command` | **HIGH.** `ChannelWriter::write` error mapping (`BrokenPipe`), `ChannelReader` buffering across multiple `recv()`, EOF (`Ok(None)`), broken-pipe error, partial-buffer reads, `build_tmux_command` with/without socket — all untested. Pure synchronous, easily testable. |
| `session/local.rs` | 98 | `create_tmux_session` | **MEDIUM.** Requires `PtySystem` mock + tmux binary. Partially covered by `session.rs` integration test. |
| `session/ssh.rs` | 118 | `create_ssh_tmux_session`, `schedule_initial_sync` | **HIGH.** SSH path **never exercised by any test**. `schedule_initial_sync` thread spawn + lock failure path uncovered. |

## 4. Tests Requiring Real tmux Binary

| Test | File | Behavior without tmux |
|------|------|------------------------|
| `real_tmux_session_emits_window_list` | `session.rs:113` | Probes `tmux -V`; if absent, prints `tmux not installed, skipping integration test` and returns. **Silently passes** — no `#[ignore]`, no failure signal. |

**Zero `#[ignore]` attributes** in the entire tmux module. CI without tmux will report all-green because the integration test self-skips.

## 5. Untested / Poorly Tested Areas (Ranked)

1. **`notification.rs::map_notification`** — 16 match arms, 0 tests. Single biggest coverage hole. Pure function (apart from backend.emit + atomic store), trivially unit-testable with a `TestBackend`.
2. **`handlers.rs::handle_message`** — 7-variant dispatch matrix, 0 tests. Pause-state gate (`!state.is_paused`) is critical and uncovered. Mockall `AppBackend` slots in cleanly.
3. **`channel_io.rs`** — 3 distinct types, 0 tests. Pure synchronous code, easiest target.
4. **`events.rs`** — 7 emit functions, 0 tests. Trivial with `TestBackend` collecting `(event_name, payload_bytes)` + JSON parse for shape assertions.
5. **`session/ssh.rs`** — Entire SSH code path untested. Hardest to unit-test (needs `SshBackend` mock).
6. **`parser.rs`** — DCS unwrap + octal escape + multi-variant parse. Adequate for happy paths; missing edge cases (malformed DCS, `ExtendedOutput`, buffer-boundary splits, multiple concurrent blocks).
7. **`state.rs`** — Only 5 of ~15 enum variants have serialization tests.
8. **`forwarder.rs`** — Background-thread + I/O loop. Hard to unit-test; would benefit from a fake `Read` and a `TestBackend`.

## 6. Verification Commands

```bash
# Type-check + build (must exit 0)
cd src-tauri && cargo check
cd src-tauri && cargo build

# Run all unit + integration tests in tmux module
cd src-tauri && cargo test --lib services::tmux
# Or all tests in the crate:
cd src-tauri && cargo test

# Specific sub-modules
cd src-tauri && cargo test --lib services::tmux::parser
cd src-tauri && cargo test --lib services::tmux::commands
cd src-tauri && cargo test --lib services::tmux::state
cd src-tauri && cargo test --lib services::tmux::state_tracker
cd src-tauri && cargo test --lib services::tmux::session::integration_tests

# Lints
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo fmt --check

# Run the tmux integration test only when tmux is installed
command -v tmux >/dev/null && cargo test --lib services::tmux::session::integration_tests || echo "tmux not installed"
```

**CI considerations**:
- `cargo test` currently reports all-green even without tmux because `real_tmux_session_emits_window_list` self-skips. Recommend either:
  - `#[ignore]` + `cargo test -- --ignored` in CI-with-tmux lane, OR
  - A `tmux` feature flag in `Cargo.toml`, OR
  - A CI precondition that fails if `tmux` is missing AND the integration test path is included.

## 7. Summary Table

| File | LOC | #[cfg(test)] | # tests | tmux binary? | Coverage verdict |
|------|-----|--------------|---------|--------------|------------------|
| `mod.rs` | 19 | no | 0 | no | n/a (wiring only) |
| `parser.rs` | 739 | yes | 7 | no | Adequate (happy paths only) |
| `commands.rs` | 364 | yes | 17 | no | Strong (all builders) |
| `state.rs` | 349 | yes | 5 | no | Partial (5/15+ variants) |
| `state_tracker.rs` | 101 | yes | 2 | no | Minimal but OK |
| `session.rs` | 232 | yes | 1 | **yes** | Integration only, single test |
| `events.rs` | 92 | no | 0 | no | **Untested** |
| `notification.rs` | 148 | no | 0 | no | **Untested (biggest hole)** |
| `forwarder.rs` | 115 | no | 0 | no | **Untested (hard)** |
| `handlers.rs` | 61 | no | 0 | no | **Untested (big hole)** |
| `channel_io.rs` | 115 | no | 0 | no | **Untested (easy target)** |
| `session/local.rs` | 98 | no | 0 | partial | Untested (covered by integration) |
| `session/ssh.rs` | 118 | no | 0 | no | **Untested (no SSH integration test exists)** |

**Totals**: 30 unit tests + 1 tmux-binary integration test across 13 files. **8/13 files have zero tests.** `mockall` is declared but unused — opportunity for handlers/events/notification coverage.

## 8. Recommendations (for refactor phase, not acted on now)

- Add `#[cfg(test)] mod tests` blocks to `notification.rs`, `handlers.rs`, `events.rs`, `channel_io.rs` with a small `TestBackend` modeled on `session.rs::TestBackend` capturing emitted `(event_name, payload)`.
- Convert `session.rs::integration_tests::real_tmux_session_emits_window_list` to `#[ignore]` and run it explicitly in a CI lane that installs tmux — current silent-pass is misleading.
- Add `[[test]]` integration targets under `src-tauri/tests/` for SSH + forwarded-bytes end-to-end flows with `mockall` doubles.
- Exercise `parser.rs` edge cases: malformed DCS (no `\x1b\\` terminator), `ExtendedOutput`, partial-read boundaries, multiple DCS blocks interleaved.
- Add `TmuxControlEvent` serialization tests for the 10+ variants currently uncovered in `state.rs`.
- Consider a `feature = "tmux-integration"` flag gating the SSH/local integration tests.

# Tmux Module Refactor Analysis

> Generated: 2026-06-29
> Scope: `src-tauri/src/services/tmux` (13 files)
> Strategy: Aggressive refactoring allowed

---

## 1. Functions Over 50 Lines

| Function | File | Lines | Body Range |
|----------|------|-------|------------|
| `map_notification` | `notification.rs` | 105 | 21-134 |
| `real_tmux_session_emits_window_list` | `session.rs` | 78 | 113-191 |
| `create_tmux_session` | `session/local.rs` | 74 | 25-98 |
| `create_ssh_tmux_session` | `session/ssh.rs` | 72 | 22-94 |
| `classify_command_response` | `parser.rs` | 34 | 534-568 |
| `spawn_control_forwarder` | `forwarder.rs` | 47 | 26-81 |
| `check_child_status` | `forwarder.rs` | 32 | 84-115 |
| `handle_message` | `handlers.rs` | 31 | 24-61 |
| `try_parse_one` | `parser.rs` | 28 | 233-261 |
| `parse_output_line` | `parser.rs` | 25 | 455-480 |
| `parse_control_line` | `parser.rs` | 24 | 332-355 |
| `unescape_tmux_output` | `parser.rs` | 23 | 492-516 |
| `flush` | `parser.rs` | 22 | 204-226 |
| `schedule_initial_sync` | `session/ssh.rs` | 22 | 97-118 |
| `wait_for_window_list` | `session.rs` | 19 | 193-212 |
| `parse_pane_list` | `parser.rs` | 17 | 588-605 |
| `request_capture_pane` | `session.rs` | 17 | 55-72 |
| `parse_window_list` | `parser.rs` | 16 | 570-586 |
| `start_command_response` | `parser.rs` | 16 | 385-401 |
| `handle_response_notification` | `parser.rs` | 18 | 365-383 |
| `abort_command_response` | `parser.rs` | 15 | 430-444 |
| `handle_control_line` | `parser.rs` | 15 | 314-329 |
| `build_tmux_argv` | `commands.rs` | 23 | 40-63 |
| `escape_tmux_keys` | `commands.rs` | 18 | 199-217 |
| `read` (ChannelReader) | `channel_io.rs` | 22 | 82-104 |
| `emit_event` | `events.rs` | 10 | 12-22 |
| `emit_captured_pane_output` | `events.rs` | 12 | 43-54 |
| `emit_command_error` | `events.rs` | 11 | 57-67 |
| `emit_window_list` | `events.rs` | 13 | 70-82 |
| `emit_pane_list` | `events.rs` | 13 | 84-92 |
| `request_state_sync` | `notification.rs` | 12 | 137-148 |
| `toggle_copy_mode` | `state_tracker.rs` | 11 | 57-67 |
| `is_in_copy_mode` | `state_tracker.rs` | 5 | 70-75 |
| `is_paused` | `state_tracker.rs` | 5 | 49-54 |
| `mark_paused` | `state_tracker.rs` | 5 | 35-39 |
| `mark_continued` | `state_tracker.rs` | 5 | 42-46 |

**Candidates for simplification (>50 lines or borderline complex):**
- `map_notification` (105 lines) — massive match statement with 15+ arms
- `real_tmux_session_emits_window_list` (78 lines) — integration test with deep nesting
- `create_tmux_session` (74 lines) — setup boilerplate, could be builder pattern
- `create_ssh_tmux_session` (72 lines) — similar setup boilerplate
- `classify_command_response` (34 lines) — moderate but nested logic
- `spawn_control_forwarder` (47 lines) — near threshold, thread spawn + loop
- `check_child_status` (32 lines) — nested option handling

---

## 2. Deeply Nested Match/If Structures (3+ Levels)

### A. `notification.rs:map_notification` — 1-level match, but 15+ arms
```rust
match name {
    "pause" if !args.is_empty() => { ... }
    "continue" if !args.is_empty() => { ... }
    "session-changed" if args.len() >= 2 => { ... }
    ... // 15 arms total
}
```
**Nesting depth:** 1 (match) + guard conditions. Not deeply nested but extremely wide.
**Simplification:** Extract arms into a dispatch table (`HashMap<&str, fn(...) -> TmuxControlEvent>`) or a `NotificationHandler` trait.

### B. `parser.rs:try_parse_one` — 3 levels
```rust
if self.in_dcs {
    if self.consume_dcs_terminator() {   // level 2
        self.in_dcs = false;
        return self.try_parse_one();    // level 3 (recursion)
    }
    let line = self.take_line()?;
    if line.is_empty() {                // level 2
        return self.try_parse_one();    // level 3 (recursion)
    }
    return self.handle_control_line(&line);
}
```
**Simplification:** Flatten with early returns; replace recursion with a loop or state machine.

### C. `parser.rs:parse_control_line` — 3 levels via strip_prefix chain
```rust
if let Some(rest) = line.strip_prefix("%output ") { ... }
if let Some(rest) = line.strip_prefix("%extended-output ") { ... }
if let Some(rest) = line.strip_prefix('%') { ... }
```
Not deeply nested but sequential. Could use a `match` on `line.split_once(' ')`.

### D. `parser.rs:finish_command_response` — 3 levels
```rust
let pending = self.pending_response.take()?;          // level 1 (Option)
if let Some(pane_id) = pending.capture_pane_id {      // level 2
    return Some(TmuxMessage::CapturedPaneOutput { ... });
}
let response = TmuxMessage::CommandResponse { ... };  // level 3 (construction)
Some(classify_command_response(response))
```

### E. `session.rs:real_tmux_session_emits_window_list` — 4+ levels in assertions
```rust
assert!(
    !control_events.is_empty() || has_output,
    "expected ..."
);
assert!(has_sync_request, "...");
assert!(has_active_window, "...");
assert!(has_panes, "...");
```
Plus deeply nested `match` in `wait_for_window_list` and `wait_for_session_changed`.

### F. `session/local.rs:create_tmux_session` — 3 levels (Option + Result chaining)
```rust
if let Some(socket) = &config.socket { ... }  // level 1
let child = pair.spawn(cmd).map_err_string()?; // level 2 (Result)
let writer = Arc::new(Mutex::new(pair.master_writer().map_err_string()?)); // level 3
```

### G. `session/ssh.rs:create_ssh_tmux_session` — 3 levels
```rust
let SshConnectResult { ... } = ssh_backend
    .connect_exec(...)
    .map_err(|e| { ... })?;  // level 2
let writer = Arc::new(Mutex::new(
    Box::new(ChannelWriter::new(write_tx)) as Box<dyn Write + Send>  // level 3
));
```

---

## 3. High Cyclomatic Complexity

| Function | Complexity | Drivers |
|----------|------------|---------|
| `map_notification` | ~17 | 15 match arms + guard conditions |
| `classify_command_response` | ~8 | Multiple pattern checks on tab-separated data |
| `parse_control_line` | ~6 | 3 prefix checks + notification parsing |
| `try_parse_one` | ~6 | DCS state + line extraction + recursion |
| `check_child_status` | ~5 | Option + timing + lock + child status |
| `escape_tmux_keys` | ~5 | Match on chars with peek logic |
| `build_tmux_argv` | ~5 | Match on command + flag manipulation |
| `unescape_tmux_output` | ~4 | Byte-level parsing with bounds checks |
| `handle_message` | ~4 | 6 match arms |
| `create_tmux_session` | ~4 | Setup sequence with conditionals |
| `create_ssh_tmux_session` | ~4 | Similar setup sequence |
| `write_command` | ~3 | Lock + write + flush |
| `request_capture_pane` | ~3 | Lock + queue + lock + write + flush |

---

## 4. State Mutation Patterns

### A. Dual `Mutex<HashSet<String>>` in `StateTracker`
```rust
pub struct StateTracker {
    paused_panes: Mutex<HashSet<String>>,
    copy_mode_panes: Mutex<HashSet<String>>,
}
```
**Issue:** Two separate mutexes for the same pattern (pane id tracking). Could be unified into a single `Mutex<PaneStateMap>` or use a `RwLock` if reads dominate.
**Simplification:**
```rust
struct PaneState {
    paused: HashSet<String>,
    copy_mode: HashSet<String>,
}
pub struct StateTracker {
    state: Mutex<PaneState>,
}
```

### B. `TmuxSession` field mutation via `Arc<AtomicBool>`
```rust
pub struct TmuxSession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    capture_queue: CapturePaneQueue,  // Arc<Mutex<...>>
    exited: Arc<AtomicBool>,
    _ssh_channel: Option<Box<dyn SshChannel + Send>>,
}
```
**Issue:** `TmuxSession` is conceptually a handle but holds mutable state. The `exited` flag is shared with the forwarder thread. `writer` and `capture_queue` are also shared.
**Simplification:** Consider splitting into `TmuxSessionHandle` (cloneable, thread-safe) and `TmuxSessionState` (owned by one thread).

### C. `request_capture_pane` locks writer twice
```rust
pub fn request_capture_pane(&self, pane_id: &str, history: usize) -> Result<(), String> {
    {
        let mut queue = self.capture_queue.lock().map_err(|e| e.to_string())?;
        queue.push_back(pane_id.to_string());
    }  // drop lock 1
    // ... build command ...
    let mut writer = self.writer.lock().map_err(|e| e.to_string())?;  // lock 2
    writer.write_all(...)?;
    writer.flush()
}
```
**Issue:** Two separate lock acquisitions in one method. Not a deadlock risk (different mutexes), but could be unified with a single state lock if refactored.

### D. `check_child_status` mutates `last_check` via side effect
```rust
fn check_child_status(..., last_check: &mut Instant) -> bool {
    if last_check.elapsed() < CHILD_CHECK_INTERVAL { return false; }
    *last_check = Instant::now();  // side effect
    ...
}
```
**Issue:** Side-effect + boolean return is confusing. Could return `Option<ChildStatus>` and let caller update `last_check`.

---

## 5. Error Handling Inconsistencies

### A. `unwrap()` / `expect()` in production code (not tests)

| Location | Context | Severity |
|----------|---------|----------|
| `events.rs:19` | `serde_json::to_vec(&wrapped).unwrap()` in `emit_event` | **HIGH** — panics if serialization fails |
| `notification.rs:145` | `serde_json::to_vec(&payload).unwrap()` in `request_state_sync` | **HIGH** — same issue |
| `session.rs:137` | `.expect("failed to create tmux session")` in test | LOW (test only) |
| `session.rs:142,147` | `.expect(...)` in test | LOW (test only) |

**Issue:** `emit_event` and `request_state_sync` use `unwrap()` on JSON serialization. This is infallible for the types used, but it's still a code smell. Should use `?` or `if let Err(e)` consistently.

### B. `StringError` / `map_err_string()` pattern
```rust
// session/local.rs
let mut pair = pty_system.openpty(...).map_err_string()?;
let writer = Arc::new(Mutex::new(pair.master_writer().map_err_string()?));
```
**Issue:** `map_err_string()` converts all errors to `String`, losing error type information. This is used throughout the module. Consider a dedicated `TmuxError` enum.

### C. `map_err(|e| e.to_string())` in `TmuxSession`
```rust
let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
```
**Issue:** Poisoned mutex errors are converted to plain strings, making debugging harder. Should at least log the original error.

### D. `lock().ok()` silently ignores poisoned mutexes
```rust
// forwarder.rs
let classifier_queue = Arc::clone(&capture_queue_clone);
let mut parser = TmuxControlParser::with_classifier(move || classifier_queue.lock().ok()?.pop_front());
```
```rust
// state_tracker.rs
if let Ok(mut set) = self.paused_panes.lock() { ... }
```
**Issue:** Poisoned mutexes are silently ignored. In `forwarder.rs`, if the mutex is poisoned, the classifier returns `None` and capture-pane responses are misclassified. In `state_tracker.rs`, state updates are silently lost.

### E. `ChannelWriter::flush()` is a no-op
```rust
impl Write for ChannelWriter {
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}
```
**Issue:** `flush()` does nothing, but callers (e.g., `write_command`, `request_capture_pane`) call it after every write. This is misleading. Should either document it or remove the call if the channel is unbounded.

### F. `request_state_sync` ignores `tmux_session_id` parameter
```rust
fn request_state_sync<B: AppBackend>(backend: &B, session_id: u32, tmux_session_id: &str) {
    let command = list_windows(tmux_session_id);  // passed but...
    // ...
}
```
Wait, `list_windows` does use `tmux_session_id`. But in `notification.rs`:
```rust
"session-changed" if args.len() >= 2 => {
    request_state_sync(backend, session_id, "");  // empty string!
    ...
}
```
**Issue:** `request_state_sync` is called with `""` for `session-changed`, which triggers `list_windows` without a `-t` target. This is intentional (list all windows), but the empty string is a magic value. Should use `Option<&str>`.

---

## 6. `unwrap()` / `expect()` Inventory

### Production code (non-test):

| File | Line | Code | Risk |
|------|------|------|------|
| `events.rs` | 19 | `serde_json::to_vec(&wrapped).unwrap()` | Low (infallible for these types) but bad practice |
| `notification.rs` | 145 | `serde_json::to_vec(&payload).unwrap()` | Low (same) but bad practice |

### Test code:

| File | Line | Code |
|------|------|------|
| `session.rs` | 103 | `.unwrap()` |
| `session.rs` | 137 | `.expect("failed to create tmux session")` |
| `session.rs` | 142 | `.expect("failed to write list-windows")` |
| `session.rs` | 147 | `.expect("failed to write list-panes")` |
| `session.rs` | 151 | `.lock().unwrap()` |
| `session.rs` | 160 | `.unwrap()` |
| `session.rs` | 196 | `.lock().unwrap().clone()` |
| `session.rs` | 202 | `.unwrap()` |
| `session.rs` | 217 | `.lock().unwrap().clone()` |
| `session.rs` | 223 | `.unwrap()` |
| `state.rs` | 217 | `serde_json::to_string(&event).unwrap()` |
| `state.rs` | 248 | `serde_json::to_string(&event).unwrap()` |
| `state.rs` | 277 | `serde_json::to_string(&output).unwrap()` |
| `state.rs` | 302 | `serde_json::to_string(&session).unwrap()` |
| `state.rs` | 332 | `serde_json::to_string(&snapshot).unwrap()` |

---

## 7. Manual Lock Management

### A. `Mutex` lock without RAII guard in `state_tracker.rs`
```rust
pub fn mark_paused(&self, pane_id: &str) {
    if let Ok(mut set) = self.paused_panes.lock() {
        set.insert(pane_id.to_string());
    }  // guard dropped here — OK
}
```
**Issue:** Uses `if let Ok` instead of `let Ok(guard) = ... else { return; }`. Not a bug, but inconsistent with modern Rust patterns.

### B. `TmuxSession::write_command` — manual lock + chained Result
```rust
pub fn write_command(&mut self, command: &str) -> Result<(), String> {
    let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
    writer.write_all(command.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}
```
**Issue:** Three `map_err` calls in one function. Could use a helper macro or `?` with a custom `From` impl.

### C. `forwarder.rs` — `Arc<Mutex<...>>` passed to closure
```rust
let child_for_forwarder: Arc<Mutex<Box<dyn Child>>> = Arc::new(Mutex::new(child));
spawn_control_forwarder(
    reader,
    backend,
    session_id,
    Arc::clone(&exited),
    Some(Arc::clone(&child_for_forwarder)),
    Arc::clone(&capture_queue),
);
```
**Issue:** `child` is wrapped in `Arc<Mutex<Box<dyn Child>>>`, but `Child` trait methods are called through the mutex. The `check_child_status` function takes `Option<&Arc<Mutex<...>>>` which is unnecessarily complex. Could pass `Option<&dyn Child>` if the caller held the lock.

---

## 8. Simplification Strategies

### Immediate wins (low risk, high clarity)

1. **Replace `map_notification` match with dispatch table**
   ```rust
   type NotificationHandler = fn(&[String], &str, &StateTracker, &Arc<AtomicBool>) -> TmuxControlEvent;
   static HANDLERS: phf::Map<&'static str, NotificationHandler> = ...
   ```
   Or use a macro to generate the match arms. Reduces 105 lines to ~30.

2. **Extract `emit_event` JSON serialization into a fallible helper**
   ```rust
   fn emit_event<B: AppBackend, T: serde::Serialize>(...) {
       match serde_json::to_vec(&wrapped) {
           Ok(bytes) => { ... }
           Err(e) => tracing::error!("serialization failed: {}", e),
       }
   }
   ```
   Removes `unwrap()` from production code.

3. **Unify `StateTracker` mutexes**
   ```rust
   struct PaneState {
       paused: HashSet<String>,
       copy_mode: HashSet<String>,
   }
   ```
   Single lock, clearer intent.

4. **Flatten `try_parse_one` recursion**
   Replace recursive calls with a `while let` loop or state machine.

5. **Extract `parse_output_line` into `OutputLineParser` struct**
   The `extended` bool parameter is a code smell. Use two methods or an enum.

6. **Use `?` with a custom `TmuxError` instead of `map_err(|e| e.to_string())`**
   ```rust
   enum TmuxError {
       Lock(String),
       Io(io::Error),
       Serialization(serde_json::Error),
   }
   ```

### Medium effort (structural changes)

7. **Split `TmuxSession` into `Handle` + `State`**
   - `TmuxSessionHandle`: cloneable, holds `Arc<Mutex<Writer>>`, `Arc<AtomicBool>`
   - `TmuxSessionState`: owned by the forwarder thread

8. **Extract session creation into a `SessionBuilder`**
   Both `create_tmux_session` and `create_ssh_tmux_session` follow the same pattern:
   - Build command
   - Spawn transport
   - Create `SessionInfo`
   - Spawn forwarder
   - Return handle
   A builder could eliminate ~40 lines of duplication.

9. **Refactor `classify_command_response` to use a `ResponseClassifier` trait**
   Instead of pattern-matching on tab-separated data, register classifiers for known commands.

10. **Move integration test out of `session.rs`**
    The `real_tmux_session_emits_window_list` test is 78 lines and requires `tmux` installed. It should live in `tests/integration/tmux_session.rs`.

### Aggressive (high effort, high reward)

11. **Replace `TmuxControlParser` with a `nom` or `winnow` parser**
    The current parser is hand-rolled with stateful buffer management. A parser-combinator approach would eliminate the `try_parse_one` recursion and make the DCS handling declarative.

12. **Replace `Arc<Mutex<...>>` with `tokio::sync::mpsc` for all I/O**
    The module uses blocking I/O (`std::io::Read`) in a dedicated thread. If the rest of the app is async, converting to async channels would eliminate all mutexes.

13. **Generate `TmuxControlEvent` from a schema or macro**
    The enum has 18 variants, many with the same fields (`pane_id`, `window_id`). A derive macro or code generation could reduce boilerplate.

14. **Unify `list_windows` and `list_panes` format strings**
    Both use hardcoded `-F` format strings. These should be constants or generated from a `TmuxFormat` builder.

---

## 9. File-by-File Summary

| File | Lines | Issues | Priority |
|------|-------|--------|----------|
| `parser.rs` | 739 | Complex parser, recursion, many small functions | **HIGH** |
| `session.rs` | 232 | Long integration test, unwraps in test | MEDIUM |
| `commands.rs` | 364 | `allow(dead_code)`, many untested builders | LOW |
| `state.rs` | 349 | Mostly data + tests, clean | LOW |
| `notification.rs` | 148 | Massive match (105 lines), unwrap in prod | **HIGH** |
| `forwarder.rs` | 115 | Side-effect function, lock in closure | MEDIUM |
| `session/local.rs` | 98 | Boilerplate setup, `map_err_string` | MEDIUM |
| `session/ssh.rs` | 118 | Similar boilerplate, `schedule_initial_sync` hack | MEDIUM |
| `channel_io.rs` | 115 | `flush()` no-op, `Read` adapter OK | LOW |
| `events.rs` | 92 | `unwrap()` in prod, thin wrappers | MEDIUM |
| `handlers.rs` | 61 | Clean, simple dispatch | LOW |
| `state_tracker.rs` | 101 | Dual mutexes, `lock().ok()` | MEDIUM |
| `mod.rs` | 19 | Clean | LOW |

---

## 10. Top 5 Refactor Targets

1. **`notification.rs:map_notification`** — 105-line match, highest complexity
2. **`parser.rs:TmuxControlParser`** — 739-line file, recursive parser, many small functions that could be unified
3. **`session.rs:real_tmux_session_emits_window_list`** — 78-line integration test, deeply nested, should be extracted
4. **`events.rs:emit_event`** — `unwrap()` in production, plus all thin wrappers could be macro-generated
5. **`state_tracker.rs`** — Dual mutexes, `lock().ok()` silently dropping poisoned locks

