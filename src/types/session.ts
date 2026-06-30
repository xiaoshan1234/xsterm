import type { TmuxSessionConfig, SshTmuxSessionConfig } from "./tmux";

export type SessionPane = 1 | 2 | 3 | 4;
export type PaneLayout = "1" | "2-v" | "2-h" | "3-left-big" | "3-right-big" | "3-top-big" | "3-bottom-big" | "4";

export interface Session {
  id: number;
  configId: string;
  name: string;
  type: "local" | "ssh" | "tmux" | "ssh_tmux";
  is_connected: boolean;
  session_type: SessionType;
  pane?: SessionPane;
}

export type SessionType =
  | { type: "local"; shell: string; cwd: string }
  | { type: "ssh"; host: string; port: number; user: string }
  | { type: "tmux"; socket?: string; command: string }
  | { type: "ssh_tmux"; host: string; port: number; user: string; socket?: string; command: string };

export { TmuxSessionConfig, SshTmuxSessionConfig };
export * from "./tmux";

export interface LocalSessionConfig {
  shell?: string;
  cwd?: string;
  args?: string[];
}

export interface SSHSessionConfig {
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  password?: string;
  key_file?: string;
  passphrase?: string;
}

export interface SavedSessionConfig {
  id: string;
  name: string;
  type: "local" | "ssh" | "tmux" | "ssh_tmux";
  localConfig?: LocalSessionConfig;
  sshConfig?: SSHSessionConfig;
  tmuxConfig?: TmuxSessionConfig;
  sshTmuxConfig?: SshTmuxSessionConfig;
}

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
