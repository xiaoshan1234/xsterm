# Module · Session — 对外接口

> **位置**：`src/ui/modules/session/api.ts`
> **唯一进口**：其他 module 通过 `import { ... } from "@/ui/modules/session/api"`

## 1. 对外暴露什么

1. **Dialog 组件** — `<CreateSessionDialog>` `<EditSessionDialog>` `<SelectSavedDialog>`
2. **展示组件** — `<SessionListItem>` `<SessionStatusBadge>`（侧栏嵌入用）
3. **业务 Hook** — `useSessionApi()` 完整 CRUD
4. **类型** — `Session` `SessionConfig` `PersistedSessionConfig` `SessionDisplayConfig` `SessionStatus`

## 2. 顶层组件

### `<CreateSessionDialog>`

```typescript
interface CreateSessionDialogProps {
  /** 当前工作区 id（创建后装到这个 workspace） */
  workspaceId: string;
  /** 默认选中的类型 */
  defaultType?: "local" | "ssh" | "tmux";
  /** 提交完成回调（成功创建的 sessionId） */
  onCreated: (sessionId: number, configId: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

function CreateSessionDialog(props: CreateSessionDialogProps): JSX.Element;
```

### `<EditSessionDialog>`

```typescript
interface EditSessionDialogProps {
  sessionId: number;
  onSaved: () => void;
  onCancel: () => void;
}
```

### `<SelectSavedDialog>`

```typescript
interface SelectSavedDialogProps {
  filterType?: "local" | "ssh" | "tmux";
  onSelected: (configId: string) => void;
  onCancel: () => void;
}
```

### `<SessionListItem>` / `<SessionStatusBadge>`

```typescript
interface SessionListItemProps {
  sessionId: number;
  configId: string;
  name: string;
  status: SessionStatus;
  isActive: boolean;
  groupId?: string;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

interface SessionStatusBadgeProps {
  status: SessionStatus;
  size?: "small" | "medium";
}
```

## 3. 公开 Hook

### `useSessionApi()`

跨 module 访问 session 业务能力。

```typescript
interface SessionApi {
  // CRUD
  createLocal: (config: LocalSessionConfig, workspaceId: string) => Promise<{ sessionId: number; configId: string }>;
  createSsh: (config: SshSessionConfig, workspaceId: string) => Promise<{ sessionId: number; configId: string }>;
  createTmux: (config: TmuxCcConfig, workspaceId: string) => Promise<{ sessionId: number; configId: string }>;
  editSession: (sessionId: number, patch: Partial<SessionConfig>) => Promise<void>;
  closeSession: (sessionId: number) => Promise<void>;
  reconnectSession: (sessionId: number) => Promise<void>;

  // Saved config CRUD
  saveConfig: (config: PersistedSessionConfig) => Promise<string>;   // 返回 configId
  deleteSavedConfig: (configId: string) => Promise<void>;
  renameSavedConfig: (configId: string, name: string) => Promise<void>;
  listSavedConfigs: () => ReadonlyArray<PersistedSessionConfig>;

  // Display config
  updateDisplayConfig: (sessionId: number, patch: Partial<SessionDisplayConfig>) => void;

  // Open from saved
  openSavedConfig: (configId: string, workspaceId: string, paneId?: string) => Promise<number>;  // 返回 sessionId

  // 订阅
  sessions: ReadonlyArray<Session>;
  getSession: (id: number) => Session | undefined;
}

function useSessionApi(): SessionApi;
```

### `useSession(sessionId)`

```typescript
interface UseSessionReturn {
  session: Session | undefined;
  isActive: boolean;
}

function useSession(sessionId: number): UseSessionReturn;
```

## 4. 类型

```typescript
type SessionKind = "local" | "ssh" | "tmux";
type SessionStatus = "connecting" | "running" | "closed" | "error";

interface Session {
  id: number;
  kind: SessionKind;
  name: string;
  configId: string;
  workspaceId: string;
  windowId?: string;
  paneId?: string;
  status: SessionStatus;
  startedAt: number;
  displayConfig?: SessionDisplayConfig;
}

interface SessionConfig {
  kind: SessionKind;
  name: string;
  // ... 类型特定字段
}

interface LocalSessionConfig extends SessionConfig {
  kind: "local";
  shell: string;
  cwd: string;
  env: Record<string, string>;
}

interface SshSessionConfig extends SessionConfig {
  kind: "ssh";
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "privateKey";
  privateKeyPath?: string;
}

interface TmuxCcConfig extends SessionConfig {
  kind: "tmux";
  sessionName: string;
  socketPath?: string;
}

interface PersistedSessionConfig {
  id: string;
  name: string;
  version: number;
  type: SessionKind;
  config: SessionConfig;
  displayConfig?: SessionDisplayConfig;
}

interface SessionDisplayConfig {
  fontSize: number;
  fontFamily: string;
  cols: number;
  rows: number;
  theme?: string;   // xterm theme id
}
```

## 5. 不对外暴露

- `view/` 内部组件（`<SessionFormLayout>` `<ShellSettingsPanel>` 等）——只在 dialog 内部用
- `store.ts` 的 setter——只能通过 `useSessionApi()` 暴露
- form 内部校验逻辑——只在 `formParsers.ts` 和 dialog 内部

## 6. 接缝契约

```
// shell/view/DialogHost.tsx（shell 内部）
import { CreateSessionDialog, SelectSavedDialog, EditSessionDialog } from "@/ui/modules/session/api";
import { useAppShell } from "@/ui/modules/shell/api";
import { useWorkspaceApi } from "@/ui/modules/workspace/api";

function DialogHost() {
  const shell = useAppShell();
  const workspace = useWorkspaceApi();
  const activeWs = workspace.activeWorkspaceId;

  switch (shell.activeDialog?.kind) {
    case "createSession":
      return (
        <CreateSessionDialog
          workspaceId={shell.activeDialog.payload?.workspaceId ?? activeWs!}
          defaultType={shell.activeDialog.payload?.type}
          onCreated={(sessionId, configId) => {
            workspace.openSession(sessionId, configId);
            shell.closeDialog();
          }}
          onCancel={() => shell.closeDialog()}
        />
      );
    case "selectSaved":
      return (
        <SelectSavedDialog
          onSelected={(configId) => {
            sessionApi.openSavedConfig(configId, activeWs!);
            shell.closeDialog();
          }}
          onCancel={() => shell.closeDialog()}
        />
      );
    // ...
  }
}
```

**接缝约束**：

- session module **不**直接渲染 dialog——shell 持有 `activeDialog` 状态，session 提供 dialog 组件
- session module **不**直接调 workspace——通过 `useWorkspaceApi().openSession()` 间接触发
- session module **不**写 service/persistence 的具体存储——通过 `useSessionApi()` 内部编排
