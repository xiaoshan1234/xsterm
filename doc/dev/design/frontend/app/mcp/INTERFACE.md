# Module · App MCP — 对外接口 (frontend listener only)

> **位置**: `src/app/modules/mcp/`
> **状态**: ⭐ NEW (RFC 0002-revised-2, 退化自 RFC 0002-revised frontend server 方案)
> **配合**: [`../../../backend/services/mcp/INTERFACE.md`](../../../backend/services/mcp/INTERFACE.md) (backend MCP server 是事件源)

## 1. 公开 API

### 1.1 hook: `useMcpListener()`

```typescript
import { useMcpListener } from "@/app/modules/mcp/api";

export interface McpListenerApi {
  // --- state (响应式, 触发 re-render) ---
  useServerStatus(): McpServerStatus;
  useToolCalls(): McpToolCall[];  // 时间倒序, max 100 entries
  useAttachBanners(): AttachBanner[];  // 当前 attach 列表
  useIsAttachByMcp(sessionId: number): boolean;  // 该 session 是否被 MCP agent attach

  // --- command (命令式, 不发 re-render) ---
  startHttpServer(): Promise<void>;  // → invoke('mcp_http_start')
  stopHttpServer(): Promise<void>;   // → invoke('mcp_http_stop')
  startStdioServer(): Promise<void>; // → invoke('mcp_stdio_start')
  stopStdioServer(): Promise<void>;  // → invoke('mcp_stdio_stop')
  regenerateToken(): Promise<string>; // → invoke('regenerate_mcp_token')

  // --- event subscription (命令式) ---
  onToolCall(cb: (event: McpToolCalledEvent) => void): () => void;  // 返回 cleanup
  onAttachChange(cb: (event: McpAttachChangedEvent) => void): () => void;

  // --- 一次性操作 ---
  init(): Promise<void>;  // 启动 listener (调 listen 4 类事件 + 注册 store update)
  dispose(): void;       // 清理所有 listener
}

export function useMcpListener(): McpListenerApi;
```

### 1.2 类型定义

```typescript
// 与 backend services/mcp/types.rs 镜像
export interface McpServerStatus {
  httpRunning: boolean;
  stdioRunning: boolean;
  activeStdioClients: number;
  port: number;
  timestamp: number;
}

export interface McpToolCalledEvent {
  tool: string;                    // tool name (e.g. "send_keys", "capture_screen")
  params: Record<string, any>;
  clientId: string;
  requestId: string;
  timestamp: number;
}

export interface McpToolReturnedEvent {
  tool: string;
  result?: any;
  error?: {
    code: number;                  // -32001 ~ -32006 (MCP standard)
    message: string;
    data?: any;
  };
  latencyMs: number;
  requestId: string;
  timestamp: number;
}

export interface McpAttachChangedEvent {
  sessionId: number;
  clientId: string;
  action: 'attach' | 'detach' | 'force_detach';
}

export interface McpToolCall {
  // 内部合并 McpToolCalledEvent + McpToolReturnedEvent
  tool: string;
  params: Record<string, any>;
  clientId: string;
  requestId: string;
  calledAt: number;
  returnedAt?: number;
  result?: any;
  error?: McpError;
  latencyMs?: number;
}

export interface AttachBanner {
  sessionId: number;
  clientId: string;        // "mcp-<uuid>" | "ui-takeover" | "tunnel-<host>"
  attachedAt: number;
  source: 'mcp' | 'ui' | 'tunnel';
}
```

### 1.3 zustand store

```typescript
// store.ts
interface McpStoreState {
  serverStatus: McpServerStatus | null;
  toolCalls: McpToolCall[];          // max 100, FIFO 滚动
  attachBanners: Map<number, AttachBanner>;  // sessionId → banner
  isInitialized: boolean;

  // actions
  setServerStatus: (status: McpServerStatus) => void;
  addToolCall: (event: McpToolCalledEvent) => void;
  completeToolCall: (event: McpToolReturnedEvent) => void;
  setAttachBanner: (sessionId: number, banner: AttachBanner | null) => void;
}
```

