import { Box, Typography, Button } from "@mui/material";

interface EmptyStateProps {
  onCreateSession: () => void;
  hasSavedConfigs: boolean;
}

export function EmptyState({ onCreateSession, hasSavedConfigs }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        p: 4,
        height: "100%",
      }}
    >
      {hasSavedConfigs ? (
        <Typography variant="body2" color="text.secondary">
          Click a saved session to reconnect
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            No active sessions
          </Typography>
          <Button variant="contained" onClick={onCreateSession}>
            Create Session
          </Button>
        </>
      )}
    </Box>
  );
}
