import { useMemo } from "react";
import { Box, Button, List, ListItem, ListItemButton, ListItemText, Typography, Stack, Divider } from "@mui/material";
import { useSession } from "../../contexts/SessionContext";
import { Dialog } from "../ui/Dialog";

interface SelectSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: number) => void;
  onSelectConfig: (configId: string) => void;
  disabled?: boolean;
}

export function SelectSessionDialog({ isOpen, onClose, onSelectSession, onSelectConfig, disabled = false }: SelectSessionDialogProps) {
  const { sessions, savedConfigs, workspaces } = useSession();

  const usedSessionIds = useMemo(() => {
    const used = new Set<number>();
    workspaces.forEach((workspace) => {
      workspace.windows.forEach((window) => {
        const collect = (node: typeof window.rootPane) => {
          if (node.type === "leaf" && node.sessionId !== undefined) used.add(node.sessionId);
          node.children?.forEach(collect);
        };
        collect(window.rootPane);
      });
    });
    return used;
  }, [workspaces]);

  const availableSessions = sessions.filter((s) => !usedSessionIds.has(s.id));
  const availableConfigs = savedConfigs;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Select Session" size="medium"
      footer={<Box sx={{ display: "flex", justifyContent: "flex-end" }}><Button onClick={onClose}>Cancel</Button></Box>}>
      {availableSessions.length === 0 && availableConfigs.length === 0 ? (
        <Typography color="text.secondary">No available sessions or saved configs.</Typography>
      ) : (
        <Stack spacing={2}>
          {availableSessions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Existing unused sessions</Typography>
              <List dense>
                {availableSessions.map((session) => (
                  <ListItem key={session.id} disablePadding>
                    <ListItemButton disabled={disabled} onClick={() => onSelectSession(session.id)}>
                      <ListItemText primary={session.name} secondary={session.type} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          {availableConfigs.length > 0 && (
            <Box>
              {availableSessions.length > 0 && <Divider sx={{ my: 1 }} />}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Saved configs</Typography>
              <List dense>
                {availableConfigs.map((config) => (
                  <ListItem key={config.id} disablePadding>
                    <ListItemButton disabled={disabled} onClick={() => onSelectConfig(config.id)}>
                      <ListItemText primary={config.name} secondary={config.type} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Stack>
      )}
    </Dialog>
  );
}
