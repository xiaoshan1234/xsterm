# RFC 0001: 保留 xsterm `tmux -CC` 完整实现，对标 iTerm2

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-09-11 |
| 作者 | pdm |
| 影响阶段 | M1–M7 |
| 决策 D-α | 是 |

---

## 1. 背景

`doc/prd/prd.md` §M2 把 tmux 写为"简单 session 映射"（attach 已有 session / 新建 server），但 xsterm 当前已经有一个 3622 行 controller.rs + 762 行 tmux-cc-implementation.md 自研实现，支持：

- tmux `-CC` 控制模式协议完整解析
- 多 pane（N panes per controller）
- SSH 上的 tmux 走 exec channel
- pane 状态完整保留（detach 后 reattach 不丢）

这是一个**远超 PRD 规格的差异化资产**，对标 iTerm2 `tmux -CC` 集成。

如果按 PRD 简单模式回退，会损失 3000+ 行核心代码 + 几个月开发投入。

## 2. 决策

**保留 xsterm 现有 `tmux -CC` 完整实现，不简化。**

规格端做反向升级：把 PRD §M2 的"tmux session 映射"升级为"完整 tmux -CC 控制模式"，目标体验对标 iTerm2：

- 标签页即 tmux server（点击"新建" → 创建 server；点击"打开" → attach 现有）
- 标签页内部分屏即 tmux pane
- detach 标签页 = detach -t server（不杀）
- 关闭标签页 = kill-pane / kill-server（用户配置）
- SSH 上的 tmux：russh exec channel 透传控制协议

## 3. 影响

### 规格改动

- `doc/prd/prd.md` §M2 第 5 条："tmux session 映射" → "tmux -CC 完整控制模式"
- `doc/prd/prd.md` §M3："备用屏幕切换"验收加一条：tmux pane 切换时正确处理 alternate screen
- `doc/prd/acceptance.md` §E 加：iTerm2 对比清单（macOS 笔记本 + tmux -CC）

### 不动的部分

- 现有 `services/tmux/*` 三个 crate（controller / parser / dispatch）
- 现有 `req-006-tmux.md` / `tmux-cc-implementation.md` / `tmux-cc-protocol.md` 三篇文档
- 现有 UI（TabBar / WindowTabBar / PaneSplitter）

### MCP 集成

`doc/prd/mcp.md` §3.2 `create_session` 中：

```diff
- tmux_session?: string
+ tmux_mode?: "simple" | "cc"             // 默认 "cc"
+ tmux_layout?: "even-horizontal" | "even-vertical" | "tiled"
```

MCP attach 到 tmux session 后，agent 看到的"screen" = 整个 server 的合成视图；send_keys 注入到当前 focus pane；capture_screen 输出合成 ANSI 流（带 pane 边框 OSC）。

## 4. 实施要点

- M1 阶段把 tmux 相关的 `models/session.rs` 字段与 PRD/mcp.md 对齐
- M2 阶段 MCP attach tmux session 时，实现合成视图（参考 `doc/arch/tmux-cc-protocol.md` §3.4）
- M6 阶段补 iTerm2 对比 demo（视频 + checklist）

## 5. 风险

| 风险 | 缓解 |
|---|---|
| MCP 合成视图性能差（每个 pane 都渲染）| lazy render + 只渲染 focus pane + viewport cache |
| tmux -CC 协议变更（tmux 3.4+）| 锁定 tmux ≥ 3.2，CI 跑多版本 matrix |
| iTerm2 对比清单变成"无止境" | 限定 v1 对比范围（10 项核心功能），列在 acceptance.md §E |

## 6. 验收

- tmux 多 pane 状态保留率 100%（detach / attach 不丢）
- MCP attach tmux session 响应 < 200ms
- 与 iTerm2 `tmux -CC` 行为一致清单 10/10 通过（清单见 acceptance.md §E）

---

签字：

- [x] pdm — 2026-09-11
- [ ] dev
- [ ] tm
