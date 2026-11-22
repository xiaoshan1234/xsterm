import { type ShellStatusViewData } from "../application/shellModel/shellStatusViewModel";

interface BottomBarProps {
  runtimeStatus: ShellStatusViewData | null;
  bookmarkCount: number;
  bookmarkIndex: number;
  onPrevBookmark: () => void;
  onNextBookmark: () => void;
}

export function BottomBar({
  runtimeStatus,
  bookmarkCount,
  bookmarkIndex,
  onPrevBookmark,
  onNextBookmark,
}: BottomBarProps) {
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
      <div className="shell-bottom-bookmarks" aria-label="Bookmarks">
        <button
          type="button"
          className="shell-bottom-bookmark-button"
          onClick={onPrevBookmark}
          disabled={bookmarkCount === 0}
          aria-label="Previous bookmark"
          title="Previous bookmark"
        >
          ◀
        </button>
        <span className="shell-bottom-bookmark-count">
          {bookmarkCount === 0 ? "0/0" : `${bookmarkIndex}/${bookmarkCount}`}
        </span>
        <button
          type="button"
          className="shell-bottom-bookmark-button"
          onClick={onNextBookmark}
          disabled={bookmarkCount === 0}
          aria-label="Next bookmark"
          title="Next bookmark"
        >
          ▶
        </button>
      </div>
    </footer>
  );
}
