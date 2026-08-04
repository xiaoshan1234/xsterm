import { GlobalStyles as MuiGlobalStyles } from '@mui/material';

export function GlobalStyles() {
  return (
    <MuiGlobalStyles
      styles={{
        '.xsterm-titlebar': { WebkitAppRegion: 'drag' },
        '.xsterm-titlebar button, .xsterm-titlebar .non-drag': { WebkitAppRegion: 'no-drag' },
        '::-webkit-scrollbar': { width: 8, height: 8 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { background: 'rgba(128,128,128,0.3)', borderRadius: 4 },
        '::-webkit-scrollbar-thumb:hover': { background: 'rgba(128,128,128,0.5)' },
        'html, body, #root': { height: '100%', overflow: 'hidden', margin: 0 },
        // PaneTree rules (preserved for PaneTree.tsx UNTOUCHED)
        '.pane-tree-split': { display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, width: '100%', height: '100%' },
        '.pane-tree-split.pane-tree-split--horizontal': { flexDirection: 'row' },
        '.pane-tree-split.pane-tree-split--vertical': { flexDirection: 'column' },
        '.pane-tree-child': { position: 'relative', display: 'flex', flex: '1 1 auto', overflow: 'hidden', minWidth: 0, minHeight: 0 },
        '.pane-leaf': { width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'block' },
        '.pane-tree-resize-handle': { position: 'absolute', zIndex: 10, background: 'var(--border-color, #3a3a3a)', transition: 'background 0.15s' },
        '.pane-tree-resize-handle:hover': { background: 'var(--accent, #0e639c)' },
        '.pane-tree-resize-handle--horizontal': { top: 0, right: 0, bottom: 0, width: 3, cursor: 'col-resize', transform: 'translateX(50%)' },
        '.pane-tree-resize-handle--vertical': { left: 0, right: 0, bottom: 0, height: 3, cursor: 'row-resize', transform: 'translateY(50%)' },
      }}
    />
  );
}