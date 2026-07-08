# Project Agent Rules

## Build & Compile Restrictions

**You are forbidden from running any compile, build, or transpile command.** This includes but is not limited to:

- `make`, `cmake`, `ninja`, `cargo`, `rustc`
- `npm run build`, `yarn build`, `pnpm build`, `bun build`
- `npm run tauri build`, `yarn tauri build`, `pnpm tauri build`, `bun tauri build`, `cargo tauri build`, `npx tauri build`
- `vite build`, `npx vite build`, `tsc`, `tsc -b`, `tsc --build`
- `go build`, `go run`
- `cargo build`, `cargo run`
- `gcc`, `g++`, `clang`, `javac`
- `mvn compile`, `mvn package`, `gradle build`, `gradle assemble`
- `dotnet build`
- `docker build`
- `xcodebuild`

If the user asks you to compile or build the project, **do not execute the build command yourself**. Instead:
1. Suggest the exact command for the user to run manually, OR
2. Note that the project's CI pipeline handles builds.

This rule is enforced by the `permission.bash` config in `opencode.json` — the build commands above are set to `"deny"` and will be blocked even if you attempt them.
