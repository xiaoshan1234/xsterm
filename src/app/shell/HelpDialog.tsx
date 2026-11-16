import { openUrl } from "@tauri-apps/plugin-opener";
import packageInfo from "../../../package.json";
import { Dialog } from "../../shared/ui/Dialog";

export type HelpDialogId = "version" | "update" | "license";

interface HelpDialogProps {
  activeDialog: HelpDialogId | null;
  onClose: () => void;
}

const RELEASES_URL = "https://github.com/xiaoshan1234/xsterm/releases";

const XSCORE_LICENSE = `MIT License

Copyright (c) 2026 xscore contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function HelpDialog({ activeDialog, onClose }: HelpDialogProps) {
  const title =
    activeDialog === "version"
      ? "Version"
      : activeDialog === "update"
        ? "Update"
        : activeDialog === "license"
          ? "License"
          : "";

  return (
    <Dialog
      isOpen={activeDialog !== null}
      onClose={onClose}
      title={title}
      size={activeDialog === "license" ? "medium" : "small"}
      footer={
        <div className="dialog-footer-buttons">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Close
          </button>
          {activeDialog === "update" && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void openUrl(RELEASES_URL);
              }}
            >
              Open Releases
            </button>
          )}
        </div>
      }
    >
      {activeDialog === "version" && (
        <div className="shell-help-summary">
          <strong>XSTerm</strong>
          <span>Version {packageInfo.version}</span>
          <p className="shell-dialog-copy">
            A terminal workspace for local shells, SSH, and tmux control mode.
          </p>
        </div>
      )}
      {activeDialog === "update" && (
        <div className="shell-help-summary">
          <span>Current version: {packageInfo.version}</span>
          <p className="shell-dialog-copy">
            Open the GitHub Releases page to check for and download a newer version.
          </p>
        </div>
      )}
      {activeDialog === "license" && (
        <div className="shell-help-summary">
          <p className="shell-dialog-copy">
            xsterm bundles xscore as its terminal backend. xscore is distributed under the following
            MIT license.
          </p>
          <pre className="shell-help-license">{XSCORE_LICENSE}</pre>
        </div>
      )}
    </Dialog>
  );
}
