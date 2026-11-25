export { default as Terminal, type TerminalRef } from "./ui/Terminal";
export { TerminalPropertiesDialog } from "./ui/TerminalPropertiesDialog";
export { TmuxControllerErrorBanner } from "./ui/TmuxControllerErrorBanner";
export {
  appendTerminalOutput,
  clearTerminalOutput,
  getTerminalOutput,
  hasSessionOutput,
} from "./application/terminalOutputBuffer";
export {
  TerminalSurfacePortsProvider,
  useTerminalSurfacePorts,
  type TerminalSurfacePorts,
  type TerminalKeyActionId,
  type TerminalSurfaceTmuxError,
} from "./state/TerminalSurfacePortsContext";
export {
  TerminalViewportProvider,
  useTerminalViewport,
  type TerminalViewportController,
} from "./state/TerminalViewportContext";
