import { useState, useEffect } from "react";
import { AppBar, Toolbar, IconButton, Box } from "@mui/material";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from "./icons";
import logo from "../assets/logo.svg";

export default function NavBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const updateState = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
      } catch {
        // ignore when running outside Tauri
      }
    };
    updateState();

    let unlisten: (() => void) | undefined;
    appWindow
      .onResized(() => updateState())
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // ignore when running outside Tauri
      });

    return () => {
      unlisten?.();
    };
  }, [appWindow]);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => {
    if (isMaximized) {
      appWindow.unmaximize();
    } else {
      appWindow.maximize();
    }
  };
  const handleClose = () => appWindow.close();

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Toolbar
        variant="dense"
        className="xsterm-titlebar"
        sx={{
          minHeight: 28,
          height: 28,
          display: "flex",
          justifyContent: "space-between",
          px: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <img src={logo} alt="xsterm" style={{ height: 16 }} />
        </Box>
        <Box sx={{ display: "flex" }}>
          <IconButton
            size="small"
            className="non-drag"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <MinimizeIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            className="non-drag"
            onClick={handleMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <RestoreIcon fontSize="small" />
            ) : (
              <MaximizeIcon fontSize="small" />
            )}
          </IconButton>
          <IconButton
            size="small"
            className="non-drag"
            onClick={handleClose}
            aria-label="Close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
