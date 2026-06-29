# Task Plan: Refactor `run_data_loop` in `src/infrastructure/ssh.rs`

## Goal
Eliminate the duplicated `channel.wait()` and `write_rx.recv()` handling between the resize-enabled and resize-disabled branches of `run_data_loop`, while preserving exact behavior.

## Phases

### Phase 1: Exploration
- [x] Read `src/infrastructure/ssh.rs` around lines 276-385 to understand the duplicated code.
- [x] Note the exact match arms, logging, and break conditions.
- [x] Identify that the only difference is the optional `resize = rx.recv()` arm.

### Phase 2: Design
- [x] Decide helper extraction strategy.
- [x] Ensure helper signatures allow reuse without behavioral change.
- [x] Plan a single `tokio::select!` with a conditional resize arm.

### Phase 3: Implementation
- [x] Extract channel message handling into a helper returning `bool` (break flag).
- [x] Extract write-channel data forwarding into a helper returning `bool` (break flag).
- [x] Rewrite `run_data_loop` with a single `tokio::select!` and conditional resize arm.

### Phase 4: Verification
- [x] Run `cargo check` in `src-tauri` and ensure no new errors or warnings.
- [x] Run SSH/session manager tests with `cargo test`.
- [x] Confirm all tests pass.

## Decisions Log
- Use `tokio::select!` with `if resize_rx.is_some()` precondition on the resize arm so the branch is only enabled when a resize receiver exists.
- Helpers return `bool` to indicate whether the main loop should break.
- Helper parameter for `channel_id` uses `russh::ChannelId` to match `channel.id()`'s return type.

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `mismatched types` for `channel_id` | 1 | Changed `forward_write_data` parameter from `u32` to `russh::ChannelId`. |
| Pre-existing unused import warning | N/A | Unrelated to this refactor; left unchanged. |
