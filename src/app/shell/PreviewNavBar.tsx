import { CloseIcon, MaximizeIcon, MinimizeIcon } from "../../shared/icons/Icon";

export function PreviewNavBar() {
  return (
    <header className="shell-preview-navbar" data-tauri-drag-region>
      <div className="shell-preview-brand">
        <span className="shell-preview-brand-mark">X</span>
        <span>XSTerm</span>
      </div>
      <nav className="shell-preview-menu" aria-label="Application menu">
        {["File", "Edit", "View", "Terminal", "Help"].map((item) => (
          <button key={item} type="button">
            {item}
          </button>
        ))}
      </nav>
      <div className="shell-preview-drag-region" data-tauri-drag-region />
      <div className="shell-preview-window-controls" aria-label="Window controls preview">
        <button type="button" aria-label="Minimize">
          <MinimizeIcon size={13} />
        </button>
        <button type="button" aria-label="Maximize">
          <MaximizeIcon size={13} />
        </button>
        <button type="button" aria-label="Close">
          <CloseIcon size={13} />
        </button>
      </div>
    </header>
  );
}
