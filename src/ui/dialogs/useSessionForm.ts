import { useState, useEffect, useRef } from "react";
import type { LocalSessionConfig, SSHSessionConfig, SessionDisplayConfig } from "../../model";
import { type SectionId } from "./sessionDialogItems";

export interface SessionFormHookOptions {
  isOpen: boolean;
  /** When provided, the form resets when this value changes too — used by
   * the Edit dialog so swapping to a different saved config while the
   * dialog is open snaps the form to the new config's values. */
  initialConfigId?: string;
  initialName: string;
  initialGroupId: number;
  initialLocalConfig: LocalSessionConfig;
  initialSshConfig: SSHSessionConfig;
  initialDisplayConfig?: SessionDisplayConfig;
}

export interface SessionFormState {
  name: string;
  setName: (v: string) => void;
  selectedGroupId: number;
  setSelectedGroupId: (v: number) => void;
  localConfig: LocalSessionConfig;
  setLocalConfig: (v: LocalSessionConfig) => void;
  sshConfig: SSHSessionConfig;
  setSshConfig: (v: SSHSessionConfig) => void;
  displayConfig?: SessionDisplayConfig;
  setDisplayConfig: (v: SessionDisplayConfig | undefined) => void;
  sectionId: SectionId;
  setSectionId: (v: SectionId) => void;
  error: string;
  setError: (v: string) => void;
}

export function useSessionForm(opts: SessionFormHookOptions): SessionFormState {
  const [name, setName] = useState(opts.initialName);
  const [selectedGroupId, setSelectedGroupId] = useState(opts.initialGroupId);
  const [localConfig, setLocalConfig] = useState(opts.initialLocalConfig);
  const [sshConfig, setSshConfig] = useState(opts.initialSshConfig);
  const [displayConfig, setDisplayConfig] = useState(opts.initialDisplayConfig);
  const [sectionId, setSectionId] = useState<SectionId>("session");
  const [error, setError] = useState("");

  const initialRef = useRef({
    name: opts.initialName,
    groupId: opts.initialGroupId,
    localConfig: opts.initialLocalConfig,
    sshConfig: opts.initialSshConfig,
    displayConfig: opts.initialDisplayConfig,
  });
  initialRef.current.name = opts.initialName;
  initialRef.current.groupId = opts.initialGroupId;
  initialRef.current.localConfig = opts.initialLocalConfig;
  initialRef.current.sshConfig = opts.initialSshConfig;
  initialRef.current.displayConfig = opts.initialDisplayConfig;

  useEffect(() => {
    if (opts.isOpen) {
      const i = initialRef.current;
      setName(i.name);
      setSelectedGroupId(i.groupId);
      setLocalConfig(i.localConfig);
      setSshConfig(i.sshConfig);
      setDisplayConfig(i.displayConfig);
      setSectionId("session");
      setError("");
    }
    // Reset fires only on isOpen / initialConfigId transitions. The latest
    // initial* values are read via initialRef so a parent that passes new
    // object literals on every render (e.g. `{...config.config}`) does not
    // wipe in-flight edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.isOpen, opts.initialConfigId]);

  return {
    name,
    setName,
    selectedGroupId,
    setSelectedGroupId,
    localConfig,
    setLocalConfig,
    sshConfig,
    setSshConfig,
    displayConfig,
    setDisplayConfig,
    sectionId,
    setSectionId,
    error,
    setError,
  };
}
