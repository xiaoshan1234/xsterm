import { SaveDialog } from "./SaveDialog";
import { type PersistedWorkspace } from "../../model";

interface WorkspaceSaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
  savedWorkspaces: PersistedWorkspace[];
}

export function SaveWorkspaceDialog({
  isOpen,
  onClose,
  onSave,
  defaultName,
  savedWorkspaces,
}: WorkspaceSaveDialogProps) {
  return (
    <SaveDialog
      isOpen={isOpen}
      onClose={onClose}
      onSave={onSave}
      defaultName={defaultName}
      title="Save Workspace"
      label="Workspace Name"
      validateName={(name) => {
        const trimmed = name.trim();
        if (trimmed === "default") {
          return "Workspace name is reserved";
        }
        if (savedWorkspaces.some((w) => w.name.trim() === trimmed)) {
          return "Workspace name already exists";
        }
        return null;
      }}
    />
  );
}
