# Service · Theme — 对外接口

> **位置**：`src/service/theme/api.ts`
> **唯一进口**：`import { useThemeService, type ThemeService } from "@/service/theme/api"`

## 1. 接口

```typescript
import type { TerminalTheme } from "@/model/terminal/types";

export type UiTheme = "dark" | "light" | "auto";

export interface ThemeService {
  // ============ 读 ============
  getUiTheme(): UiTheme;
  getXtermThemeId(): string;
  getEffectiveUiTheme(): "dark" | "light";   // 解析 auto 后

  // ============ 响应式订阅 ============
  useUiTheme(): UiTheme;
  useXtermThemeId(): string;
  useEffectiveUiTheme(): "dark" | "light";

  // ============ 写 ============
  setUiTheme(theme: UiTheme): void;
  setXtermTheme(id: string): void;

  /**
   * 应用 theme（具体应用交给 UI 自己——service 只改 store + emit 事件）
   */
  apply(theme: "dark" | "light"): void;
}

export function useThemeService(): ThemeService;
```

## 2. 关键设计

**UiTheme vs EffectiveUiTheme**：

- `UiTheme` — 用户选择（可能是 "auto"）
- `EffectiveUiTheme` — 解析后的实际值（"dark" 或 "light"）

`auto` 模式下：监听 OS theme 变化 → 自动切到 dark / light。

**`apply` 不是"渲染"**：

- service 只改 store + emit 事件
- UI 通过 useEffect 监听 effectiveUiTheme 变化 → 更新 CSS variables

## 3. 不对外暴露

- `palettes.ts` 的 5 个 ANSI 调色板定义
- OS theme 监听句柄

## 4. 接缝契约

```
// ui/shell/view/App.tsx
import { useThemeService } from "@/service/theme/api";

function App() {
  const theme = useThemeService();
  const effective = theme.useEffectiveUiTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);
}
```

```
// app/settings/usecases/apply/theme.ts
import { useThemeService } from "@/service/theme/api";

const themeSvc = useThemeService();
themeSvc.setUiTheme(loadedSettings.theme);
themeSvc.setXtermTheme(loadedSettings.terminalThemeId);
```

## 5. api.ts 变更流程

1. **新增 field** → 加 types + api.ts
2. **修改 field 类型** → 同步更新 §1
