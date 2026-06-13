interface EmptyStateProps {
  onCreateSession: () => void;
  hasSavedConfigs: boolean;
}

export function EmptyState({ onCreateSession, hasSavedConfigs }: EmptyStateProps) {
  return (
    <div className="no-session">
      {hasSavedConfigs ? (
        <p>Click a saved session to reconnect</p>
      ) : (
        <>
          <p>No active sessions</p>
          <button onClick={onCreateSession}>Create Session</button>
        </>
      )}
    </div>
  );
}
