import { TmuxSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";

interface TmuxSessionFormProps {
  config: TmuxSessionConfig;
  onChange: (config: TmuxSessionConfig) => void;
}

export function TmuxSessionForm({ config, onChange }: TmuxSessionFormProps) {
  return (
    <div className="tmux-session-form">
      <FormField label="Command">
        <select
          value={config.command}
          onChange={(e) => onChange({ ...config, command: e.target.value })}
        >
          <option value="new-session">new-session</option>
          <option value="attach-session">attach-session</option>
        </select>
      </FormField>

      <FormField label={config.command === "attach-session" ? "Target session" : "Session name / target"}>
        <input
          type="text"
          value={config.target ?? ""}
          onChange={(e) => onChange({ ...config, target: e.target.value || undefined })}
          placeholder={config.command === "attach-session" ? "Session name to attach" : "Optional session name"}
        />
      </FormField>

      <FormField label="Socket name">
        <input
          type="text"
          value={config.socket ?? ""}
          onChange={(e) => onChange({ ...config, socket: e.target.value || undefined })}
          placeholder="Optional tmux socket (-L)"
        />
      </FormField>
    </div>
  );
}