### 1.4 listener 启动序列

```typescript
// listener.ts
export async function startListening(ctx: McpContext): Promise<() => void> {
  const cleanup1 = await listen<McpAttachChangedEvent>("mcp-attach-changed", (e) => {
    ctx.store.setAttachBanner(e.payload.sessionId, {
      sessionId: e.payload.sessionId,
      clientId: e.payload.clientId,
      attachedAt: Date.now(),
      source: 'client_ui',  // or 'mcp' / 'tunnel' depending on clientId prefix
    });
    if (e.payload.action === 'detach' || e.payload.action === 'force_detach') {
      ctx.store.setAttachBanner(e.payload.sessionId, null);
    }
  });

  const cleanup2 = await listen<McpToolCalledEvent>("mcp-tool-called", (e) => {
    ctx.store.addToolCall(e.payload);
  });

  const cleanup3 = await listen<McpToolReturnedEvent>("mcp-tool-returned", (e) => {
    ctx.store.completeToolCall(e.payload);
  });

  const cleanup4 = await listen<McpServerStatus>("mcp-server-status", (e) => {
    ctx.store.setServerStatus(e.payload);
  });

  return () => { cleanup1(); cleanup2(); cleanup3(); cleanup4(); };
}
```

## 2. UI 组件契约

### 2.1 `<McpStatusPanel />`

```typescript
import { McpStatusPanel } from "@/app/modules/mcp/ui/McpStatusPanel";

<McpStatusPanel
  showToolLog={true}         // 显示 tool 调用日志 (default true)
  maxLogEntries={50}          // max tool log entries (default 50)
  autoScroll={true}           // 自动滚动到最新 (default true)
  onClearLog={() => void}     // 清除日志回调
/>
```

**Props 不接受 data, 内部全用 `useMcpListener()` hook**

渲染内容:
- 顶部: server status (offline / HTTP @ port / stdio active / HTTP + stdio)
- 中部: 当前 attach 列表 (banner 列表)
- 底部: tool 调用日志 (时间 / tool / clientId / latencyMs / status icon)

### 2.2 `<McpAttachBanner />`

```typescript
import { McpAttachBanner } from "@/app/modules/mcp/ui/McpAttachBanner";

<McpAttachBanner sessionId={sessionId} />
```

**Props: sessionId (number); 内部用 `useMcpListener().useIsAttachByMcp(sessionId)`**

渲染:
- attached: 顶部 banner "🤖 AI Agent 接管中 (mcp-client-uuid)"
- not attached: 返回 null (不渲染)

## 3. 不允许

- ❌ frontend `app/mcp` 发起任何 MCP tool 调用 (那是 AI agent 通过 HTTP/stdio 调的)
- ❌ frontend `app/mcp` 直读 `session_manager` / `attach_registry` 状态
- ❌ frontend `app/mcp` 直连 backend `services/mcp` (只能通过 Tauri events)
- ❌ frontend `app/mcp` 持有任何 backend 状态真源 (zustand store 只是 UI 镜像)
- ❌ frontend `app/mcp` 注册任何 MCP 工具 (backend `services/mcp/tools/` 12 个工具是 backend 实现)
- ❌ frontend `app/mcp` 启动 HTTP server / spawn stdio sidecar (backend `services/mcp` 启动)

## 4. 依赖方向

```
ui/mcp/McpStatusPanel.tsx     ─┐
ui/mcp/McpAttachBanner.tsx     ├─►  app/mcp/api.ts  ─►  app/mcp/listener.ts  ─►  infra/tauri/events (listen)
                              │                       ─►  app/mcp/store.ts
                              └─►  useMcpListener() hook
```

详见 [`DOWNSTREAM.md`](DOWNSTREAM.md).