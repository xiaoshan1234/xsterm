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
      }}
    />
  );
}