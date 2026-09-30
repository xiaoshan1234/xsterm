# Services · Persistence · Migration — 对下依赖

> **位置**：`src-tauri/src/services/persistence/migration.rs`

## 1. 依赖图

```
Persistence  (services/migration)
├───► （无）
├───► models/* (serde 派生类型)
└───► infrastructure/* (经过 services 抽象)
```

## 2. 外部 crate 依赖

| crate | 用途 |
|---|---|
| `tauri` | `#[tauri::command]` 宏 + `AppHandle` + `State` + `Emitter` |
| `serde` / `serde_json` | 入参 / 返回序列化 |
| `tokio` | async runtime |

## 3. 内部模块依赖

| 模块 | 来源 | 用途 |
|---|---|---|
| `services/<module>` | `src-tauri/src/services/` | 业务编排（每个命令调一个 service fn） |
| `models/<domain>` | `src-tauri/src/models/` | serde 派生类型（入参 / 返回） |
| `infrastructure/<module>` | `src-tauri/src/infrastructure/` | 仅通过 services 间接访问（不直跳） |

## 4. 上游 caller

| caller | 调什么 | 何时 |
|---|---|---|
| frontend `app/<module>/usecases/` | `invoke('<command>', args)` | UI 用户操作 |
| frontend `service/<domain>/repository.ts` | `invoke('<command>', args)` | reactive state 变更 |
| frontend `app/mcp/tools/<tool>.ts`（RFC 0002-revised） | `invoke('<command>', args)` | MCP agent 操作 |
| frontend `app/session/usecases/ai_takeover/` | `invoke('attach_session', ...)` | UI "🤖 AI 接管" 按钮 |

## 5. 下游被调

（无直接调用——所有 IO 走 services 抽象）

## 6. emit 事件

（不 emit 事件——纯 IPC 入口）

## 7. 强约束（pre-commit 必跑）

```bash
# 命令不能 spawn 长跑任务
grep -rn 'tokio::spawn' src-tauri/src/commands/migration.rs
# 必须为空

# 命令不能持有 Arc<Mutex<...>> 状态
grep -rnE 'Arc<Mutex|Arc<RwLock' src-tauri/src/commands/migration.rs | grep -v tests
# 必须为空

# 命令不能跨 IPC 调用其他命令
grep -rn 'invoke' src-tauri/src/commands/migration.rs | grep -v tests
# 必须为空
```

## 8. 不允许的依赖

- ❌ `commands/migration` → `services/` 内部 helper（必须走 services 公开 API）
- ❌ `commands/migration` → `infrastructure/pty/ssh/tmux`（穿过 services 抽象）
- ❌ `commands/migration` → `models/` 内部 helper（仅类型）
- ❌ `commands/migration` → `frontend/*`（无反向依赖）

## 9. 变更流程

1. **新增上游 caller** → §4 加一行 + 检查 §8
2. **新增下游 callee** → §5 加一行 + 检查 §8
3. **修改命令签名** → 同步 frontend `infra/tauri/commands/<module>` + INTERFACE.md §2
4. **新增 emit 事件** → §6 加一行 + frontend `infra/tauri/events/` 同步

## 10. 测试

```rust
#[tokio::test]
async fn <command>_happy_path() {
    let state = mock_state();
    let result = <command>(args, state).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn <command>_error_path() {
    let state = mock_invalid_state();
    let result = <command>(args, state).await;
    assert!(matches!(result, Err(msg) if msg.contains("expected")));
}
```
