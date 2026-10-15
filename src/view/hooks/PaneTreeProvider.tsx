import { usePaneTree } from "./usePaneTree";
import { PaneTreeProvider } from "./paneTreeContext";

export function PaneTreeProviderWithHook({ children }: { children: React.ReactNode }) {
  const tree = usePaneTree();
  return <PaneTreeProvider value={tree}>{children}</PaneTreeProvider>;
}
