import "./SessionBootstrapScreen.css";

export function SessionBootstrapScreen({ error }: { error?: string }) {
  return (
    <main className="session-bootstrap" role={error ? "alert" : "status"} aria-live="polite">
      <div className={`session-bootstrap__panel${error ? " session-bootstrap__panel--error" : ""}`}>
        <div
          className={`session-bootstrap__mark${error ? " session-bootstrap__mark--error" : ""}`}
          aria-hidden="true"
        />
        <div>
          <h1>{error ? "Unable to load workspace" : "Loading workspace"}</h1>
          <p>{error ?? "Restoring terminal and workspace configuration."}</p>
        </div>
      </div>
    </main>
  );
}
