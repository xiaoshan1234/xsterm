import "./ApplicationBootstrapScreen.css";

export function ApplicationBootstrapScreen({ error }: { error?: string }) {
  return (
    <main className="application-bootstrap" role={error ? "alert" : "status"} aria-live="polite">
      <div
        className={`application-bootstrap__panel${error ? " application-bootstrap__panel--error" : ""}`}
      >
        <div
          className={`application-bootstrap__mark${error ? " application-bootstrap__mark--error" : ""}`}
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
