# Service · Terminal — 对下依赖接口

> **位置**：`src/service/terminal/`

## 1. 依赖图

```
service/terminal/
├── api.ts        ────►  @/model/terminal/types        (TerminalTheme / TerminalPreferences)
├── registry.ts   ────►  (无——纯 JS Map)
└── preferences.ts ────►  @xterm/xterm                  (xterm npm 包, 不是 frontend 依赖)
```

**terminal service 不依赖 infra、app、ui、model（除 types）**——它只依赖 xterm.js。

## 2. @xterm/xterm

```typescript
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const instance: Terminal = new Terminal({ ... });
const fit = new FitAddon();
instance.loadAddon(fit);
```

**关键**：xterm 是 npm 包，**不是** frontend 内部依赖。这是 terminal service 的"特权"——只有它能直接持有 xterm 实例。

## 3. model/terminal

| 调用 | 来源 |
|---|---|
| `TerminalTheme` 类型 | `model/terminal/types` |
| `TerminalPreferences` 类型 | `model/terminal/types` |

## 4. 不允许的依赖

- ❌ `service/terminal/` → `infra/`、`app/`、`ui/`、其他 `service/`
- ❌ `service/terminal/` → `model/terminal/rules` 或 `model/terminal/accessor`（不需要——terminal service 不做派生）

## 5. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"\.\./\(app\|ui\|infra\|model/session\|model/workspace\)' src/service/terminal/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(session\|workspace\|output\|theme\|logger\|persistence\|settings\)/api' src/service/terminal/ --include='*.ts'
# 必须为空
```

## 6. 设计意图：terminal service 是"xterm 实例的家"

xterm 实例是非序列化对象（不能进 zustand），又需要跨多个组件访问（terminal + resize handle + theme 应用），所以需要一个注册表——terminal service 就是这个注册表。

**为什么不让 ui/terminal 自己管**：

- ui/terminal 只能 React 树内访问
- settings 改 font size 时需要在所有 xterm 实例上应用——settings 在 ui/settings，跨组件访问需要 service
