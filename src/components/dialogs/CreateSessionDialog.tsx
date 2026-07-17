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
} from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { SessionTypeSelector, isImplementedType } from "./SessionTypeSelector";
import { SystemConfigForm } from "./SystemConfigForm";
import { TerminalConfigForm } from "./TerminalConfigForm";
import { useSystemProfile } from "./useSystemProfile";
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

  const { system, setSystem, handleTypeChange } = useSystemProfile(
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
      handleTypeChange(narrowTypeForSystem(initialType));
    }
  }, [isOpen, initialGroupId, initialType, handleTypeChange]);

  useEffect(() => {
    if (type === "local" || type === "ssh") {
      handleTypeChange(type);
    }
    setSpec(getDefaultSpec(type));
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

  const footer = (
    <div className="dialog-footer-content">
      <label className="checkbox-group">
        <input
          type="checkbox"
          checked={saveConfig}
          onChange={(e) => setSaveConfig(e.target.checked)}
        />
        <span>Save config</span>
      </label>
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
    <Dialog isOpen={isOpen} onClose={onClose} title="Create Session" footer={footer}>
      <div className="create-session-layer">
        <h3 className="create-session-layer__title">Session</h3>
        <div className="create-session-layer__content">
          <FormField label="Name">
            <input
              type="text"
              placeholder="My session"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(""); }}
              autoFocus
            />
            {nameError && <div className="dialog-error">{nameError}</div>}
          </FormField>

          <SessionTypeSelector value={type} onChange={setType} />

          {isImplementedType(type) && (
            <>
              {type === "local" && (
                <LocalSessionForm
                  value={spec as LocalSessionSpec}
                  onChange={setSpec}
                  mode="create"
                />
              )}
              {type === "ssh" && (
                <SshSessionForm
                  value={spec as SshSessionSpec}
                  onChange={setSpec}
                  mode="create"
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="create-session-layer">
        <h3 className="create-session-layer__title">System</h3>
        <div className="create-session-layer__content">
          <SystemConfigForm value={system} onChange={setSystem} />
        </div>
      </div>

      <div className="create-session-layer">
        <h3 className="create-session-layer__title">Terminal</h3>
        <div className="create-session-layer__content">
          <TerminalConfigForm value={terminal} onChange={setTerminal} />
        </div>
      </div>

      <div className="create-session-layer">
        <h3 className="create-session-layer__title">Options</h3>
        <div className="create-session-layer__content">
          <FormField label="Group">
            <select
              value={selectedGroupId === null ? "none" : selectedGroupId}
              onChange={(e) =>
                setSelectedGroupId(
                  e.target.value === "none" ? null : parseInt(e.target.value),
                )
              }
            >
              <option value="none">None</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </div>

      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}
