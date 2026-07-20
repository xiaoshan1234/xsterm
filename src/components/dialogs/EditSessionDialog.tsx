import { useState, useEffect } from "react";
import {
  SavedSessionConfig,
  SshSessionSpec,
  SessionSpec,
  SessionGroup,
  SystemConfig,
} from "../../types/session";
import { detectProfileFromSystemConfig } from "../../constants/systemProfiles";
import { Dialog } from "../ui/Dialog";
import { validateSshConfig } from "../../utils/sessionFormUtils";
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
  const [selectedNode, setSelectedNode] = useState<SessionNavNodeId>("session");

  const systemType = config.type === "ssh" ? "ssh" : "local";
  const { system, profile, setSystem } = useSystemProfile(
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
      setSelectedNode("session");
    }
  }, [isOpen, config, groupId, setSystem]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Session name is required");
      return;
    }

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

  const handleNameChange = (value: string) => {
    setName(value);
    setNameError("");
  };

  const handleSystemChange = (next: SystemConfig) => {
    setSystem(next);
  };

  const handleSshSpecChange = (next: SshSessionSpec) => {
    setSpec(next);
    setSshError("");
  };

  const treeProtocol = config.type === "ssh" ? "ssh" : "local";

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
    if (config.type === "ssh") {
      switch (selectedNode) {
        case "session":
          return <SessionPageSsh {...sharedSessionProps} />;
        case "ssh-auth":
          return (
            <SshAuthPage
              spec={spec as SshSessionSpec}
              onSpecChange={handleSshSpecChange}
            />
          );
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
        return config.type === "local" ? (
          <SessionPageLocal {...sharedSessionProps} />
        ) : (
          <PlaceholderPage title="Session" />
        );
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
      <div className="edit-session-dialog__footer-left">
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
          onClick={handleSave}
          disabled={!!nameError}
        >
          Save
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Session"
      size="large"
      contentClassName="dialog-content--flush"
      footer={footer}
    >
      <div className="edit-session-dialog">
        <ProtocolTabs value={config.type} onChange={() => {}} disabled />
        {sshError && <div className="dialog-error">{sshError}</div>}
        <div className="edit-session-dialog__body">
          <SessionNavTree
            protocol={treeProtocol}
            selected={selectedNode}
            onSelect={setSelectedNode}
          />
          <div
            className="edit-session-dialog__content"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                handleSave();
              }
            }}
          >
            {renderPage()}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
