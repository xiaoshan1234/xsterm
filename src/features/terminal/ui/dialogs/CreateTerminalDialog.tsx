import { useEffect, useRef, useState } from "react";
import {
  type LocalTerminalConfig,
  type SshConfig,
  type Terminal,
  type TerminalDisplayConfig,
} from "../../../../types/terminal";
import { Dialog } from "../../../../shared/ui/Dialog";
import { DEFAULT_GROUP_ID, useSession } from "../../../sessions";
import SessionTab from "../../logic/dialogs/ConnectionTab";
import { validateSshConfig } from "../../logic/dialogs/SshTerminalForm";
import {
  SessionFormLayout,
  type SessionFormSidebarItem,
} from "../../logic/dialogs/TerminalFormLayout";
import { SessionFormPanels } from "../../logic/dialogs/TerminalFormPanels";
import { useTerminalForm } from "../../logic/dialogs/useTerminalForm";
import {
  DEFAULT_SSH,
  SHELL_SIDEBAR_ITEMS,
  SSH_SIDEBAR_ITEMS,
} from "../../logic/dialogs/terminalDialogItems";
import "../../logic/dialogs/CreateTerminalDialog.css";

type TerminalCreateTab = "local" | "ssh";

interface CreateTerminalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (
    config: LocalTerminalConfig,
    save: boolean,
    displayConfig?: TerminalDisplayConfig,
  ) => Promise<Terminal>;
  onCreateSsh: (
    config: SshConfig,
    save: boolean,
    displayConfig?: TerminalDisplayConfig,
  ) => Promise<Terminal>;
  initialTab?: TerminalCreateTab;
  initialGroupId?: number;
}

export function CreateTerminalDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
  initialTab = "local",
  initialGroupId = DEFAULT_GROUP_ID,
}: CreateTerminalDialogProps) {
  const { groups, addToGroup, saveConfigOnly } = useSession();
  const [topTab, setTopTab] = useState<TerminalCreateTab>(initialTab);
  const [shouldSaveConfig, setShouldSaveConfig] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const form = useTerminalForm({
    isOpen,
    initialName: "",
    initialGroupId,
    initialLocalConfig: {},
    initialSshConfig: DEFAULT_SSH,
    initialDisplayConfig: undefined,
  });

  useEffect(() => {
    if (isOpen) setTopTab(initialTab);
  }, [initialTab, isOpen]);

  const sidebarItems = topTab === "ssh" ? SSH_SIDEBAR_ITEMS : SHELL_SIDEBAR_ITEMS;

  const closeDialog = () => {
    if (!isSubmittingRef.current) onClose();
  };

  const validate = (): boolean => {
    if (topTab !== "ssh") return true;
    const validationError = validateSshConfig(form.sshConfig);
    if (!validationError) return true;
    form.setError(validationError);
    form.setSectionId("connection");
    return false;
  };

  const handleCreate = async () => {
    if (isSubmittingRef.current || !validate()) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    form.setError("");

    try {
      const name = form.name.trim();
      const terminal =
        topTab === "ssh"
          ? await onCreateSsh(
              name ? { ...form.sshConfig, name } : form.sshConfig,
              shouldSaveConfig,
              form.displayConfig,
            )
          : await onCreateLocal(
              name ? { ...form.localConfig, name } : form.localConfig,
              shouldSaveConfig,
              form.displayConfig,
            );
      addToGroup(form.selectedGroupId, terminal.configId);
      onClose();
    } catch (error) {
      form.setError(error instanceof Error ? error.message : String(error));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSaveOnly = () => {
    if (isSubmittingRef.current || !validate()) return;
    form.setError("");
    const name = form.name.trim();
    const config =
      topTab === "ssh"
        ? name
          ? { ...form.sshConfig, name }
          : form.sshConfig
        : name
          ? { ...form.localConfig, name }
          : form.localConfig;
    const saved = saveConfigOnly(topTab, config, form.displayConfig);
    addToGroup(form.selectedGroupId, saved.id);
    onClose();
  };

  const sidebarItemProps: SessionFormSidebarItem[] = sidebarItems.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === form.sectionId,
    onClick: () => {
      form.setSectionId(item.id);
      form.setError("");
    },
  }));

  const topTabs = [
    {
      id: "local",
      label: "Shell",
      active: topTab === "local",
      onClick: () => {
        setTopTab("local");
        form.setSectionId("connection");
      },
    },
    {
      id: "ssh",
      label: "SSH",
      active: topTab === "ssh",
      onClick: () => {
        setTopTab("ssh");
        form.setSectionId("connection");
      },
    },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeDialog}
      title="Create Terminal"
      className="create-terminal-dialog"
      footer={
        <div className="dialog-footer-content">
          <label className="checkbox-group">
            <input
              type="checkbox"
              checked={shouldSaveConfig}
              disabled={isSubmitting}
              onChange={(event) => setShouldSaveConfig(event.target.checked)}
            />
            <span>Save config</span>
          </label>
          <div className="dialog-footer-buttons">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={isSubmitting}
              onClick={handleSaveOnly}
            >
              Save Only
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={isSubmitting}
              onClick={handleCreate}
            >
              {isSubmitting ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      }
    >
      <SessionFormLayout topTabs={topTabs} sidebarItems={sidebarItemProps}>
        <SessionFormPanels
          form={form}
          connectionType={topTab}
          renderSessionSection={() => (
            <SessionTab
              connectionType={topTab}
              onConnectionTypeChange={(type) => {
                setTopTab(type);
                form.setSectionId("connection");
              }}
              name={form.name}
              onNameChange={form.setName}
              selectedGroupId={form.selectedGroupId}
              onGroupChange={form.setSelectedGroupId}
              groups={groups}
              localConfig={form.localConfig}
              onLocalConfigChange={form.setLocalConfig}
              sshConfig={form.sshConfig}
              onSshConfigChange={(config) => {
                form.setSshConfig(config);
                form.setError("");
              }}
              hideConnectionSwitcher
            />
          )}
        />
      </SessionFormLayout>
    </Dialog>
  );
}
