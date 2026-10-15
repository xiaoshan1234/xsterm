// window control icons。SVG paths 来自 ref/xsterm/src/ui/icons/Icon.tsx。
// 大小用 size prop 调,默认 14px 适配 28px TitleBar,sidebar 等地方可传 20。

import type { ReactElement } from "react";

export interface IconProps {
  size?: number;
  className?: string;
}

function makeIcon(viewBox: string, path: ReactElement) {
  return function Icon({ size = 14, className }: IconProps) {
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
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const MinimizeIcon = makeIcon("0 0 24 24", <line x1="5" y1="12" x2="19" y2="12" />);

export const MaximizeIcon = makeIcon(
  "0 0 24 24",
  <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />,
);

export const RestoreIcon = makeIcon(
  "0 0 24 24",
  <>
    <rect x="5" y="9" width="14" height="10" rx="2" ry="2" />
    <path d="M8 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
  </>,
);

export const CloseIcon = makeIcon(
  "0 0 24 24",
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
);
