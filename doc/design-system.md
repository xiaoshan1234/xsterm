# Design System

> **Standing rule for this project.** Every component, dialog, panel, and chrome surface must follow this design system. If a future task introduces UI work, it must consult this document first and apply its tokens and patterns verbatim. No ad-hoc styles.

xsterm's shell UI follows an **adapted Cursor design language** — Cursor's *discipline* (typography, spacing, radius, hairline-only depth, magazine voice) applied to a **dark IDE context** (the project is a terminal emulator; users expect dark chrome).

The marketing-side spec lives at [`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/cursor/DESIGN.md). This document is the **authoritative project adaptation** — it is what you implement, not the marketing spec.

---

## 1. Design Philosophy

| Principle | Rule |
|---|---|
| **Display voice** | Weight **400** on display, **500** on titles/labels. **Never** 600+ on UI chrome. Magazine voice, not tech-bombastic. |
| **Mono discipline** | UI text uses `--font-ui` (Inter / system sans). **Only** code/terminal surfaces use `--font-mono` (JetBrains Mono). The UI is **not** entirely monospaced. |
| **Accent scarcity** | Cursor Orange (`--accent: #f54e00`) is used **only** on: primary CTAs, focused input borders, active tab underlines, focus rings, selection halos. **Never** on body text or default borders. |
| **Hairline-only depth** | Components separate via 1px `var(--hairline*)` borders. **No** `box-shadow` on cards / sections / inputs. Only floating overlays (Dialog, ContextMenu, popovers) may carry a subtle shadow. |
| **Two radii** | Buttons / inputs → `var(--radius-md)` (8px). Cards / dialogs → `var(--radius-lg)` (12px). Tags / badges → `var(--radius-pill)`. **Never** 4px or 6px on cards. |
| **No gradients** | No `linear-gradient`, no `text-shadow` glow. Flat surfaces only. |
| **Token-first** | Every color, spacing value, radius, and font reference must come from the `:root` tokens. **No** hex literals in component CSS (one documented exception: the SVG data-URI chevron in the global select — see §10). |

---

## 2. Token Reference

All tokens live in `src/styles/global.css` `:root`. **Do not redefine these elsewhere.** If you need a new value, add it to `:root` first and reference it via `var()`.

```css
:root {
  /* === Surfaces (warm dark IDE) === */
  --canvas:           #1a1a1a;   /* base app bg */
  --canvas-soft:      #1f1f1f;   /* IDE-pane soft surface */
  --surface-card:     #242424;   /* cards, dialog content */
  --surface-strong:   #2e2e2e;   /* badges, tag pills */
  --bg-hover:         #2a2a2a;   /* hover on interactive */
  --bg-active:        #333333;   /* pressed/active */

  /* === Hairlines (replaces borders + shadows) === */
  --hairline:         #2e2e2e;   /* default 1px divider */
  --hairline-soft:    #262626;   /* lighter divider */
  --hairline-strong:  #3a3a3a;   /* panel outline, button border */

  /* === Text === */
  --ink:              #e8e6e0;   /* display, headings, primary (warm) */
  --body:             #b8b6b0;   /* default body */
  --muted:            #7a7a78;   /* sub-titles */
  --muted-soft:       #4a4a48;   /* disabled */
  --text-on-accent:   #ffffff;

  /* === Accent (Cursor Orange) === */
  --accent:           #f54e00;   /* primary CTA, links, focus */
  --accent-hover:     #ff5e1a;
  --accent-active:    #d04200;   /* pressed */
  --accent-soft:      rgba(245, 78, 0, 0.12); /* focus halo, selection */

  /* === Semantic === */
  --error:            #cf2d56;
  --error-bg:         rgba(207, 45, 86, 0.12);
  --warning:          #f0a020;   /* recoverable problems (e.g. session disconnect) */
  --warning-bg:       rgba(240, 160, 32, 0.12);
  --success:          #1f8a65;
  --success-bg:       rgba(31, 138, 101, 0.12);

  /* === Typography === */
  --font-ui:          "Inter", "Segoe UI", system-ui, -apple-system,
                       "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono:        "JetBrains Mono", "Fira Code", "IBM Plex Mono",
                       Menlo, Monaco, "Courier New", monospace;

  /* === Spacing (4px base) === */
  --space-xxs:        4px;
  --space-xs:         8px;
  --space-sm:         12px;
  --space-base:       16px;   /* default field gap */
  --space-md:         20px;
  --space-lg:         24px;
  --space-xl:         32px;   /* between distinct sections */
  --space-xxl:        48px;
  --space-section:    80px;

  /* === Radius === */
  --radius-xs:        4px;    /* inline tags only */
  --radius-sm:        6px;    /* compact rows */
  --radius-md:        8px;    /* buttons, inputs */
  --radius-lg:        12px;   /* cards, dialogs */
  --radius-xl:        16px;   /* feature cards (rare) */
  --radius-pill:      9999px;

  /* === Window control === */
  --close-hover:      #e81123;   /* Windows-style red on close hover */

  /* === Overlay === */
  --overlay:          rgba(0, 0, 0, 0.55);
}
```

---

## 3. Color Usage

| Token | Used on | Never on |
|---|---|---|
| `--canvas` | App body background | Cards |
| `--surface-card` | Cards, dialog body, settings panels | App background |
| `--ink` | Display, headings, primary text | Disabled text |
| `--body` | Default body text | Headings |
| `--muted` | Sub-titles, metadata, tab labels (default) | Primary text |
| `--accent` | Primary CTAs, focus border, active underline, link | Body text, default borders |
| `--accent-soft` | Focus halo, selection row tint, drag-over | Solid fills |
| `--error` | Destructive CTAs, validation errors | Decoration |
| `--warning` | Recoverable problems (connection lost, etc.) | Fatal errors |
| `--success` | Confirmations | Decoration |
| `--hairline` | 1px dividers between sections | Drop shadow replacement |
| `--hairline-strong` | Panel outlines, button borders, dialog box | Fine dividers |

---

## 4. Typography

```css
display-xl { 38px / 700 / 1.1 / -1px }   /* hero h1 — rare, marketing only */
display-lg { 26px / 500 / 1.2 / 0   }   /* dialog titles */
title-md   { 18px / 500 / 1.4 / 0   }   /* card titles */
title-sm   { 16px / 500 / 1.4 / 0   }   /* list labels */
body-md    { 16px / 400 / 1.5 / 0   }   /* default body */
body-sm    { 14px / 400 / 1.5 / 0   }   /* secondary body */
caption    { 13px / 400 / 1.4 / 0   }   /* form inputs default */
caption-uppercase { 11px / 600 / 1.4 / 0.88px / UPPERCASE }  /* section labels */
button     { 14px / 500 / 1.0 / 0   }   /* CTA labels */
nav-link   { 14px / 500 / 1.4 / 0   }   /* top-nav menu */
code       { 13px / 400 / 1.5 / 0   }   /* always --font-mono */
```

**Rules**:
- Display sizes are reserved. Most chrome uses **14–16px**.
- Bold (≥ 600) is **only** allowed on the wordmark and inside mono code blocks. UI chrome stays at 400/500.
- Negative letter-spacing on large display only (`-1px` at 38px). Body text uses 0.
- Section labels use `caption-uppercase` (11px / 600 / 0.88px / uppercase).

---

## 5. Component Patterns

### Buttons (`.btn` family)

| Variant | bg | text | border | radius | weight |
|---|---|---|---|---|---|
| `.btn--primary` | `var(--accent)` | `var(--text-on-accent)` | none | `var(--radius-md)` | 500 |
| `.btn--primary:hover` | `var(--accent-hover)` | — | — | — | — |
| `.btn--primary:active` | `var(--accent-active)` | — | — | — | — |
| `.btn--secondary` | `var(--surface-card)` | `var(--ink)` | 1px `var(--hairline-strong)` | `var(--radius-md)` | 500 |
| `.btn--ghost` | transparent | `var(--ink)` | none | `var(--radius-md)` | 500 |

Height: **36–44px** (40px default). Horizontal padding: 16–20px.

### Form inputs (`.form-field`)

- Container: `display: flex; flex-direction: column; gap: 6–8px`
- Label: `var(--body)` 14px 500, no asterisk styling (use `var(--accent)` if required)
- Input/select: `var(--surface-card)` bg, `var(--ink)` text, 1px `var(--hairline-strong)` border, `var(--radius-md)` 8px, 12px 16px padding, height 40–44px
- Focus: border → `var(--accent)`, optional `outline: 2px solid var(--accent-soft)`
- Placeholder: `var(--muted)`

### Cards (settings panels, list rows)

- Background: `var(--surface-card)`
- Border: 1px `var(--hairline)` (or none on full-bleed)
- Radius: `var(--radius-lg)` 12px (cards) or `var(--radius-md)` 8px (compact rows)
- Padding: `var(--space-base)` 16px (compact) or `var(--space-lg)` 24px (feature cards)
- Header: `var(--ink)`, weight 500, 14–16px
- **No** `box-shadow`, **no** `linear-gradient`

### Dialogs

- Overlay: `var(--overlay)` (rgba(0,0,0,0.55))
- Dialog box: `var(--surface-card)` bg, `var(--radius-lg)` 12px, 1px `var(--hairline-strong)` border, subtle float shadow allowed (`0 8px 32px rgba(0,0,0,0.35)`)
- Header: `var(--surface-card)` bg, 1px `var(--hairline)` bottom rule, title weight 500
- Footer: `var(--surface-card)` bg, buttons right-aligned, primary on the right
- Width: small 320–400px, medium 400–500px, large 720–780px

### Tabs

- Background: transparent
- Text: `var(--muted)` (default), `var(--ink)` (active)
- Active indicator: 2px `var(--accent)` underline (not background fill)
- Hover: `var(--bg-hover)` background
- No border-radius on tab buttons (the underline is the chrome)

### Sidebar (left navigation inside dialogs)

- Items: `var(--body)` text, transparent bg
- Active: `var(--accent-soft)` bg + `var(--ink)` text + optional 2px `var(--accent)` left rail
- Hover: `var(--bg-hover)` bg
- Radius: `var(--radius-sm)` 6px on items

### Banners (e.g. session disconnect)

- Background: `var(--warning-bg)` (recoverable) or `var(--error-bg)` (validation)
- Text: `var(--warning)` / `var(--error)`
- Border-bottom: 1px same color
- `pointer-events: none` so clicks pass through to content
- Centered text, 13px 500

---

## 6. Elevation & Depth

| Level | Treatment | Where |
|---|---|---|
| Flat (canvas) | `--canvas` bg | Body, footer |
| Inset | `--canvas-soft` bg, no border | IDE panes inside cards |
| Card | `--surface-card` bg + 1px `--hairline` border | Settings panels, list containers |
| Pane | `--canvas-soft` bg + 1px `--hairline-strong` border | Tab content, dialog panels |
| Floating | `--surface-card` bg + 1px `--hairline-strong` + subtle `box-shadow` | Dialog, ContextMenu, popovers |

**Drop shadows are forbidden except on floating overlays.** Cards, sections, rows separate via hairline only.

---

## 7. Spacing Rhythm

| Use case | Token | Value |
|---|---|---|
| Inline element gap | `--space-xxs` / `--space-xs` | 4px / 8px |
| Field gap (within section) | `--space-base` | 16px |
| Section gap (within dialog) | `--space-xl` | 32px |
| Major page sections | `--space-section` | 80px |

Default dialog panel: 16px between fields, 32px between distinct section groups.

---

## 8. Border Radius Decision Tree

```
Container or section?        → --radius-none (0) or no radius
Card or dialog body?         → --radius-lg (12px)
Row inside a list?           → --radius-sm (6px)
Button or input?             → --radius-md (8px)
Inline tag or badge?         → --radius-xs (4px) or --radius-pill
Avatar or status dot?        → --radius-pill (9999px)
```

---

## 9. Workflow for New Components

1. **Read** `src/styles/global.css` `:root` and skim §3–§8 above.
2. **Build the JSX** using existing global classes where possible (`.btn--primary`, `.btn--secondary`, `.form-field`, etc.).
3. **Add component-specific CSS only when needed** — colocated `<Component>.css`. Reference tokens via `var(--...)`. **Never** write hex literals.
4. **Verify** before committing:
   ```bash
   # No forbidden tokens anywhere
   grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/

   # No bold weights
   grep -rn "font-weight: ?(600\|700\|bold)" src/

   # No drop shadows (except on Dialog / ContextMenu / popovers)
   grep -rn "box-shadow:" src/components/
   ```
5. **Run type-check** via PowerShell:
   ```bash
   powershell.exe -NoProfile -Command "Set-Location 'C:/path/to/xsterm'; npx tsc --noEmit"
   ```

---

## 10. Documented Exceptions

These specific rules violate a §1–§9 rule above but are intentional and reviewed.

### 10.1 Hex literals

| Where | Hex | Why |
|---|---|---|
| `src/styles/global.css` — `.form-field select` background-image | `#b8b6b0` (inline in `data:` URI) | The custom select chevron is an SVG data-URI; CSS variables cannot be interpolated inside a `data:` URL. Color matches `--muted`. |
| `src/components/NavBar.css` — `.window-control--close:hover` | `#e81123` | Windows-convention red on close hover. Token: `--close-hover`. |
| SVG `stroke=` attributes inside icon components | various | Icons use literal `currentColor` propagation — no token reference needed. |

### 10.2 Box-shadow on floating overlays

Floating overlays (per §6) may carry a subtle drop shadow. Currently allowed:

| File | Selector | Reason |
|---|---|---|
| `src/components/ui/Dialog.css:18` | `.dialog` | Floating modal — needs depth over page |
| `src/components/ui/ContextMenu.css:8` | `.context-menu` | Floating right-click menu |
| `src/components/sidebar/Sidebar.css:422` | `.layout-popover` | Floating panel over sidebar |
| `src/components/WorkspaceBottomBar.css:99` | `.workspace-switcher-item-list` | Floating workspace switcher popover |

### 10.3 Inset box-shadow as visual indicator

`inset` shadows are **not drop shadows** — they paint inside the element. Used for accent indicators:

| File | Selector | Reason |
|---|---|---|
| `src/components/sidebar/Sidebar.css:401` | `.session-group.drag-over` | 1px inner accent rail indicating drag-over target. Uses `inset 0 0 0 1px var(--accent)`. |
| `src/styles/pane.css:107` | `.workspace-pane--active::before` | 2px inner accent ring indicating focused pane. Implemented as an absolutely positioned pseudo-element with `inset: 0`, `z-index: -1`, and `box-shadow: inset 0 0 0 2px var(--accent)`. The negative z-index makes the ring paint before in-flow descendants, so the gutter overlay's opaque background covers the ring in its footprint. Must NOT use `outline` on `.workspace-pane` directly — `outline` paints on top of descendants and bleeds onto the gutter along the pane's edges. The companion rule in `src/components/Terminal.css` makes the gutter itself `position: absolute` anchored to `.workspace-pane` (not `.terminal-host`), with a `padding-left: 48px` reservation on `.terminal-host`, so the gutter reaches the pane's bottom edge even when a banner or wrapper shrinks the terminal host. |

When you add a new exception, document it here with the file path, selector, and rationale.

---

## 11. Anti-Patterns (forbidden)

- ❌ Hardcoded hex values in component CSS (use `var(--...)`).
- ❌ `font-weight: 600` or higher on UI chrome (use 400/500).
- ❌ `box-shadow` on cards, sections, inputs.
- ❌ `linear-gradient`, `radial-gradient`, `text-shadow` glow.
- ❌ `border-radius: 4px` or `6px` on cards (use `--radius-lg` 12px).
- ❌ Entire UI in monospace font (only code surfaces are mono).
- ❌ Old token names: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-color`.
- ❌ VSCode blue hex: `#0e639c`, `#1177bb`.
- ❌ Tailwind, CSS-in-JS, CSS Modules (project is plain global CSS).
- ❌ Fonts other than `--font-ui` / `--font-mono` / `inherit` in chrome.

---

## 12. References

- Cursor design source: <https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/cursor/DESIGN.md>
- xterm.js terminal themes (separate system, **not** governed here): `src/types/theme.ts`
- Token implementation: `src/styles/global.css` `:root`