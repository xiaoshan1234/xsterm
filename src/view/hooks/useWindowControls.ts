// L4 view 内 R1 例外口子:封装 @tauri-apps/api/window 的 getCurrentWindow。
// L4 view 内其他位置严禁 import @tauri-apps/api,只走本 hook。

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowControls = {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: boolean;
};

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useWindowControls(): WindowControls {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onResized(({ payload }) => {
        setIsMaximized(!!payload);
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        // 非 Tauri 上下文,忽略
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const minimize = (): void => {
    if (!isTauri()) return;
    void getCurrentWindow().minimize();
  };

  const toggleMaximize = (): void => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .isMaximized()
      .then((m) => {
        if (m) void getCurrentWindow().unmaximize();
        else void getCurrentWindow().maximize();
      });
  };

  const close = (): void => {
    if (!isTauri()) return;
    void getCurrentWindow().close();
  };

  return { minimize, toggleMaximize, close, isMaximized };
}
