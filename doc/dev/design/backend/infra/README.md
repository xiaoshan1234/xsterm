# Backend · Infra 层 (= `src-tauri/src/infrastructure/`)

> **职责**：把外部世界（操作系统进程、SSH 协议、tmux 控制模式、二进制帧协议）藏到 trait 后面，让 service 层用统一接口操作。
>
> infra = "I/O + trait 实现"。所有阻塞系统调用、tokio I/O、子进程管理都只允许出现在这一层。

## 1. 模块清单（现状）

```
src-tauri/src/infrastructure/
├── mod.rs                  re-export 5 个子模块
├── pty.rs                  PtySystem trait + PtyPair + portable-pty 实现
├── ssh.rs                  SshBackend trait + russh 实现（host-key 校验禁用，见 §约束）
├── binary_frame.rs         ssh image upload 用二进制帧编解码
├── app_backend.rs          AppBackend trait（抽象 SessionManager 给 service 用）
├── session_backend.rs      SessionBackend trait（pty/ssh 公共抽象）
└── tmux/
    ├── mod.rs
    └── backend.rs          TmuxBackend trait + LocalTmuxBackend + SshTmuxBackend
```

## 2. 关键约束

- **trait 必须能 mock**。`mockall` 是单测基础设施。每个对外暴露的 trait（如 `PtySystem`、`SshBackend`、`TmuxBackend`）至少要有一个 mock 实现放在 `#[cfg(test)]` 或单独的 `tests/` 子目录。
- **不做业务规则**。"如果收到 EOF 就关闭 session"这种逻辑在 service 层；infra 只暴露 `read() -> Result<Vec<u8>, IoError>`。
- **错误用 `thiserror` 派生**，统一在 `crate::error.rs` 或子模块的 `errors.rs`。**禁止**把 anyhow / Box<dyn Error> 抛给 service。
- **不依赖 service / commands / models 的具体类型**。可以读 `models::SessionConfig` 这种纯数据，但**不**调用 service 的方法。

## 3. 重要警告

- **`ssh.rs` 禁用了 host-key 校验**（AGENTS.md 已记录）。这是已知安全债，**禁止**在本层之外的位置重新打开或绕过。
- **`binary_frame.rs` 只服务于 SSH 图片上传**一个用例。如果以后出现非 SSH 场景的二进制 I/O，再讨论是否提到更通用的位置。

## 4. 依赖方向

```
infrastructure/  ──►  models/  (纯数据类型作为 trait 关联类型)
       │
       └─►  外部 crate: portable-pty, russh, tokio::process, etc.
```

infra 层**禁止**依赖 service 或 commands。

## 5. 改进方向

- **`app_backend.rs` 和 `session_backend.rs` 的职责区分**：现状这两个 trait 的边界有点模糊。建议 `AppBackend` 只保留「SessionManager 给上层用的轻量快照接口」，`SessionBackend` 是 pty/ssh 的 process 抽象，命名也调整。
- **tmux backend.rs 体积**：目前 `backend.rs` 单文件承担 trait + Local + Ssh 三件事。下一个拆分里程碑是 `infrastructure/tmux/{backend/mod.rs, local.rs, ssh.rs}`，跟 service 层 `tmux_session/` 的子模块布局对齐。
- **`mockall` 自动 mock vs 手写 fixture**：service 层的 `tmux_session/controller/tests.rs` 走手写 `RecordingBackend`（更可控），infra 层的 mock 走 `#[automock]`。两种风格保持，不要混。
- **错误聚合点**：现在 `error.rs` 在 `src-tauri/src/` 顶层，是 `AppError` 的预留位置；infra 层目前各自 `thiserror` 派生。下一阶段是把 infra 的所有 error 都 `From` 到 `AppError`，commands 层只用 `AppError`。
