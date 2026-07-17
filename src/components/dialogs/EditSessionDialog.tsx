import { useState, useEffect } from "react";
import {
  SavedSessionConfig,
  LocalSessionSpec,
  SshSessionSpec,
  SessionSpec,
  SessionGroup,
} from "../../types/session";
import { detectProfileFromSystemConfig } from "../../constants/systemProfiles";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { SessionTypeSelector } from "./SessionTypeSelector";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { SystemConfigForm } from "./SystemConfigForm";
import { TerminalConfigForm } from "./TerminalConfigForm";
import { useSystemProfile } from "./useSystemProfile";
import "./EditSessionDialog.css";

interface EditSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: SavedSessionConfig;
  groups: SessionGroup[];
  groupId: number | null;
  onSave: (config: SavedSessionConfig, groupId: number | null) => void;
}

export function EditSessionDialog({
  isOpen,
  onClose,
  config,
  groups,
  groupId,
  onSave,
}: EditSessionDialogProps) {
  const [name, setName] = useState(config.name);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groupId);
  const [spec, setSpec] = useState<SessionSpec>(config.spec);
  const [terminal, setTerminal] = useState(config.terminal);
  const [sshError, setSshError] = useState("");
  const [nameError, setNameError] = useState("");

  const systemType = config.type === "ssh" ? "ssh" : "local";
  const { system, setSystem } = useSystemProfile(
    systemType,
    config.system,
    detectProfileFromSystemConfig(config.system),
  );

  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setSelectedGroupId(groupId);
      setSpec(config.spec);
      setTerminal(config.terminal);
      setSystem(config.system);
      setSshError("");
      setNameError("");
    }
  }, [isOpen, config, groupId, setSystem]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setNameError("Session name is required"); return; }

    if (config.type === "ssh") {
      const validationError = validateSshConfig(spec as SshSessionSpec);
      if (validationError) {
        setSshError(validationError);
        return;
      }
    }

    const updatedConfig: SavedSessionConfig = {
      ...config,
      name: trimmedName,
      groupId: selectedGroupId !== null ? String(selectedGroupId) : null,
      spec,
      system,
      terminal,
    };

    onSave(updatedConfig, selectedGroupId);
    onClose();
  };

  const handleLocalSpecChange = (newSpec: LocalSessionSpec) => setSpec(newSpec);
  const handleSshSpecChange = (newSpec: SshSessionSpec) => {
    setSpec(newSpec);
    setSshError("");
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Session"
      size="medium"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!!nameError}>
            Save
          </button>
        </div>
      }
    >
      {sshError && <div className="dialog-error">{sshError}</div>}

      <section className="edit-session-layer">
        <h3 className="edit-session-layer__title">Session</h3>

          <FormField label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
            />
            {nameError && <div className="dialog-error">{nameError}</div>}
          </FormField>

        <SessionTypeSelector
          value={config.type}
          onChange={() => {}}
          mode="edit"
          disabled={true}
        />

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

        {config.type === "local" && (
          <LocalSessionForm
            value={spec as LocalSessionSpec}
            onChange={handleLocalSpecChange}
            mode="edit"
          />
        )}

        {config.type === "ssh" && (
          <SshSessionForm
            value={spec as SshSessionSpec}
            onChange={handleSshSpecChange}
            mode="edit"
          />
        )}
      </section>

      <section className="edit-session-layer">
        <h3 className="edit-session-layer__title">System</h3>
        <SystemConfigForm value={system} onChange={setSystem} />
      </section>

      <section className="edit-session-layer">
        <h3 className="edit-session-layer__title">Terminal</h3>
        <TerminalConfigForm value={terminal} onChange={setTerminal} />
      </section>
    </Dialog>
  );
}
