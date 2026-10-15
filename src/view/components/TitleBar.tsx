import { useWindowControls } from "../hooks/useWindowControls";
import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from "./Icon";
import "./TitleBar.css";

export default function TitleBar() {
  const { minimize, toggleMaximize, close, isMaximized } = useWindowControls();

  return (
    <header className="titleBar">
      <div
        className="titleBarBrand"
        data-tauri-drag-region
        onDoubleClick={toggleMaximize}
        aria-label="Window title bar"
      >
        <svg
          className="titleBarLogo"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span className="titleBarName">xsterm</span>
      </div>
      <div className="titleBarDragRegion" data-tauri-drag-region onDoubleClick={toggleMaximize} />
      <div className="titleBarControls">
        <button className="titleBarButton" type="button" aria-label="Minimize" onClick={minimize}>
          <MinimizeIcon />
        </button>
        <button
          className="titleBarButton"
          type="button"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={toggleMaximize}
        >
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          className="titleBarButton titleBarButtonClose"
          type="button"
          aria-label="Close"
          onClick={close}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
