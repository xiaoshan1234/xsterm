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
    label: "Tmux dev · editor",
    breadcrumb: "Project X / Tmux dev:@1 / %2",
    status: "Connected",
    isAvailable: true,
  },
];

export function AppShellPreview() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState("Default");
  const [workspaces, setWorkspaces] = useState<string[]>([...WORKSPACES]);
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState(TEXT_SENDER_TARGETS[0].id);
  const [activeDialog, setActiveDialog] = useState<PreviewDialogId | null>(null);

  const toolPanelContent = useMemo(
    () =>
      activeTool ? <ManagerPreview activeTool={activeTool} onOpenDialog={setActiveDialog} /> : null,
    [activeTool],
  );

  const handleCloseWorkspace = (workspaceName: string) => {
    if (workspaceName.toLowerCase() === "default") return;

    const remainingWorkspaces = workspaces.filter((workspace) => workspace !== workspaceName);
    setWorkspaces(remainingWorkspaces);
    if (activeWorkspace === workspaceName) {
      setActiveWorkspace(remainingWorkspaces[0] ?? "Default");
    }
  };

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
          onSelectTarget={setSelectedTargetId}
          onSend={async () => undefined}
        />
      }
      overlay={
        <GlobalOverlayHost>
          <PreviewDialogs activeDialog={activeDialog} onClose={() => setActiveDialog(null)} />
        </GlobalOverlayHost>
      }
      workspaceName={activeWorkspace}
      workspaces={workspaces}
      isTextSenderOpen={isTextSenderOpen}
      isInteractionBlocked={activeDialog === "error"}
      onSelectTool={(tool) => setActiveTool((currentTool) => (currentTool === tool ? null : tool))}
      onSelectWorkspace={setActiveWorkspace}
      onCloseWorkspace={handleCloseWorkspace}
      onToggleTextSender={() => setIsTextSenderOpen((current) => !current)}
    />
  );
}
