# Services · Capture — 对下依赖

> **位置**：`src-tauri/src/services/capture/`
> **依赖层级**：薄封装，依赖少

## 1. 依赖图

```
services/capture/mod.rs
├── services/subscribe::SubscribeRegistry (OutputRing)
├── services/session_manager::SessionManager (capture_* fallback)
└── external: regex (ansi strip)

services/capture/text.rs
├── services/subscribe::OutputRing::tail
└── regex::Regex (strip_ansi)

services/capture/ansi.rs
└── services/subscribe::OutputRing::tail

services/capture/screenshot.rs
└── (MVP) 直接返回 UnsupportedMode
```

## 2. 外部 crate 依赖

| crate | 用途 |
|---|---|
| `regex` | ANSI CSI / OSC 转义剥离 |
| `serde` | CaptureResult / CaptureError 序列化 |
| `schemars` | CaptureMode JsonSchema 派生 |

## 3. 内部模块依赖

| 模块 | 来源 | 用途 |
|---|---|---|
| `services::subscribe::OutputRing` | `services/subscribe/` | tail() 读最近 N 行 |
| `services::subscribe::SubscribeRegistry` | `services/subscribe/` | get_or_create session_id → OutputRing |
| `services::session_manager::capture_*` | `services/session_manager.rs` | SessionBackend trait fallback |

## 4. 上游 caller

| caller | 调什么 | 何时 |
|---|---|---|
| `mcp_server/tools/capture_screen` | `capture_screen(session_id, mode, lines, &registry)` | MCP `capture_screen` 工具 |

## 5. 下游被调

| callee | 来源 | 何时 |
|---|---|---|
| `subscribe::OutputRing::tail(n)` | `services/subscribe/` | 每次 capture_screen 调用 |
| `session_manager::capture_text / capture_ansi` | `services/session_manager.rs` | tmux session 的精确 capture（future） |

## 6. 不允许的依赖

- ❌ `services/capture/*` → `services/attach`（capture 不感知 attach）
- ❌ `services/capture/*` → `services/config`（capture 不读配置）
- ❌ `services/capture/*` → `mcp_server/*`（capture 是 MCP 的下层，不反向依赖）
- ❌ `services/capture/*` → `commands/*`（services 不依赖 commands）

## 7. 强制约束

```bash
# capture 不依赖 attach
grep -rn 'attach\|AttachRegistry' src-tauri/src/services/capture/
# 必须为空

# capture 不持有 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src-tauri/src/services/capture/
# 必须为空
```

## 8. 依赖变更流程

1. **新增上游 caller** → 在 §4 加一行 + 检查不违反 §6
2. **新增下游 callee** → 在 §5 加一行 + 检查
3. **新增 CaptureMode variant** → README + INTERFACE + 实现 + 测试 同步