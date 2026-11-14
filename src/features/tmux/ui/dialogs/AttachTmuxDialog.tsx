import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type SavedTerminalConfig,
  type Terminal,
  type TerminalDisplayConfig,
  type TmuxSessionConfig,
} from "../../../../models/legacy/terminal";
import { Dialog } from "../../../../shared/ui/Dialog";
import { DEFAULT_GROUP_ID, useSavedLaunchConfigs } from "../../../sessions";
import { validateSshConfig } from "../../../terminal/ui/dialogs/SshTerminalForm";
import {
  SessionFormLayout,
  type SessionFormSidebarItem,
} from "../../../terminal/ui/dialogs/TerminalFormLayout";
import { SessionFormPanels } from "../../../terminal/ui/dialogs/TerminalFormPanels";
import { useTerminalForm } from "../../../terminal/ui/dialogs/useTerminalForm";
import { DEFAULT_SSH, TMUX_SIDEBAR_ITEMS } from "../../../terminal/ui/dialogs/terminalDialogItems";
import TmuxForm, { buildTmuxConfigForBase } from "./TmuxForm";
import "../../../terminal/ui/dialogs/CreateTerminalDialog.css";
import {
  defaultTmuxDisplayName,
  isTmuxDisplayNameAvailable,
  uniqueTmuxDisplayName,
} from "../../viewModels/sessionIdentity";

interface AttachTmuxDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAttachTmux: (
    config: TmuxSessionConfig,
    save: boolean,
    displayConfig?: TerminalDisplayConfig,
  ) => Promise<Terminal>;
  initialGroupId?: number;
}

export function AttachTmuxDialog({
  isOpen,
  onClose,
  onAttachTmux,
  initialGroupId = DEFAULT_GROUP_ID,
}: AttachTmuxDialogProps) {
  const { addToGroup, saveConfigOnly, savedConfigs } = useSavedLaunchConfigs();
  const [tmuxConfig, setTmuxConfig] = useState<TmuxSessionConfig>({});
  const [shouldSaveConfig, setShouldSaveConfig] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const form = useTerminalForm({
    isOpen,
    initialName: "",
    initialGroupId: DEFAULT_GROUP_ID,
    initialLocalConfig: {},
    initialSshConfig: DEFAULT_SSH,
    initialDisplayConfig: undefined,
  });

  useEffect(() => {
    if (isOpen) setTmuxConfig({});
  }, [isOpen]);

  const closeDialog = () => {
    if (!isSubmittingRef.current) onClose();
  };

  const prepareConfig = (): { config: TmuxSessionConfig; base?: SavedTerminalConfig } | null => {
    const tmuxSessionName = tmuxConfig.tmuxSessionName?.trim();
    if (!tmuxSessionName) {
      form.setError("Please enter the tmux session name to attach to.");
      form.setSectionId("connection");
      return null;
    }
    const baseConfigId = tmuxConfig.baseConfigId;
    if (!baseConfigId) {
      form.setError("Please pick a base SSH or Shell saved config.");
      form.setSectionId("connection");
      return null;
    }
    const base = savedConfigs.find((config) => config.id === baseConfigId);
    if (!base || (base.type !== "local" && base.type !== "ssh")) {
      form.setError("Base config must be an existing Shell or SSH config.");
      form.setSectionId("connection");
      return null;
    }
    if (base.type === "ssh") {
      const validationError = validateSshConfig(base.config);
      if (validationError) {
        form.setError(validationError);
        form.setSectionId("connection");
        return null;
      }
    }

    const requestedName = form.name.trim();
    if (
      requestedName &&
      !isTmuxDisplayNameAvailable(requestedName, savedConfigs, {
        baseConfigId: base.id,
      })
    ) {
      form.setError("A tmux session with this display name already exists.");
      form.setSectionId("connection");
      return null;
    }
    const draftConfig: TmuxSessionConfig = {
      ...tmuxConfig,
      name:
        requestedName ||
        uniqueTmuxDisplayName(defaultTmuxDisplayName(tmuxConfig), savedConfigs, {
          baseConfigId: base.id,
        }),
    };
    return {
      base,
      config: buildTmuxConfigForBase(draftConfig, base),
    };
  };

  const handleCreate = async () => {
    if (isSubmittingRef.current) return;
    const prepared = prepareConfig();
    if (!prepared) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    form.setError("");

    try {
      const terminal = await onAttachTmux(prepared.config, shouldSaveConfig, form.displayConfig);
      addToGroup(initialGroupId, terminal.configId);
      onClose();
    } catch (error) {
      form.setError(error instanceof Error ? error.message : String(error));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSaveOnly = () => {
    const prepared = prepareConfig();
    if (!prepared) return;
    const savedConfig = saveConfigOnly("tmux-pane", prepared.config, form.displayConfig);
    addToGroup(initialGroupId, savedConfig.id);
    onClose();
  };

  const sidebarItems: SessionFormSidebarItem[] = TMUX_SIDEBAR_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === form.sectionId,
    onClick: () => {
      form.setSectionId(item.id);
      form.setError("");
    },
  }));

  const connectionType =
    savedConfigs.find((config) => config.id === tmuxConfig.baseConfigId)?.type === "ssh"
      ? "ssh"
      : "tmux-pane";

  const footer = (
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
          onClick={closeDialog}
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
          {isSubmitting ? "Attaching..." : "Attach"}
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeDialog}
      title="Attach Tmux Session"
      className="create-terminal-dialog"
      footer={footer}
    >
      <SessionFormLayout sidebarItems={sidebarItems}>
        <SessionFormPanels
          form={form}
          connectionType={connectionType}
          renderSessionSection={(): ReactNode => (
            <TmuxForm
              name={form.name}
              onNameChange={form.setName}
              config={tmuxConfig}
              onConfigChange={setTmuxConfig}
              mode="attach"
            />
          )}
        />
      </SessionFormLayout>
    </Dialog>
  );
}
