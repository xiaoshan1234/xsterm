import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Typography from "@mui/material/Typography";
import { useSession } from "../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session } from "../types/session";
import { PlusIcon, FolderOpenIcon } from "./icons";
import CreateSessionDialog from "./dialogs/CreateSessionDialog";
import { SelectSessionDialog } from "./dialogs/SelectSessionDialog";

export interface PaneInitCardProps {
  onSessionCreated: (session: Session) => void;
  title?: string;
  subtitle?: string;
}

export function PaneInitCard({
  onSessionCreated,
  title = "Create a session",
  subtitle = "Create new or open a saved session",
}: PaneInitCardProps) {
  const {
    sessions,
    createLocalSessionOnly,
    createSshSessionOnly,
    createSessionFromSavedConfig,
  } = useSession();
  const [createDialogTab, setCreateDialogTab] = useState<"local" | "ssh" | null>(null);
  const [showSelectDialog, setShowSelectDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const startSubmitting = () => {
    if (isSubmittingRef.current) return false;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    return true;
  };

  const endSubmitting = () => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  };

  const handleCreate = async (create: () => Promise<Session>): Promise<Session> => {
    const session = await create();
    try {
      onSessionCreated(session);
    } catch (e) {
      if (e instanceof Error && e.message === "Session is already used in another window") {
        window.alert("Session is already used in another window");
      } else {
        throw e;
      }
    }
    return session;
  };

  const handleCreateLocal = (config: LocalSessionConfig, save: boolean) =>
    handleCreate(() => createLocalSessionOnly(config, save));

  const handleCreateSsh = (config: SSHSessionConfig, save: boolean) =>
    handleCreate(() => createSshSessionOnly(config, save));

  const handleSelectSession = (sessionId: number) => {
    if (!startSubmitting()) return;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      endSubmitting();
      return;
    }

    try {
      onSessionCreated(session);
      setShowSelectDialog(false);
    } catch (e) {
      if (e instanceof Error && e.message === "Session is already used in another window") {
        window.alert("Session is already used in another window");
      } else {
        window.alert(`Failed to create session: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      endSubmitting();
    }
  };

  const handleSelectConfig = async (configId: string) => {
    if (!startSubmitting()) return;
    try {
      const session = await createSessionFromSavedConfig(configId);
      onSessionCreated(session);
      setShowSelectDialog(false);
    } catch (e) {
      if (e instanceof Error && e.message === "Session is already used in another window") {
        window.alert("Session is already used in another window");
      } else {
        window.alert(`Failed to create session: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      endSubmitting();
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        padding: 4,
        boxSizing: "border-box",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: 0,
        overflow: "auto",
      }}
    >
      <Typography
        variant="h6"
        sx={{ fontWeight: 600, color: "var(--text-primary)", margin: 0 }}
      >
        {title}
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: "var(--text-secondary)", margin: 0 }}
      >
        {subtitle}
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 2,
          marginTop: 2,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <Card sx={{ width: 120 }}>
          <CardActionArea
            onClick={() => setCreateDialogTab("local")}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              padding: "24px 16px",
              color: "var(--text-secondary)",
              "&:hover": {
                color: "var(--text-primary)",
                bgcolor: "var(--bg-hover)",
              },
            }}
          >
            <PlusIcon sx={{ fontSize: 32 }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Create New
            </Typography>
          </CardActionArea>
        </Card>
        <Card sx={{ width: 120 }}>
          <CardActionArea
            onClick={() => setShowSelectDialog(true)}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              padding: "24px 16px",
              color: "var(--text-secondary)",
              "&:hover": {
                color: "var(--text-primary)",
                bgcolor: "var(--bg-hover)",
              },
            }}
          >
            <FolderOpenIcon sx={{ fontSize: 32 }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Open Saved
            </Typography>
          </CardActionArea>
        </Card>
      </Box>
      <CreateSessionDialog
        isOpen={createDialogTab !== null}
        onClose={() => setCreateDialogTab(null)}
        onCreateLocal={handleCreateLocal}
        onCreateSsh={handleCreateSsh}
        initialTab={createDialogTab ?? "local"}
      />
      <SelectSessionDialog
        isOpen={showSelectDialog}
        onClose={() => setShowSelectDialog(false)}
        onSelectSession={handleSelectSession}
        onSelectConfig={handleSelectConfig}
        disabled={isSubmitting}
      />
    </Box>
  );
}
