import { useState, useEffect } from "react";
import { useSession } from "../../contexts/SessionContext";
import type {
  CreateSavedSessionConfig,
  SessionTypeKind,
  LocalSessionSpec,
  SshSessionSpec,
  SessionSpec,
  TerminalConfig,
  Session,
  SystemConfig,
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { isImplementedType, validateSshConfig } from "../../utils/sessionFormUtils";
import { useSystemProfile } from "./useSystemProfile";
import { ProtocolTabs } from "./ProtocolTabs";
import { SessionNavTree, SessionNavNodeId, getNavNodeLabel } from "./SessionNavTree";
import {
  SessionPageLocal,
  SessionPageSsh,
  TerminalModePage,
  TerminalKeyboardPage,
  TerminalLogPage,
  SshAuthPage,
  PlaceholderPage,
} from "./SessionPages";
import type { SessionPageProps } from "./SessionPages";
import "./CreateSessionDialog.css";

export type { CreateSavedSessionConfig };

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (config: CreateSavedSessionConfig, save: boolean) => Promise<Session>;
  onCreateSsh: (config: CreateSavedSessionConfig, save: boolean) => Promise<Session>;
  initialType?: SessionTypeKind;
  initialGroupId?: number | null;
}

const DEFAULT_LOCAL_SPEC: LocalSessionSpec = {};
const DEFAULT_SSH_SPEC: SshSessionSpec = {
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  password: "",
  key_file: "",
  passphrase: "",
};
const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  scrollbackLines: 5000,
  autoLogPath: "",
  highlightKeywords: "",
};

function getDefaultSpec(type: SessionTypeKind): SessionSpec {
  return type === "ssh" ? DEFAULT_SSH_SPEC : DEFAULT_LOCAL_SPEC;
}

function narrowTypeForSystem(type: SessionTypeKind): "local" | "ssh" {
  return type === "ssh" ? "ssh" : "local";
}

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
  initialType = "local",
  initialGroupId,
}: CreateSessionDialogProps) {
  const { groups, addToGroup } = useSession();
  const [type, setType] = useState<SessionTypeKind>(initialType);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<SessionSpec>(getDefaultSpec(initialType));
  const [terminal, setTerminal] = useState<TerminalConfig>(DEFAULT_TERMINAL_CONFIG);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [saveConfig, setSaveConfig] = useState(true);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [selectedNode, setSelectedNode] = useState<SessionNavNodeId>("session");

  const { system, profile, setSystem, handleTypeChange } = useSystemProfile(
    narrowTypeForSystem(initialType),
  );

  useEffect(() => {
    if (isOpen) {
      setType(initialType);
      setName("");
      setSpec(getDefaultSpec(initialType));
      setTerminal(DEFAULT_TERMINAL_CONFIG);
      setSelectedGroupId(initialGroupId ?? null);
      setSaveConfig(true);
      setError("");
      setNameError("");
      setSelectedNode("session");
      handleTypeChange(narrowTypeForSystem(initialType));
    }
  }, [isOpen, initialGroupId, initialType, handleTypeChange]);

  useEffect(() => {
    if (type === "local" || type === "ssh") {
      handleTypeChange(type);
    }
    setSpec(getDefaultSpec(type));
    setSelectedNode("session");
  }, [type, handleTypeChange]);

  const handleCreate = async () => {
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Session name is required");
      return;
    }

    if (type === "ssh") {
      const validationError = validateSshConfig(spec as SshSessionSpec);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    const config: CreateSavedSessionConfig = {
      name: trimmedName,
      type,
      groupId: selectedGroupId !== null ? String(selectedGroupId) : null,
      spec,
      system,
      terminal,
    };

    try {
      const session =
        type === "local"
          ? await onCreateLocal(config, saveConfig)
          : await onCreateSsh(config, saveConfig);

      if (selectedGroupId !== null) {
        addToGroup(selectedGroupId, session.configId);
      }
      onClose();
    } catch (err) {
      console.error("Failed to create session:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isCreateDisabled = !name.trim() || !isImplementedType(type) || !!nameError;

  const treeProtocol = type === "ssh" ? "ssh" : "local";

  const handleNameChange = (value: string) => {
    setName(value);
    setNameError("");
  };

  const handleSystemChange = (next: SystemConfig) => {
    setSystem(next);
  };

  const handleSshSpecChange = (next: SshSessionSpec) => {
    setSpec(next);
  };

  const sharedSessionProps: SessionPageProps = {
    name,
    onNameChange: handleNameChange,
    nameError: nameError || undefined,
    spec,
    onSpecChange: setSpec,
    system,
    onSystemChange: handleSystemChange,
    profile,
    groups,
    groupId: selectedGroupId,
    onGroupChange: setSelectedGroupId,
  };

  const renderPage = () => {
    if (type === "ssh") {
      switch (selectedNode) {
        case "session":
          return <SessionPageSsh {...sharedSessionProps} />;
        case "ssh-auth":
          return <SshAuthPage spec={spec as SshSessionSpec} onSpecChange={handleSshSpecChange} />;
        case "terminal-mode":
          return (
            <TerminalModePage
              system={system}
              onSystemChange={handleSystemChange}
              profile={profile}
              terminal={terminal}
              onTerminalChange={setTerminal}
            />
          );
        case "terminal-keyboard":
          return (
            <TerminalKeyboardPage
              system={system}
              onSystemChange={handleSystemChange}
              profile={profile}
            />
          );
        case "terminal-log":
          return <TerminalLogPage terminal={terminal} onTerminalChange={setTerminal} />;
        default:
          return <PlaceholderPage title={getNavNodeLabel(selectedNode)} />;
      }
    }

    switch (selectedNode) {
      case "session":
        return type === "local" ? <SessionPageLocal {...sharedSessionProps} /> : <PlaceholderPage title="Session" />;
      case "terminal-mode":
        return (
          <TerminalModePage
            system={system}
            onSystemChange={handleSystemChange}
            profile={profile}
            terminal={terminal}
            onTerminalChange={setTerminal}
          />
        );
      case "terminal-keyboard":
        return (
          <TerminalKeyboardPage
            system={system}
            onSystemChange={handleSystemChange}
            profile={profile}
          />
        );
      case "terminal-log":
        return <TerminalLogPage terminal={terminal} onTerminalChange={setTerminal} />;
      default:
        return <PlaceholderPage title={getNavNodeLabel(selectedNode)} />;
    }
  };

  const footer = (
    <div className="dialog-footer-content">
      <div className="create-session-dialog__footer-left">
        <label className="checkbox-group">
          <input
            type="checkbox"
            checked={saveConfig}
            onChange={(e) => setSaveConfig(e.target.checked)}
          />
          <span>Save config</span>
        </label>
        <button
          type="button"
          className="btn btn--secondary"
          disabled
          title="Not implemented"
        >
          Edit defaults...
        </button>
      </div>
      <div className="dialog-footer-buttons">
        <button className="btn btn--secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn--primary"
          onClick={handleCreate}
          disabled={isCreateDisabled}
        >
          Create
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create Session"
      size="large"
      contentClassName="dialog-content--flush"
      footer={footer}
    >
      <div className="create-session-dialog">
        <ProtocolTabs value={type} onChange={setType} />
        <div className="create-session-dialog__body">
          <SessionNavTree
            protocol={treeProtocol}
            selected={selectedNode}
            onSelect={setSelectedNode}
          />
          <div
            className="create-session-dialog__content"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                handleCreate();
              }
            }}
          >
            {renderPage()}
          </div>
        </div>
        {error && <div className="dialog-error">{error}</div>}
      </div>
    </Dialog>
  );
}
