export interface Session {
  id: number;
  name: string;
  type: "local" | "ssh";
  is_connected: boolean;
  session_type: SessionType;
}

export type SessionType =
  | { type: "local"; shell: string; cwd: string }
  | { type: "ssh"; host: string; port: number; user: string };

export interface LocalSessionConfig {
  shell?: string;
  cwd?: string;
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

export type CreateSessionConfig =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig };