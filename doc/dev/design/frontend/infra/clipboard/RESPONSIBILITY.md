# Infra · Clipboard — 职责

> **位置**：`src/infra/clipboard/`
> **类型**：OS 资源封装（tauri-plugin-clipboard-manager 包装）
> **被使用方**：`ui/dialogs`（特例——ui 可以直接调用）

## 1. 这个子模块负责什么

infra/clipboard 把 `tauri-plugin-clipboard-manager` 包成 frontend-friendly API——文本 / 图片 / HTML 的读写。

承担 3 类职责：

1. **读剪贴板**——`readText()` / `readImage()` / `readHtml()`
2. **写剪贴板**——`writeText()` / `writeImage()` / `writeHtml()`
3. **权限处理**——Tauri clipboard permission 处理

## 2. 这个子模块 **不**负责什么

- **不持有状态**——剪贴板是 OS 资源，不在 frontend 持有
- **不渲染 UI**——纯 IO 层
- **不调业务逻辑**——业务在 app
- **不直接被大多数 ui 模块调用**——主要 ui/dialogs 用

## 3. 子结构

```
infra/clipboard/
├── read.ts               readText() / readImage() / readHtml()
├── write.ts              writeText() / writeImage() / writeHtml()
└── *.test.ts
```

**简洁**：剪贴板 IO 只 2 个文件，不需要更复杂的结构。

## 4. 用户故事（基础设施视角）

- **作为用户**，我希望粘贴长路径时不丢失 → `readText()` 返回完整字符串
- **作为用户**，我希望复制 session 配置粘贴到对话框 → `writeText(config.name)` 写入
- **作为用户**，我希望复制错误日志粘贴到 issue → `writeText(error.stack)` 写入

## 5. 跟其他 infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/tauri` | 各自独立——clipboard 用 plugin-clipboard-manager，tauri 用 core/event API |
| `infra/store` | 各自独立 |
| `infra/logger` | 各自独立 |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 infra/clipboard |
|---|---|
| `ui/dialogs` | 直接调用（特例） |
| `ui/terminal` | 可选——粘贴确认 dialog |
| `app/*` | **通常不调**——剪贴板是 UI 操作 |
| `service/*` | **不调**——剪贴板不是状态 |

**关键**：clipboard 是"特例"——ui 可以直接调用，不需要经过 service。

## 7. tauri-plugin-clipboard-manager 的选择

xsterm 用 Tauri 后端，剪贴板 API 来自 `tauri-plugin-clipboard-manager`：

```typescript
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
```

**为什么不用 `navigator.clipboard`**：

- `navigator.clipboard` 是浏览器 API，**不能**读取 OS 剪贴板历史（只读当前焦点 tab 复制的内容）
- `tauri-plugin-clipboard-manager` 通过 Rust 调用 OS API，能读全部剪贴板

## 8. 图片 / HTML 扩展

```typescript
// infra/clipboard/read.ts
export async function readImage(): Promise<Uint8Array | null> {
  // 读取剪贴板图片（如截图）
  // 还没实现——保留 API 占位
}

export async function readHtml(): Promise<string | null> {
  // 读取剪贴板 HTML 格式
  // 还没实现——保留 API 占位
}
```

**当前实现**：只 readText / writeText。Image 和 HTML 是未来扩展。

## 9. 子模块的"产品语言"术语

- **clipboard** — OS 剪贴板（文本 / 图片 / HTML 三种格式）
- **read** — 从剪贴板读取（剪贴板 → frontend）
- **write** — 写入剪贴板（frontend → 剪贴板）
- **permission** — Tauri capability 权限（`clipboard-manager:allow-read-text` 等）
