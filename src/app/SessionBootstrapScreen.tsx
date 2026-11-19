import "./SessionBootstrapScreen.css";

export function SessionBootstrapScreen() {
  return (
    <main className="session-bootstrap" role="status" aria-live="polite">
      <div className="session-bootstrap__panel">
        <div className="session-bootstrap__mark" aria-hidden="true" />
        <div>
          <h1>Loading workspace</h1>
          <p>Restoring terminal and workspace configuration.</p>
        </div>
      </div>
    </main>
  );
}
