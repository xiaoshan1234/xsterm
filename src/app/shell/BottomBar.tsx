import { type RuntimeStatusViewData } from "./runtimeStatusViewModel";

interface BottomBarProps {
  runtimeStatus: RuntimeStatusViewData | null;
}

export function BottomBar({ runtimeStatus }: BottomBarProps) {
  return (
    <footer className="shell-bottom-bar">
      <div
        className="shell-bottom-runtime"
        role="status"
        aria-live="polite"
        aria-label={
          runtimeStatus
            ? `${runtimeStatus.name}, ${runtimeStatus.kind}, ${runtimeStatus.detail ?? ""}, ${
                runtimeStatus.size
                  ? `${runtimeStatus.size.cols} by ${runtimeStatus.size.rows}`
                  : "size unavailable"
              }${
                runtimeStatus.paneNumber !== undefined
                  ? `, Pane ${runtimeStatus.paneNumber} of ${runtimeStatus.paneCount}`
                  : ""
              }`
            : "No active pane"
        }
      >
        <span
          className={`shell-bottom-runtime-status ${
            runtimeStatus
              ? `shell-bottom-runtime-status--${runtimeStatus.status}`
              : "shell-bottom-runtime-status--empty"
          }`}
          aria-hidden="true"
        />
        <span className="shell-bottom-runtime-name">{runtimeStatus?.name ?? "No active pane"}</span>
        {runtimeStatus && (
          <>
            <span className="shell-bottom-runtime-divider" aria-hidden="true" />
            <span className="shell-bottom-runtime-kind">{runtimeStatus.kind}</span>
            {runtimeStatus.detail && (
              <>
                <span className="shell-bottom-runtime-divider" aria-hidden="true" />
                <span className="shell-bottom-runtime-detail">{runtimeStatus.detail}</span>
              </>
            )}
            <span className="shell-bottom-runtime-divider" aria-hidden="true" />
            <span className="shell-bottom-runtime-size">
              {runtimeStatus.size
                ? `${runtimeStatus.size.cols}×${runtimeStatus.size.rows}`
                : "size unavailable"}
            </span>
            {runtimeStatus.paneNumber !== undefined && (
              <span className="shell-bottom-runtime-count">
                Pane {runtimeStatus.paneNumber}/{runtimeStatus.paneCount}
              </span>
            )}
          </>
        )}
      </div>
    </footer>
  );
}
