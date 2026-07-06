export interface IconProps {
  size?: number;
  className?: string;
}

function icon(viewBox: string, path: React.ReactNode) {
  return function Icon({ size = 20, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        {path}
      </svg>
    );
  };
}

export const LocalSessionIcon = icon("0 0 24 24", (
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </>
));

export const SshSessionIcon = icon("0 0 24 24", (
  <>
    <rect x="2" y="2" width="20" height="20" rx="2" />
    <path d="M16 12h-8" />
    <path d="M13 9l3 3-3 3" />
  </>
));

export const TmuxSessionIcon = icon("0 0 24 24", (
  <>
    <rect x="2" y="2" width="20" height="20" rx="2" />
    <path d="M17 12H7" />
    <path d="M14 9l3 3-3 3" />
    <path d="M10 15l-3-3 3-3" />
  </>
));

export const SshTmuxSessionIcon = icon("0 0 24 24", (
  <>
    <rect x="2" y="2" width="9" height="9" rx="1" ry="1" />
    <rect x="13" y="2" width="9" height="9" rx="1" ry="1" />
    <rect x="2" y="13" width="9" height="9" rx="1" ry="1" />
    <rect x="13" y="13" width="9" height="9" rx="1" ry="1" />
    <line x1="11" y1="5.5" x2="13" y2="5.5" />
    <line x1="11" y1="16.5" x2="13" y2="16.5" />
    <line x1="5.5" y1="11" x2="5.5" y2="13" />
    <line x1="16.5" y1="11" x2="16.5" y2="13" />
  </>
));

export const ChatIcon = icon("0 0 24 24", (
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
));

export const SettingsIcon = icon("0 0 24 24", (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
));

export const LogIcon = icon("0 0 24 24", (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </>
));

export const LayoutIcon = icon("0 0 24 24", (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" ry="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" ry="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" ry="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" ry="1" />
  </>
));

export const WorkspaceIcon = icon("0 0 24 24", (
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </>
));

export const FolderIcon = icon("0 0 24 24", (
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
));

export const PlusIcon = icon("0 0 24 24", (
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>
));

export const FolderOpenIcon = icon("0 0 24 24", (
  <>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <polyline points="22 10 22 17" />
  </>
));

export const CloseIcon = icon("0 0 24 24", (
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>
));

export const MinimizeIcon = icon("0 0 24 24", <line x1="5" y1="12" x2="19" y2="12" />);

export const MaximizeIcon = icon("0 0 24 24", <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />);

export const RestoreIcon = icon("0 0 24 24", (
  <>
    <rect x="5" y="9" width="14" height="10" rx="2" ry="2" />
    <path d="M8 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
  </>
));

export const ChevronIcon = icon("0 0 24 24", (
  <polyline points="9 18 15 12 9 6" />
));

export const SaveIcon = icon("0 0 24 24", (
  <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </>
));

export const WindowIcon = icon("0 0 24 24", (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </>
));
