# PRD 偏离清单 · P0-5: Config 路径

> **位置**：`doc/dev/design/backend/README.md` §6 引用
> **状态**：🟡 **待 tm 跟 pdm 对齐 PRD**（P0-5 audit 标记）
> **创建日期**：2026-09 audit P0

## 1. 问题陈述

PRD §2 M9 + §4 描述:
- 配置文件路径: `%APPDATA%\xsterm\config.toml`
- 文件监听 + 自动 reload（watch notify）
- JSON schema for VS Code 智能提示

frontend 设计目录（[v3/v4 简化后]）改成:
- frontend 直存 `settings.json` 到 `tauri-plugin-store`（frontend `service/persistence` 直存）
- 没有 backend 文件监听
- 没有 schema 校验

这是**架构与 PRD 偏离**，dev 不能自行决定，需要 tm 拍板。

## 2. 当前 audit 决策

🟡 **推迟**——audit 不动 M9 设计，由 tm 跟 pdm 对齐。

理由:
- P0-5 是产品决策（用 .toml vs .json / 是否有 watcher / 是否有 schema）—— dev 没资格决
- 其他 4 项 P0 已修核心矛盾（v4/v6 路径冲突 + MCP/AI-takeover/reverse-tunnel 缺失），可独立 ship
- 等 tm 拍板后再补 backend infra layer 的 config watcher 模块

## 3. tm/pdm 对齐时的 4 个备选

详见 [audit 报告 P0-5 §3](#3-决策项)。

### 3.1 跟随 PRD
- backend 新增 `infra/config_watcher/` 子模块
- frontend 监听 `config-reloaded` 事件
- backend 用 `notify` crate 监听 config.toml + 自动 reload

### 3.2 跟随设计
- 改 PRD M9 描述为 frontend 直存 settings.json
- frontend 直存路径不变
- **代价**：失去"用户手动编辑 config 文件"的高级用户路径；失去 VS Code schema 提示

### 3.3 混合
- settings.json（UI 频繁改） + backend config.toml（高级用户手编）
- 两层共存，互相 broadcast 变更
- **代价**：复杂度高，两个 source of truth 可能不一致

### 3.4 推迟
- 本轮 audit 不修
- 等 tm 跟 pdm 对齐后再决定
- **现状采用**

## 4. 影响范围

无论选哪条:
- `service/persistence/RESPONSIBILITY.md` 的 "frontend-only 持久化" 段落可能要改
- backend `commands/shell` 是否要加 `load_config` / `watch_config` IPC 命令
- 用户的 "config.toml 改动自动 reload" 体验是否保留
- VS Code JSON schema 是否仍然提供

## 5. 状态跟踪

- 🟡 待 tm/pdm 对齐
- ⏳ 对齐后由 dev 实施 backend config_watcher 子模块（如果选 1 或 3）
- ⏳ 对齐后由 tm 更新 PRD §2 M9 / §4 描述（如果选 2）

## 6. 文档地图

- PRD: §2 M9 / §4 数据
- frontend 设计: `service/persistence/RESPONSIBILITY.md` §1 + §7
- backend 设计: (待创建) `infra/config_watcher/` 子模块
- audit 报告: 本 doc
