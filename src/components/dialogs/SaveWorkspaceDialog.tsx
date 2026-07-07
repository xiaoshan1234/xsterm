import { SaveDialog } from "./SaveDialog";
import { SavedWorkspace } from "../../types/session";

interface SaveWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
  savedWorkspaces: SavedWorkspace[];
}

export function SaveWorkspaceDialog({ isOpen, onClose, onSave, defaultName, savedWorkspaces }: SaveWorkspaceDialogProps) {
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
        if (savedWorkspaces.some((w) => w.name.trim() === trimmed)) {
          return "Workspace name already exists";
        }
        return null;
      }}
    />
  );
}
