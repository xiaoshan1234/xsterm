/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-ui-to-infra",
      severity: "error",
      comment: "UI cannot import infra directly (documented escape hatches: Terminal.tsx, NavBar.tsx)",
      from: { path: "^src/ui", pathNot: ["src/ui/Terminal\\.tsx", "src/ui/NavBar\\.tsx"] },
      to: { path: "^src/infra" },
    },
    {
      name: "no-app-to-ui",
      severity: "error",
      comment: "App layer must not depend on UI",
      from: { path: "^src/app" },
      to: { path: "^src/ui" },
    },
    {
      name: "no-service-to-ui",
      severity: "error",
      comment: "Service layer must not depend on UI",
      from: { path: "^src/service" },
      to: { path: "^src/ui" },
    },
    {
      name: "no-service-legacy-to-app",
      severity: "ignore",
      comment: "Legacy shim: service-legacy intentionally imports from app/useCases (documented escape hatch)",
      from: { path: "^src/service/legacy" },
      to: { path: "^src/app" },
    },
    {
      name: "no-infra-to-ui-app-service",
      severity: "error",
      comment: "Infra must not depend on upper layers",
      from: { path: "^src/infra" },
      to: { path: "^(src/(ui|app|service))" },
    },
    {
      name: "no-model-to-anything-but-itself",
      severity: "error",
      comment: "Model is pure — no imports from other layers",
      from: { path: "^src/model" },
      to: { path: "^src/(?!model)" },
    },
    {
      name: "no-tauri-apps-outside-infra",
      severity: "error",
      comment: "@tauri-apps/* only in infra (legacy shim exception via depcruise-disable)",
      from: { path: "^(src/(ui|app|model))" },
      to: { path: "^node_modules/@tauri-apps" },
    },
    {
      name: "no-tauri-apps-in-service-legacy",
      severity: "ignore",
      comment: "Legacy shim: service-legacy intentionally uses tauri-apps before infra layer existed",
      from: { path: "^src/service/legacy" },
      to: { path: "^node_modules/@tauri-apps" },
    },
    {
      name: "no-react-outside-ui",
      severity: "warn",
      comment: "React should only be used in ui/",
      from: { path: "^(src/(model|infra|app))" },
      to: { path: "^node_modules/react" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
