import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_SENDER_RATES,
  MAX_SENDER_RATE,
  MIN_SENDER_RATE,
  createTextSenderTab,
  getSenderUnitLabel,
  normalizeSenderRate,
  splitTextForSender,
  useTextSenderRun,
  type TextSenderMode,
  type TextSenderTab,
} from "../../features/command-sender";
import { CloseIcon, PlusIcon } from "../../shared/icons/Icon";
import "./GlobalTextSender.css";

interface TextSenderTarget {
  id: string;
  label: string;
  breadcrumb: string;
  status: string;
  isAvailable: boolean;
}

interface GlobalTextSenderProps {
  targets: readonly TextSenderTarget[];
  selectedTargetId: string;
  onSelectTarget: (targetId: string) => void;
  onSend: (text: string) => Promise<void>;
}

export function GlobalTextSender({
  targets,
  selectedTargetId,
  onSelectTarget,
  onSend,
}: GlobalTextSenderProps) {
  const [tabs, setTabs] = useState<TextSenderTab[]>(() => [createTextSenderTab(1)]);
  const [activeTabId, setActiveTabId] = useState("sender-tab-1");
  const [mode, setMode] = useState<TextSenderMode>("line");
  const [rates, setRates] = useState<Record<TextSenderMode, number>>(DEFAULT_SENDER_RATES);
  const [runningTab, setRunningTab] = useState<{ id: string; title: string } | null>(null);
  const nextTabNumberRef = useRef(2);
  const run = useTextSenderRun(onSend);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const chunks = useMemo(() => splitTextForSender(activeTab.text, mode), [activeTab.text, mode]);
  const isRunning = run.status === "sending" || run.status === "paused";
  const canSend = selectedTarget?.isAvailable === true && chunks.length > 0 && !isRunning;
  const unitLabel = getSenderUnitLabel(mode, isRunning ? run.totalUnits : chunks.length);
  const rateLabel = mode === "line" ? "lines/s" : "chars/s";
  const progressValue = run.totalUnits > 0 ? Math.round((run.sentUnits / run.totalUnits) * 100) : 0;

  const handleAddTab = () => {
    if (isRunning) return;
    const tabNumber = nextTabNumberRef.current;
    nextTabNumberRef.current += 1;
    const tab = createTextSenderTab(tabNumber);
    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
    run.resetFeedback();
  };

  const handleCloseTab = (tabId: string) => {
    if (isRunning || tabs.length === 1) return;
    const closedIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closedIndex < 0) return;

    const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(remainingTabs);
    if (activeTabId === tabId) {
      setActiveTabId(remainingTabs[Math.min(closedIndex, remainingTabs.length - 1)].id);
    }
    run.resetFeedback();
  };

  const handleTextChange = (text: string) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === activeTab.id ? { ...tab, text } : tab)),
    );
    run.resetFeedback();
  };

  const handleModeChange = (nextMode: TextSenderMode) => {
    if (isRunning) return;
    setMode(nextMode);
    run.resetFeedback();
  };

  const handleRateChange = (rate: number) => {
    if (isRunning) return;
    setRates((currentRates) => ({ ...currentRates, [mode]: normalizeSenderRate(rate) }));
    run.resetFeedback();
  };

  const handleSend = () => {
    if (!canSend) return;
    setRunningTab({ id: activeTab.id, title: activeTab.title });
    run.start(chunks, rates[mode]);
  };

  const statusText = getStatusText({
    status: run.status,
    sentUnits: run.sentUnits,
    totalUnits: run.totalUnits,
    readyUnits: chunks.length,
    unitLabel,
    runningTabTitle: runningTab?.title ?? "Sender",
    errorMessage: run.errorMessage,
  });

  return (
    <section className="shell-text-sender" aria-label="Global text sender">
      <header className="shell-text-sender-header">
        <div className="shell-text-sender-target">
          <select
            id="shell-target-select"
            aria-label="Target pane"
            value={selectedTargetId}
            onChange={(event) => {
              onSelectTarget(event.target.value);
              run.resetFeedback();
            }}
            disabled={targets.length === 0 || isRunning}
          >
            {targets.length === 0 && <option value="">No available pane</option>}
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label} — {target.breadcrumb}
                {target.isAvailable ? "" : " (unavailable)"}
              </option>
            ))}
          </select>
          <span className="shell-text-sender-target-meta">
            {selectedTarget
              ? `${selectedTarget.status} · ${selectedTarget.breadcrumb}`
              : "Select a connected terminal to send input"}
          </span>
        </div>
        <div className="shell-text-sender-segmented" role="group" aria-label="Send mode">
          <button
            type="button"
            className={mode === "line" ? "shell-text-sender-segment--active" : ""}
            aria-pressed={mode === "line"}
            disabled={isRunning}
            onClick={() => handleModeChange("line")}
          >
            Line
          </button>
          <button
            type="button"
            className={mode === "character" ? "shell-text-sender-segment--active" : ""}
            aria-pressed={mode === "character"}
            disabled={isRunning}
            onClick={() => handleModeChange("character")}
          >
            Character
          </button>
        </div>

        <label className="shell-text-sender-rate">
          <span className="shell-text-sender-rate-input">
            <input
              type="number"
              min={MIN_SENDER_RATE}
              max={MAX_SENDER_RATE}
              step={1}
              value={rates[mode]}
              aria-label={`${mode === "line" ? "Lines" : "Characters"} per second`}
              disabled={isRunning}
              onChange={(event) => handleRateChange(Number(event.target.value))}
            />
            <span>{rateLabel}</span>
          </span>
        </label>

        <div
          className={`shell-text-sender-status shell-text-sender-status--${run.status}`}
          role="status"
          aria-live="polite"
          title={statusText}
        >
          {statusText}
        </div>

        <div className="shell-text-sender-actions">
          <button
            type="button"
            className="btn btn--secondary shell-text-sender-action"
            disabled={!isRunning}
            onClick={run.status === "paused" ? run.resume : run.pause}
          >
            {run.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="btn btn--secondary shell-text-sender-action shell-text-sender-action--cancel"
            disabled={!isRunning}
            onClick={run.cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary shell-text-sender-action"
            disabled={!canSend}
            onClick={handleSend}
          >
            Send
          </button>
        </div>
      </header>

      <div className="shell-text-sender-tabs-row">
        <div className="shell-text-sender-tabs" role="tablist" aria-label="Sender input tabs">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab.id;
            return (
              <div
                key={tab.id}
                className={`shell-text-sender-tab ${
                  isActive ? "shell-text-sender-tab--active" : ""
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  id={`shell-sender-tab-${tab.id}`}
                  className="shell-text-sender-tab-button"
                  aria-selected={isActive}
                  aria-controls={`shell-sender-editor-${tab.id}`}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    run.resetFeedback();
                  }}
                >
                  {tab.title}
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    className="shell-text-sender-tab-close"
                    aria-label={`Close ${tab.title}`}
                    title={`Close ${tab.title}`}
                    disabled={isRunning}
                    onClick={() => handleCloseTab(tab.id)}
                  >
                    <CloseIcon size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="shell-text-sender-add-tab"
          aria-label="Add sender tab"
          title="Add tab"
          disabled={isRunning}
          onClick={handleAddTab}
        >
          <PlusIcon size={13} />
        </button>
      </div>

      <div
        id={`shell-sender-editor-${activeTab.id}`}
        className="shell-text-sender-editor"
        role="tabpanel"
        aria-labelledby={`shell-sender-tab-${activeTab.id}`}
      >
        <textarea
          aria-label="Sender input"
          value={activeTab.text}
          onChange={(event) => handleTextChange(event.target.value)}
          spellCheck={false}
          placeholder="Enter text to send…"
          disabled={isRunning && activeTab.id === runningTab?.id}
        />
      </div>

      <div
        className={`shell-text-sender-progress ${
          isRunning ? "shell-text-sender-progress--active" : ""
        }`}
        role="progressbar"
        aria-label="Send progress"
        aria-valuemin={0}
        aria-valuemax={Math.max(run.totalUnits, 1)}
        aria-valuenow={run.sentUnits}
      >
        <span style={{ width: `${progressValue}%` }} />
      </div>
    </section>
  );
}

interface StatusTextParams {
  status: ReturnType<typeof useTextSenderRun>["status"];
  sentUnits: number;
  totalUnits: number;
  readyUnits: number;
  unitLabel: string;
  runningTabTitle: string;
  errorMessage: string | null;
}

function getStatusText({
  status,
  sentUnits,
  totalUnits,
  readyUnits,
  unitLabel,
  runningTabTitle,
  errorMessage,
}: StatusTextParams): string {
  switch (status) {
    case "sending":
      return `${runningTabTitle}: sending ${sentUnits}/${totalUnits} ${unitLabel}`;
    case "paused":
      return `${runningTabTitle}: paused at breakpoint ${sentUnits}/${totalUnits}`;
    case "completed":
      return `Completed ${totalUnits} ${unitLabel}`;
    case "cancelled":
      return `Cancelled at ${sentUnits}/${totalUnits} ${unitLabel}`;
    case "error":
      return errorMessage ? `Send failed: ${errorMessage}` : "Send failed";
    default:
      return `${readyUnits} ${unitLabel} ready`;
  }
}
