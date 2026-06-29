# Task Plan: Refactor tmux Code for Readability and Layering

## Goal
Refactor the existing tmux control mode integration (Rust backend + TypeScript frontend) to improve readability, add necessary comments, and enforce clearer code layering without changing external behavior.

## Current Phase
Phase 2

## Phases

### Phase 1: Requirements & Discovery
- [x] Inventory all tmux-related source files
- [x] Read current Rust backend tmux module (`src-tauri/src/tmux/`)
- [x] Read current frontend tmux service, reducer, and types
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define target module layering for Rust tmux code
- [x] Define target module layering for TypeScript tmux code
- [x] Identify files to split/refactor and files to only annotate
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Refactor Rust backend tmux module for clarity and layering
- [x] Refactor TypeScript tmux types/state/service for clarity
- [x] Add necessary comments throughout
- [x] Run `cargo check` / `cargo test` after Rust changes
- [x] Run `npm run build` after TypeScript changes
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Verify all Rust tests pass
- [x] Verify frontend build passes
- [x] Verify no functional regressions via static checks
- [x] Document test results in progress.md
- **Status:** complete

### Phase 5: Delivery
- [ ] Review all changed files
- [ ] Summarize refactor scope and file layout
- [ ] Deliver to user
- **Status:** pending

## Key Questions
1. Should we keep behavior 100% unchanged during this refactor? (Yes - pure cleanup/layering pass)
2. Which layer boundaries make sense for tmux? (Protocol/Transport/State/Event; Types/Service/State/UI)
3. Are there existing tests that lock behavior? (Yes - parser/commands/state tests; integration test in session.rs)

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Keep behavior identical | User asked for readability/layering, not feature changes |
| Split large files by responsibility | Improves navigation and single-responsibility |
| Add module/file-level comments first | Highest ROI for readability |
| Preserve all existing tests | Acts as regression safety net |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |

## Notes
- Rust tmux module currently has 8 files but parser/handlers/session are doing multiple things.
- Frontend `tmuxStateReducer.ts` is one large switch; splitting into per-event handlers improves readability.
- `types/session.ts` mixes tmux types with generic session types; extracting tmux types improves layering.
