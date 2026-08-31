import type { ReactNode } from "react";
import {
  SessionIcon,
  ShellIcon,
  SshIcon,
  TerminalIcon,
  AppearanceIcon,
  KeyboardIcon,
  LogIcon,
} from "../icons/Icon";
import type { SSHSessionConfig } from "../../types/session";

/**
 * Shared sidebar config for the Create / Edit session dialogs.
 *
 * Both dialogs use the same six sections; only the SSH dialog inserts an
 * "SSH" entry where the Shell dialog shows "Shell". Keeping the static
 * definition in one place lets the two dialogs diverge only on the
 * session-level behavior (create vs edit, error-clearing wrappers) rather
 * than on copy-pasted sidebar metadata.
 */

export type SectionId =
  | "session"
  | "terminal"
  | "appearance"
  | "shell"
  | "ssh"
  | "input"
  | "logging";

export interface SidebarItemDef {
  id: SectionId;
  label: string;
  icon: ReactNode;
}

export const SHELL_SIDEBAR_ITEMS: SidebarItemDef[] = [
  { id: "session", label: "Session", icon: <SessionIcon size={16} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalIcon size={16} /> },
  { id: "appearance", label: "Appearance", icon: <AppearanceIcon size={16} /> },
  { id: "shell", label: "Shell", icon: <ShellIcon size={16} /> },
  { id: "input", label: "Input", icon: <KeyboardIcon size={16} /> },
  { id: "logging", label: "Logging", icon: <LogIcon size={16} /> },
];

export const SSH_SIDEBAR_ITEMS: SidebarItemDef[] = [
  { id: "session", label: "Session", icon: <SessionIcon size={16} /> },
  { id: "terminal", label: "Terminal", icon: <TerminalIcon size={16} /> },
  { id: "appearance", label: "Appearance", icon: <AppearanceIcon size={16} /> },
  { id: "ssh", label: "SSH", icon: <SshIcon size={16} /> },
  { id: "input", label: "Input", icon: <KeyboardIcon size={16} /> },
  { id: "logging", label: "Logging", icon: <LogIcon size={16} /> },
];

/**
 * Empty-shape default for the SSH form. Used as the initial value when the
 * Create dialog opens and to reset the form between opens. Also used by the
 * Edit dialog when the saved session is local-typed.
 */
export const DEFAULT_SSH: SSHSessionConfig = {
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  password: "",
  key_file: "",
  passphrase: "",
};