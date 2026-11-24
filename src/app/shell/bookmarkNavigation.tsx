import { createContext, useContext } from "react";

export interface BookmarkNavigationValue {
  /** Absolute scrollback line of the currently focused bookmark, if any. */
  currentLine: number | undefined;
  /** Jump to a bookmark and mark it as the current one. */
  jumpTo: (line: number, text: string) => void;
}

const BookmarkNavigationContext = createContext<BookmarkNavigationValue | null>(null);

export const BookmarkNavigationProvider = BookmarkNavigationContext.Provider;

export function useBookmarkNavigation(): BookmarkNavigationValue {
  const value = useContext(BookmarkNavigationContext);
  if (!value) {
    throw new Error("BookmarkNavigationProvider is missing");
  }
  return value;
}
