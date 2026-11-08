import { useMemo, useState } from "react";
import { GlobalOverlayHost } from "./GlobalOverlayHost";
import { GlobalTextSender } from "./GlobalTextSender";
import { MainAreaPreview } from "./MainAreaPreview";
import { ManagerPreview } from "./ManagerPreview";
import { PreviewDialogs } from "./PreviewDialogs";
import { AppShell } from "./AppShell";
import { PreviewNavBar } from "./PreviewNavBar";
import { TOOL_TITLES, type PreviewDialogId, type ToolId } from "./types";

const WORKSPACES = ["Default", "Project X", "Infrastructure"];

const TEXT_SENDER_TARGETS = [
  {
    id: "raw:workspace-1:window-1:pane-1",
    label: "Local PowerShell",
    breadcrumb: "Default / Main / Pane 1",
    status: "Connected",
    isAvailable: true,
  },
  {
    id: "raw:workspace-1:window-1:pane-2",
    label: "Production SSH",
    breadcrumb: "Default / Main / Pane 2",
    status: "Connected",
    isAvailable: true,
  },
  {
    id: "tmux:3:@1:%2",
    label: "tmux dev · editor",
    breadcrumb: "Project X / tmux dev:@1 / %2",
    status: "Connected",
    isAvailable: true,
  },
];

export function AppShellPreview() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState("Default");
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState(TEXT_SENDER_TARGETS[0].id);
  const [textSenderDraft, setTextSenderDraft] = useState(
    "echo \"preview target\"\nprintf 'ready\\n'",
  );
  const [activeDialog, setActiveDialog] = useState<PreviewDialogId | null>(null);

  const toolPanelContent = useMemo(
    () =>
      activeTool ? <ManagerPreview activeTool={activeTool} onOpenDialog={setActiveDialog} /> : null,
    [activeTool],
  );

  return (
    <AppShell
      activeTool={activeTool}
      navBar={<PreviewNavBar />}
      toolTitle={activeTool ? TOOL_TITLES[activeTool] : ""}
      toolPanelContent={toolPanelContent}
      mainArea={<MainAreaPreview onOpenDialog={setActiveDialog} />}
      textSender={
        <GlobalTextSender
          targets={TEXT_SENDER_TARGETS}
          selectedTargetId={selectedTargetId}
          text={textSenderDraft}
          onSelectTarget={setSelectedTargetId}
          onTextChange={setTextSenderDraft}
          onSend={() => undefined}
        />
      }
      overlay={
        <GlobalOverlayHost>
          <PreviewDialogs activeDialog={activeDialog} onClose={() => setActiveDialog(null)} />
        </GlobalOverlayHost>
      }
      workspaceName={activeWorkspace}
      workspaces={WORKSPACES}
      isTextSenderOpen={isTextSenderOpen}
      isInteractionBlocked={activeDialog === "error"}
      onSelectTool={(tool) => setActiveTool((currentTool) => (currentTool === tool ? null : tool))}
      onSelectWorkspace={setActiveWorkspace}
      onToggleTextSender={() => setIsTextSenderOpen((current) => !current)}
    />
  );
}
