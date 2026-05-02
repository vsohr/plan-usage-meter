# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```cmd
npm install              :: no native rebuilds; clean install
npm start                :: launch Electron in dev (window appears bottom-right)
npm test                 :: node:test suite over tests/*.test.js
npm run dist             :: NSIS installer + portable .exe → dist/
npm run dist:portable    :: portable target only
```

Run a single test file: `node --test tests/main-lib.test.js`. Filter by name: `node --test --test-name-pattern='formatResetIn' tests/*.test.js`.

Open renderer DevTools: set `PUM_DEVTOOLS=1` before `npm start` (PowerShell: `$env:PUM_DEVTOOLS='1'; npm start`).

If `npm start` errors with `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`, the shell has `ELECTRON_RUN_AS_NODE` set — unset it and retry.

`npm run dist` invokes `scripts/check-icons.js` first (prebuild). It hard-fails if `assets/icon.ico` (must contain a 256×256 layer) or `assets/tray.png` is missing/undersized — electron-builder will reject the build otherwise.

## Architecture

Three-process Electron app with a strict, locked module boundary:

- **main** ([src/main.js](src/main.js)) owns app lifecycle, the `BrowserWindow`, the `Tray`, the 60s polling timer, persistence I/O, single-instance lock, login-item settings, and all `ipcMain` handlers. It imports `./usage` (detection) and `./main-lib` (pure helpers) — nothing from `src/renderer/`.
- **preload** ([src/preload.js](src/preload.js)) is the *only* bridge. It exposes a frozen `window.api` via `contextBridge` with exactly five methods: `onUsage(cb)`, `refreshNow()`, `hide()`, `quit()`, `reportHeight(px)`. Channel names are duplicated as a frozen `CH` object in both [src/preload.js](src/preload.js) and [src/main-lib.js](src/main-lib.js) — keep them in sync.
- **renderer** ([src/renderer/](src/renderer/)) is vanilla JS + plain `<script>` tags (no bundler). It calls only `window.api.*`, never `require()`. It MUST NOT import `src/usage/index.js` — detection lives in main only. CSP in [index.html](src/renderer/index.html) blocks remote script.

### Data flow (one poll cycle)

1. `setInterval(poll, 60_000)` in main fires (also on `app.whenReady`, on tray "Refresh now", and on `ipcMain.handle('usage:refresh')`).
2. `poll()` is serialised by a `pollInFlight` flag — overlapping refresh requests return `{ accepted: false }`.
3. `runWithTimeout(getAccountUsage, 15_000)` from [src/main-lib.js](src/main-lib.js) wraps the detection call. **The timeout never throws** — on timeout/error it resolves with a synthetic `getAccountUsage()`-shaped payload (`buildTimeoutPayload` / `buildErrorPayload`) so the renderer always receives the same shape. This is why the wrapper exists: the copied detection module must not be edited (see below).
4. Result is broadcast on `usage:update` to every `BrowserWindow`, the tray tooltip is rebuilt via `buildTooltip()`, and the tray menu is rebuilt to refresh checkbox state.
5. Renderer batches re-renders in `requestAnimationFrame` (`scheduleRender`), full-replaces `#cards` in a single mutation (flicker-free), and reports its `documentElement.scrollHeight + 1` back via `window:report-height`. Main throttles resize to ~16ms and **anchors the bottom-right corner** by recomputing `y` so the window grows upward.

### The detection module is read-only by convention

[src/usage/index.js](src/usage/index.js) is a verbatim, SHA256-verified copy of `c:/claude-portal/lib/codex-usage.js`. **Do not edit it.** It's an intentional fork that accepts drift risk to keep this app standalone (no shared package). Anything that would be a fix to detection logic belongs *upstream* in `claude-portal`, then re-copied here. Anything that wraps, times out, or post-processes detection belongs in [src/main-lib.js](src/main-lib.js).

It exports `getAccountUsage()` which probes (in order): Hermes via WSL (`wsl -e sh -lc ...` running a Python venv at `~/.hermes/hermes-agent/`), then direct Codex auth at `~/.codex/auth.json`, then Codex session log files at `~/.codex/sessions/*.jsonl`, then Claude credentials at `~/.claude/.credentials.json`. Absent providers are silently skipped at the source level but surfaced in the `providers` map as `{ available: false, message }` so the renderer can show muted "Not detected" cards (this is intentional — the widget doubles as a config diagnostic).

### Persistence

Two JSON files in `app.getPath('userData')` (`%APPDATA%/Plan Usage Meter/`):

- `settings.json` — `{ openAtLogin }`. Written via `writeJsonAtomic` (tmp + rename).
- `window-state.json` — `{ x, y, width: 340, height }`. Written debounced (500ms) on `moved`/`resized`, and on `before-quit`. Width is hard-coded to 340 — never persist user-resized width. On load, `clampToDisplay()` rejects bounds whose target display has gone away (monitor unplugged) and falls back to `defaultBottomRight()`.

### Tray-only lifecycle

`window-all-closed` is intentionally a no-op. Closing the window calls `e.preventDefault(); win.hide()`. The only path to actually exit is **tray → Quit** (sets `app.isQuitting = true` then `app.quit()`). `--hidden` CLI arg is set by `setLoginItemSettings({ openAsHidden: true, args: ['--hidden'] })` so a Windows boot lands silently in the tray.

### Renderer details worth knowing

- Provider order is locked to `['claude', 'codex']` first, then any other keys ([renderer.js](src/renderer/renderer.js)). Hermes-as-Codex-data shows up under the codex card.
- Color thresholds in [src/renderer/lib.js](src/renderer/lib.js) `thresholdClass`: <65% none, ≥65% `warn` (amber), ≥85% `error` (red). Mirror this in CSS if changing.
- Relative-time formatting in [lib.js](src/renderer/lib.js) `formatResetIn` switches to day-grain (`5d`, `5d 3h`) once `≥24h` to avoid unreadable hour counts. Re-rendered every 30s without re-polling providers.

## Constraints (from SPEC, still binding)

- **No TypeScript.** Plain JS, CommonJS, Node ≥18.
- **No native modules.** `npm install` must complete with no rebuild step.
- **No bundler in the renderer** — plain `<script>` tags only.
- **No new runtime dependencies** without a strong reason. `package.json` currently has zero `dependencies` and only `electron` + `electron-builder` in `devDependencies`.
- **Tests** use built-in `node:test` only — no Jest, Mocha, or assertion libraries.
- The 340-pixel width is fixed; do not expose user resize.

## Docs

Detailed design lives in [docs/team/](docs/team/): `SPEC.md` (the what), `ARCHITECTURE.md` (the how), `TASKS.md` (the original build plan), and review/QA artifacts (`CODE-REVIEW.md`, `SECURITY-REVIEW.md`, `VERIFICATION.md`). When changing behavior, check SPEC for intent first — many "obvious improvements" (hide unavailable cards, custom poll intervals, macOS support) are explicit non-goals for v1.
