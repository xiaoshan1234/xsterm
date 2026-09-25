# Service · Settings — 对下依赖接口

> **位置**：`src/service/settings/`

## 1. 依赖图

```
service/settings/
├── api.ts        ────►  @/model/settings/types         (Settings 类型)
├── api.ts        ────►  @/service/persistence/api      (持久化)
├── api.ts        ────►  @/infra/logger                 (log level 应用，logger 在 v4 归 infra)
├── store.ts      ────►  @/model/settings/types
├── sync.ts       ────►  @/service/persistence/api      (debounced 写盘)
├── sync.ts       ────►  ./store.ts                     (写 store)
└── defaults.ts   ────►  @/model/settings/types
```

**关键**：v4 已删除 `service/theme` / `service/terminal` / `service/output` / `service/logger` 四个 domain（见 service/README §2 删表）。

- **theme 应用**：通过 `service/settings.theme` 字段 + ui 订阅响应——settings 单向 broadcast
- **log level 应用**：通过 `infra/logger.setLevel()`（logger 是横切原语，归 infra）
- **terminal 偏好应用**：通过 `service/settings.terminalPreferences` 字段——同上 broadcast 模式

## 2. model

| 调用 | 来源 |
|---|---|
| `Settings` 类型（5 个分类） | `model/settings/types` |
| `SettingsCategory` 枚举 | `model/settings/types` |
| `LogLevel` 枚举 | `model/settings/types` |

## 3. service/persistence（**横向依赖**）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `persistence.get<Settings>("settings")` | `service/persistence/api` | api.ts load() |
| `persistence.set("settings", currentValue)` | `service/persistence/api` | sync.ts debounced 写盘 |
| `persistence.delete("settings")` | `service/persistence/api` | api.ts reset() |

## 4. 其他 service（**订阅而非调用**）

settings **不调**其他 service 的 api——其他 service **自己订阅** settings 变化。

**正确模式**：

```typescript
// app/settings/usecases/apply/terminalPrefs.ts
import { useSettingsService } from "@/service/settings/api";
import { useTerminalApi } from "@/app/modules/terminal/api";

const settings = useSettingsService();
const terminal = useTerminalApi();

// app 编排：settings 改 → 调 terminal apply
settings.subscribe("terminalPreferences", (prefs) => {
  terminal.applyTerminalPreferences(prefs);
});
```

**错误模式**（settings 反向调其他 service）：

```typescript
// service/settings/sync.ts
import { sessionSvc } from "@/service/session/api";    // ❌ 跨 service 调用 session（业务 domain）
import { workspaceSvc } from "@/service/workspace/api"; // ❌ 跨 service 调用 workspace（业务 domain）

// ❌ settings 不应该反向调用其他业务 service——跨 service 协调由 app 编排
```

## 5. 不允许的依赖

- ❌ `service/settings/` → `app/`、`ui/`、`@tauri-apps/api` 直接
- ❌ `service/settings/` → 其他 service 的 `api.ts`（除 `service/persistence`——同层横向依赖）
- ❌ `service/settings/` → `infra/store` 直接（必须经过 `service/persistence`）
- ✅ `service/settings/` → `infra/logger` 允许（logger 是横切原语，settings 写 log level 是合法用例）

## 6. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"@tauri-apps' src/service/settings/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\/\(app\|ui\)' src/service/settings/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\/\(output\|session\|workspace\|terminal\)/api' src/service/settings/ --include='*.ts'
# 必须为空（output/terminal service 已删除；session/workspace 是同级业务 domain，跨 service 协调由 app 编排）
```