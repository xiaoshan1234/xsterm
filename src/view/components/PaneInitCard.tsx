import { SHELL_KINDS, SHELL_LABEL, type ShellKind } from "../../data/model/shell";
import "./PaneInitCard.css";

interface PaneInitCardProps {
  shell: ShellKind;
  onCreate: () => void;
}

export default function PaneInitCard({ shell, onCreate }: PaneInitCardProps) {
  // SHELL_KINDS 当前 4 个 shell,M2 只启用 powershell / bash(其他等 M5 接入)。
  // 这里用 SHELL_KINDS.includes 是为了给 M5 留扩展点,本次只显示当前 shell。
  void SHELL_KINDS;
  const label = SHELL_LABEL[shell];

  return (
    <div className="paneInitCard">
      <h1 className="paneInitTitle">xsterm</h1>
      <p className="paneInitSubtitle">Create a new session</p>
      <button className="paneInitButton" type="button" onClick={onCreate}>
        New {label} session
      </button>
    </div>
  );
}
