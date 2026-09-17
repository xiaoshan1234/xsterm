import AppLayout from "./ui/AppLayout";
import { SessionBridge } from "./service/bridges/sessionBridge";
import { OutputBridge } from "./service/bridges/outputBridge";
import { TmuxBridge } from "./service/bridges/tmuxBridge";
import { AutoAttachBridge } from "./service/bridges/autoAttachBridge";
import { ThemeBridge } from "./service/bridges/themeBridge";
import { LoggerBridge } from "./service/bridges/loggerBridge";
import "./styles/global.css";
import "./styles/layout.css";

export default function App() {
  return (
    <>
      <SessionBridge />
      <OutputBridge />
      <TmuxBridge />
      <AutoAttachBridge />
      <ThemeBridge />
      <LoggerBridge />
      <AppLayout />
    </>
  );
}
