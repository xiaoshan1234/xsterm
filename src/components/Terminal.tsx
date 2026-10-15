import { useTerminalSession } from "../hooks/useTerminalSession";
import TerminalView from "../lib/xterm/TerminalView";

export default function Terminal() {
  const { onTermReady } = useTerminalSession();
  return <TerminalView onTermReady={onTermReady} />;
}
