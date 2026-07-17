import { useState } from "react";
import "./SessionNavTree.css";

export type SessionNavNodeId =
  | "session"
  | "terminal-bell" | "terminal-mode" | "terminal-keyboard" | "terminal-security" | "terminal-log"
  | "window-selection"
  | "ssh-connection" | "ssh-proxy" | "ssh-auth" | "ssh-agent" | "ssh-password"
  | "ssh-kex" | "ssh-mac" | "ssh-pubkey" | "ssh-sftp" | "ssh-x11" | "ssh-modem";

export const IMPLEMENTED_NAV_NODES: ReadonlySet<SessionNavNodeId> = new Set([
  "session",
  "terminal-mode",
  "terminal-keyboard",
  "terminal-log",
  "ssh-auth",
] as const satisfies SessionNavNodeId[]);

interface NavLeafDef {
  id: SessionNavNodeId;
  label: string;
}

interface NavGroupDef {
  id: string;
  label: string;
  children: NavLeafDef[];
}

const COMMON_GROUPS: NavGroupDef[] = [
  {
    id: "terminal",
    label: "Terminal",
    children: [
      { id: "terminal-bell", label: "Bell" },
      { id: "terminal-mode", label: "Mode" },
      { id: "terminal-keyboard", label: "Keyboard" },
      { id: "terminal-security", label: "Security" },
      { id: "terminal-log", label: "Log" },
    ],
  },
  {
    id: "window",
    label: "Window",
    children: [{ id: "window-selection", label: "Selection" }],
  },
];

const SSH_GROUPS: NavGroupDef[] = [
  {
    id: "ssh",
    label: "SSH",
    children: [
      { id: "ssh-connection", label: "Connection" },
      { id: "ssh-proxy", label: "Proxy" },
      { id: "ssh-auth", label: "Authentication" },
      { id: "ssh-agent", label: "Agent" },
      { id: "ssh-password", label: "Password" },
      { id: "ssh-kex", label: "Key Exchange" },
      { id: "ssh-mac", label: "MAC Hash" },
      { id: "ssh-pubkey", label: "Public Key" },
      { id: "ssh-sftp", label: "SFTP" },
      { id: "ssh-x11", label: "X11" },
      { id: "ssh-modem", label: "X/Y/Z Modem" },
    ],
  },
];

interface SessionNavTreeProps {
  protocol: "local" | "ssh";
  selected: SessionNavNodeId;
  onSelect: (id: SessionNavNodeId) => void;
}

export function SessionNavTree({ protocol, selected, onSelect }: SessionNavTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(["terminal", "window", "ssh"])
  );
  const groups = protocol === "ssh" ? [...COMMON_GROUPS, ...SSH_GROUPS] : COMMON_GROUPS;

  const toggleGroup = (groupId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const isImplemented = (id: SessionNavNodeId) => IMPLEMENTED_NAV_NODES.has(id);

  return (
    <nav className="session-nav-tree" aria-label="Session settings">
      <ul className="session-nav-tree__list">
        <NavLeaf
          id="session"
          label="Session"
          selected={selected === "session"}
          onSelect={onSelect}
          implemented={isImplemented("session")}
        />
        {groups.map((group) => (
          <li key={group.id} className="session-nav-tree__group">
            <button
              className="session-nav-tree__group-header"
              onClick={() => toggleGroup(group.id)}
              type="button"
              aria-expanded={expanded.has(group.id)}
            >
              <span className="session-nav-tree__chevron" aria-hidden="true">
                {expanded.has(group.id) ? "\u25BC" : "\u25B6"}
              </span>
              {group.label}
            </button>
            {expanded.has(group.id) && (
              <ul className="session-nav-tree__children">
                {group.children.map((child) => (
                  <NavLeaf
                    key={child.id}
                    id={child.id}
                    label={child.label}
                    selected={selected === child.id}
                    onSelect={onSelect}
                    implemented={isImplemented(child.id)}
                  />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface NavLeafProps {
  id: SessionNavNodeId;
  label: string;
  selected: boolean;
  onSelect: (id: SessionNavNodeId) => void;
  implemented: boolean;
}

function NavLeaf({ id, label, selected, onSelect, implemented }: NavLeafProps) {
  return (
    <li className="session-nav-tree__item">
      <button
        className={`session-nav-tree__leaf ${selected ? "session-nav-tree__leaf--selected" : ""} ${
          !implemented ? "session-nav-tree__leaf--unimplemented" : ""
        }`}
        onClick={() => onSelect(id)}
        type="button"
        aria-selected={selected}
      >
        {label}
      </button>
    </li>
  );
}
