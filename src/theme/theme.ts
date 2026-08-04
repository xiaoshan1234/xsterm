import { createTheme, Theme } from '@mui/material/styles';

const SHARED_TYPOGRAPHY = {
  fontFamily: '"Segoe UI", "Noto Sans", sans-serif',
  fontSize: 13,
  h6: { fontSize: '1rem', fontWeight: 600 },
  h5: { fontSize: '1.15rem', fontWeight: 600 },
  h4: { fontSize: '1.4rem', fontWeight: 600 },
};

const SHARED_SHAPE = { borderRadius: 4 };
const SHARED_TRANSITIONS = {
  duration: { shortest: 100, shorter: 150, short: 200, standard: 250 },
};

export const darkTheme: Theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#0e639c', dark: '#0a4d7a', light: '#1177bb', contrastText: '#ffffff' },
    background: { default: '#1e1e1e', paper: '#252526' },
    text: { primary: '#ffffff', secondary: '#d4d4d4', disabled: '#808080' },
    error: { main: '#f14c4c' },
    divider: '#3a3a3a',
  },
  typography: SHARED_TYPOGRAPHY,
  shape: SHARED_SHAPE,
  transitions: SHARED_TRANSITIONS,
});

export const lightTheme: Theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1177bb', dark: '#0e639c', light: '#2596e6', contrastText: '#ffffff' },
    background: { default: '#fafafa', paper: '#ffffff' },
    text: { primary: '#1e1e1e', secondary: '#555555', disabled: '#808080' },
    error: { main: '#d32f2f' },
    divider: '#e0e0e0',
  },
  typography: SHARED_TYPOGRAPHY,
  shape: SHARED_SHAPE,
  transitions: SHARED_TRANSITIONS,
});