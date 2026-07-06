import { SaveDialog } from "./SaveDialog";

interface SaveWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
}

export function SaveWorkspaceDialog({ isOpen, onClose, onSave, defaultName }: SaveWorkspaceDialogProps) {
  return (
    <SaveDialog
      isOpen={isOpen}
      onClose={onClose}
      onSave={onSave}
      defaultName={defaultName}
      title="Save Workspace"
      label="Workspace Name"
    />
  );
}
