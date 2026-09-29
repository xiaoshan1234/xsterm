# RFC 0003: 配置迁移到 TOML + 30 天回退窗口

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-09-11 |
| 作者 | pdm |
| 影响阶段 | M3 |
| 决策 D-γ | 是 |

---

## 1. 背景

xsterm 当前用 `@tauri-apps/plugin-store` 存配置（JSON 格式），位置在 `%APPDATA%\xsterm\store.json`。

`doc/ai-terminal-migration/02-target-architecture.md` §3 推荐迁移到 toml（Rust 端 serde + toml），原因：
- Rust 端配置读写统一（前端 store + 后端直接读 toml 各自解析）
- 支持复杂结构（嵌套 profile / ssh config / mcp settings）
- 注释友好（vs JSON）

## 2. 决策

**MVP 阶段：**

1. 引入 toml 作为 Rust 端权威配置源（`%APPDATA%\xsterm\config.toml`）
2. 前端配置 UI 仍可读 / 写（通过 Tauri command 桥接，不直接读 toml）
3. 首次启动时一次性把 `store.json` 迁移到 `config.toml`
4. 旧 `store.json` 保留 30 天，重命名 `store.json.bak` 防止误删
5. 30 天后下次启动自动删除 `.bak`

## 3. 文件位置

```
%APPDATA%\xsterm\
├── config.toml              # NEW: 权威配置
├── store.json.bak           # 旧 store 备份（30 天后删）
├── sessions/                # 会话状态（已有）
├── ssh/                     # SSH known_hosts（已有）
└── cache/                   # 主题/字体缓存（已有）
```

## 4. TOML schema 草案

```toml
# xsterm 主配置
version = 2

[terminal]
shell = "pwsh"
font_family = "Cascadia Code"
font_size = 14
copy_on_select = true
bracketed_paste_default = true

[appearance]
theme = "xsterm-dark"

[[profile]]
name = "default"
type = "local"
shell = "pwsh"
cwd = "~"

[[profile]]
name = "prod-server"
type = "ssh"
host = "prod.example.com"
user = "deploy"
auth = { method = "private_key", private_key_path = "~/.ssh/id_ed25519" }

[mcp]
enabled = true
stdio = true

[mcp.http]
enabled = false
port = 19847

[mcp.destructive_keys]
policy = "deny"

[mcp.idle_timeout]
seconds = 3600
```

## 5. 迁移脚本

`src-tauri/src/config/migrate.rs`：

```rust
pub fn migrate_v1_to_v2() -> Result<(), MigrationError> {
    let v1_path = store_path();           // store.json
    let v2_path = config_path();          // config.toml

    if !v1_path.exists() {
        return Ok(()); // 全新安装
    }

    let v1: serde_json::Value = serde_json::from_str(&fs::read_to_string(&v1_path)?)?;
    let v2 = convert_v1_to_v2(v1);        // 字段映射 + 类型转换

    // 原子写：写到临时文件 → rename
    let tmp = v2_path.with_extension("toml.tmp");
    fs::write(&tmp, toml::to_string_pretty(&v2)?)?;
    fs::rename(&tmp, &v2_path)?;

    // 备份 + 30 天后删除
    let backup = v1_path.with_extension("json.bak");
    fs::rename(&v1_path, &backup)?;

    schedule_delete(backup, Duration::days(30));

    Ok(())
}
```

## 6. 前端桥接

不再用 `@tauri-apps/plugin-store`，统一走 Rust 端：

```rust
#[tauri::command]
async fn get_config() -> Result<Config, ConfigError> { ... }

#[tauri::command]
async fn set_config(patch: ConfigPatch) -> Result<Config, ConfigError> { ... }
```

写操作走白名单（与 mcp.md §3.12 set_config 一致），防止前端意外修改敏感字段。

## 7. 影响

- `doc/ai-terminal-migration/02-target-architecture.md` §3 D-γ 改写
- `doc/prd/prd.md` §M9 加：TOML 格式 + 30 天回退
- `doc/prd/compliance.md` §4.4 加：toml schema 校验
- 新增：`crates/config/` 替代 plugin-store

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户手动改 toml 写错导致启动失败 | schema 校验 + 启动失败时回退到 default + UI 提示 |
| 字段映射遗漏导致用户配置丢失 | 迁移前后 diff 报告，写到 `migration.log` |
| 并发迁移（首次启动多窗口） | 文件锁（fs2 crate），第二次启动检测已迁移则跳过 |
| 30 天回退窗口后用户想回滚 | 文档说明回滚方法（手动从 .bak 恢复）|

## 9. 验收

- 现有用户升级 0 数据丢失（acceptance.md §M3 验证）
- 全新安装首启动 < 100ms（无迁移）
- toml schema 校验覆盖率 100%
- 30 天后 .bak 自动删除（CI 模拟时钟测试）

---

签字：

- [x] pdm — 2026-09-11
- [ ] dev
- [ ] tm
