# Service · Settings — 对下依赖接口

> **位置**：`src/service/settings/`

## 1. 依赖图

```
service/settings/
├── api.ts        ────►  @/model/settings/types      (Settings 类型)
├── api.ts        ────►  @/service/persistence/api   (持久化)
├── api.ts        ────►  @/service/theme/api         (theme 应用)
├── api.ts        ────►  @/service/logger/api        (log level 应用)
├── api.ts        ────►  @/service/terminal/api      (terminal 偏好应用)
├── store.ts      ────►  @/model/settings/types
├── sync.ts       ────►  @/service/persistence/api   (debounced 写盘)
├── sync.ts       ────►  ./store.ts                  (写 store)
└── defaults.ts   ────►  @/model/settings/types
```

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

```
// app/settings/usecases/apply/theme.ts
import { useSettingsService } from "@/service/settings/api";
import { useThemeService } from "@/service/theme/api";

const settings = useSettingsService();
const theme = useThemeService();

// app 编排：settings 改 → 调 theme
const current = settings.get("theme");
theme.setUiTheme(current);
```

**错误模式**（settings 反向调 theme）：

```typescript
// service/settings/sync.ts
import { themeSvc } from "@/service/theme/api";  // ❌ 反向依赖

function syncTheme(patch: Partial<Settings>) {
  if (patch.theme) {
    themeSvc.apply(patch.theme);  // ❌ settings 不应该知道 theme service
  }
}
```

## 5. 不允许的依赖

- ❌ `service/settings/` → `app/`、`ui/`、`@tauri-apps/api` 直接
- ❌ `service/settings/` → 其他 service 的 `api.ts`（theme/logger/terminal 等）
- ❌ `service/settings/` → `infra/store` 直接（必须经过 service/persistence）

## 6. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"@tauri-apps' src/service/settings/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(app\|ui\)' src/service/settings/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(theme\|logger\|terminal\|output\|session\|workspace\)/api' src/service/settings/ --include='*.ts'
# 必须为空（只能 import persistence）
```
