export const SHELL_KINDS = ["powershell", "wsl", "git_bash", "bash"] as const;

export type ShellKind = (typeof SHELL_KINDS)[number];

export const DEFAULT_SHELL: ShellKind = "powershell";
