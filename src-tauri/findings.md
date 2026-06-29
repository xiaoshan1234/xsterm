# Findings

## Current Code (`src/infrastructure/ssh.rs` lines 276-385)
`run_data_loop` has two nearly identical `tokio::select!` branches:

1. When `resize_rx` is `Some(ref mut rx)`, the select awaits:
   - `msg = channel.wait()`
   - `data = write_rx.recv()`
   - `resize = rx.recv()`

2. When `resize_rx` is `None`, the select awaits only:
   - `msg = channel.wait()`
   - `data = write_rx.recv()`

The handling of `channel.wait()` and `write_rx.recv()` is duplicated verbatim, including logging messages and break conditions.

## Key Observations
- The `channel.wait()` branch handles:
  - `ChannelMsg::Data` → forward to `read_tx`
  - `ChannelMsg::ExtendedData` → forward to `read_tx`
  - `ChannelMsg::Eof` → send `None` to `read_tx`, log, break
  - `ChannelMsg::Close` → send `None` to `read_tx`, log, break
  - `None` → send `None` to `read_tx`, log, break
  - `_` → ignore
- The `write_rx.recv()` branch handles:
  - `Some(d)` → call `handle.data(channel_id, CryptoVec::from_slice(&d))`, log error and break on failure
  - `None` → log and break
- The resize branch handles:
  - `Some((cols, rows))` → call `channel.window_change(...)`, log on success
  - `None` → log and set `resize_rx = None`

## Refactor Strategy
Extract two async helpers:
- `handle_channel_msg(msg, read_tx) -> bool` returns `true` when the loop should break.
- `forward_write_data(handle, channel_id, data) -> bool` returns `true` when the loop should break.

Rewrite `run_data_loop` with a single `tokio::select!` and a conditional resize arm:
```rust
resize = resize_rx.as_mut().unwrap().recv(), if resize_rx.is_some() => { ... }
```
This keeps the resize branch optional without duplicating the other arms.
