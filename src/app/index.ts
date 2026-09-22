/**
 * src/app/index.ts — top-level barrel for the app layer.
 *
 * All use cases can be imported via this single entry point. Hooks in
 * `src/app/hooks/` (when added) and use cases in `src/app/useCases/`
 * are both exposed.
 */
export * from "./useCases/createLocalSession";
export * from "./useCases/createLocalSessionOnly";
export * from "./useCases/createSshSession";
export * from "./useCases/createSshSessionOnly";
export * from "./useCases/createTmuxSession";
export * from "./useCases/createTmuxSessionOnly";
export * from "./useCases/openSavedSession";
export * from "./useCases/closeSession";
export * from "./useCases/reconnectSession";
export * from "./useCases/renameSession";
export * from "./useCases/applyDisplayConfigToLiveSession";

export * from "./useCases/createWindow";
export * from "./useCases/replaceInitWindowWithSession";
export * from "./useCases/closeWindow";
export * from "./useCases/reorderWindows";
export * from "./useCases/renameWindow";
export * from "./useCases/setActiveWindow";
export * from "./useCases/setActivePane";
export * from "./useCases/splitPane";

export * from "./useCases/createWorkspace";
export * from "./useCases/closeWorkspace";

export * from "./useCases/saveWorkspace";
export * from "./useCases/loadWorkspace";
export * from "./useCases/deleteSavedWorkspace";
export * from "./useCases/renameSavedWorkspace";
export * from "./useCases/saveWindow";
export * from "./useCases/loadWindow";
export * from "./useCases/deleteSavedWindow";
export * from "./useCases/saveConfigOnly";
export * from "./useCases/removeConfig";

export * from "./useCases/createGroup";
export * from "./useCases/deleteGroup";
export * from "./useCases/moveConfigToGroup";

export * from "./useCases/createTmuxWindow";

export * from "./useCases/closePane";
