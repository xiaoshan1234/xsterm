import { type ReactNode } from "react";
import { ShellSettingsPanel } from "./ShellSettingsPanel";
import { SSHSettingsPanel } from "./SSHSettingsPanel";
import AppearanceTab from "./AppearanceTab";
import TerminalTab from "./TerminalTab";
import InputTab from "./InputTab";
import LoggingTab from "./LoggingTab";
import { type SessionFormState } from "./useTerminalForm";

interface SessionFormPanelsProps {
  form: SessionFormState;
  /** Passed to `TerminalTab` to pick the local / ssh / tmux-pane config
   * column for PTY-side settings (TERM / charset / initialRows / initialCols). */
  connectionType: "local" | "ssh" | "tmux-pane";
  /** The "terminal" tab differs between Create (SessionTab inline) and Edit
   * (inline name + group + SessionTab w/ hideNameAndGroup, or tmux-pane note).
   * The dialog renders this slot itself. */
  renderSessionSection: () => ReactNode;
}

/**
 * Renders the six sub-panels of the Create / Edit terminal dialogs that are
 * identical between the two (and between local / ssh / tmux-pane connection
 * types). The "terminal" tab itself is dialog-specific — `renderSessionSection`
 * is the slot each dialog fills with its own form.
 */
export function SessionFormPanels({
  form,
  connectionType,
  renderSessionSection,
}: SessionFormPanelsProps) {
  const renderSection = () => {
    switch (form.sectionId) {
      case "connection":
        return renderSessionSection();
      case "shell":
        return (
          <ShellSettingsPanel
            localConfig={form.localConfig}
            onLocalConfigChange={form.setLocalConfig}
          />
        );
      case "ssh":
        return (
          <SSHSettingsPanel sshConfig={form.sshConfig} onSshConfigChange={form.setSshConfig} />
        );
      case "appearance":
        return <AppearanceTab config={form.displayConfig} onChange={form.setDisplayConfig} />;
      case "terminal":
        return (
          <TerminalTab
            config={form.displayConfig}
            onChange={form.setDisplayConfig}
            connectionType={connectionType}
            localConfig={form.localConfig}
            onLocalConfigChange={form.setLocalConfig}
            sshConfig={form.sshConfig}
            onSshConfigChange={form.setSshConfig}
          />
        );
      case "input":
        return (
          <InputTab displayConfig={form.displayConfig} onDisplayChange={form.setDisplayConfig} />
        );
      case "logging":
        return <LoggingTab config={form.displayConfig} onChange={form.setDisplayConfig} />;
    }
  };

  if (form.error && form.sectionId === "connection") {
    return (
      <>
        <div className="dialog-error">{form.error}</div>
        {renderSection()}
      </>
    );
  }
  return <>{renderSection()}</>;
}
