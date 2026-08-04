import Box from "@mui/material/Box";
import { useSession } from "../contexts/SessionContext";
import { Workspace } from "../types/session";
import { PaneInitCard } from "./PaneInitCard";

interface InitWindowViewProps {
  workspace: Workspace;
  windowId: string;
}

export function InitWindowView({ workspace, windowId }: InitWindowViewProps) {
  const { replaceInitWindowWithSession } = useSession();

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-primary)",
        overflow: "auto",
      }}
    >
      <PaneInitCard
        onSessionCreated={(session) =>
          replaceInitWindowWithSession(workspace.id, windowId, session)
        }
      />
    </Box>
  );
}
