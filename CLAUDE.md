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

- **main** ([src/main.js](src/main.js)) owns app lifecycle, the `BrowserWindow`, the `Tray`, the 10-minute polling timer, persistence I/O, single-instance lock, login-item settings, and all `ipcMain` handlers. It imports `./usage` (detection) and `./main-lib` (pure helpers) — nothing from `src/renderer/`.
- **preload** ([src/preload.js](src/preload.js)) is the *only* bridge. It exposes a frozen `window.api` via `contextBridge` with seven methods: `onUsage(cb)`, `onMode(cb)`, `refreshNow()`, `setMode(mode)`, `hide()`, `quit()`, `reportHeight(px)`. Channel names are duplicated as a frozen `CH` object in both [src/preload.js](src/preload.js) and [src/main-lib.js](src/main-lib.js) — keep them in sync.
- **renderer** ([src/renderer/](src/renderer/)) is vanilla JS + plain `<script>` tags (no bundler). It calls only `window.api.*`, never `require()`. It MUST NOT import `src/usage/index.js` — detection lives in main only. CSP in [index.html](src/renderer/index.html) blocks remote script.

### Data flow (one poll cycle)

1. `setInterval(poll, AUTO_POLL_INTERVAL_MS)` in main fires every 10 minutes (also on initial window readiness, tray "Refresh now", and `ipcMain.handle('usage:refresh')`).
2. `poll()` is serialised by a `pollInFlight` flag — overlapping refresh requests return `{ accepted: false }`.
3. `runWithTimeout(getAccountUsage, 15_000)` from [src/main-lib.js](src/main-lib.js) wraps the detection call. **The timeout never throws** — on timeout/error it resolves with a synthetic `getAccountUsage()`-shaped payload (`buildTimeoutPayload` / `buildErrorPayload`) so the renderer always receives the same shape. This is why the wrapper exists: the copied detection module must not be edited (see below).
4. Result is broadcast on `usage:update` to every `BrowserWindow`, the tray tooltip is rebuilt via `buildTooltip()`, and the tray menu is rebuilt to refresh checkbox state.
5. Renderer batches re-renders in `requestAnimationFrame` (`scheduleRender`), full-replaces `#cards` in a single mutation (flicker-free), and reports its `documentElement.scrollHeight + 1` back via `window:report-height`. Main throttles resize to ~16ms and **anchors the bottom-right corner** by recomputing `y` so the window grows upward.

### The detection module is read-only by convention

[src/usage/index.js](src/usage/index.js) is a verbatim, SHA256-verified copy of `c:/claude-portal/lib/codex-usage.js`. **Do not edit it.** It's an intentional fork that accepts drift risk to keep this app standalone (no shared package). Anything that would be a fix to detection logic belongs *upstream* in `claude-portal`, then re-copied here. Anything that wraps, times out, or post-processes detection belongs in [src/main-lib.js](src/main-lib.js).

That includes **auth resilience**. The detection module reads `claudeAiOauth.accessToken` from `~/.claude/.credentials.json` and sends it to the usage API; it does not consult `expiresAt` or use the `refreshToken`. When the access token expires the API returns HTTP 401 and Claude silently falls off the meter until something else (the Claude Code CLI itself, on its next request) rewrites the credentials file. To keep the meter resilient without touching the locked module, [src/main-lib.js](src/main-lib.js) exposes `ensureFreshClaudeCredentials()`, which:

- reads the credentials file, returns early if `expiresAt - now > CLAUDE_TOKEN_REFRESH_LEEWAY_MS` (60s);
- otherwise POSTs to `https://console.anthropic.com/v1/oauth/token` with the `refresh_token` grant and the public Claude Code OAuth client ID;
- atomically rewrites `.credentials.json` (tmp + rename, mode `0o600`), preserving unrelated fields (`subscriptionType`, `rateLimitTier`, `scopes`, etc.).

[src/main.js](src/main.js) `getClaudeProvider` calls it as a preflight before `fetchClaudeUsage` and again with `force: true` on a 401, retrying once. Refresh failures are logged but do not crash the poll cycle — the user simply sees the stale-token error in the card and can run `claude` in a terminal to recover. The same logic is mirrored in `c:/claude-portal/lib/claude-auth.js` (called from `server.js` around `getAccountUsage`); keep the two implementations in sync when changing refresh behaviour.

The same read-only constraint forces a second, smaller mirror. Claude's usage API drops the 5-hour window to `{utilization: 0, resets_at: null}` when no session is active, and the detector's own `preferStatuslineWhenApiIsEmpty` only substitutes the statusline-cache window when its percent is `> 0` — so an idle-at-zero 5h window keeps a null reset anchor and the card renders `Session 0% · ——`. [src/main-lib.js](src/main-lib.js) `backfillClaudePrimaryReset` post-processes the provider after `fetchClaudeUsage` (called at both `getClaudeProvider` fetch sites, before caching) and copies a fresh, still-future reset anchor from the **same** statusline cache the detector reads (`~/.claude/plan-usage-meter-claude-rate-limits.json`). Because the detector can't be imported from here, the cache filename, the 15-minute max-age, and the `{savedAt, rate_limits.five_hour.resets_at}` shape are **duplicated** in main-lib — keep them in sync with [src/usage/index.js](src/usage/index.js) if the upstream copy drifts. The renderer also drops the dangling `· ——` when no anchor is present (`formatWindowDetail` in [src/renderer/lib.js](src/renderer/lib.js)), so the worst case degrades to a clean `Session 0%`.

It exports `getAccountUsage()` which probes (in order): Hermes via WSL (`wsl -e sh -lc ...` running a Python venv at `~/.hermes/hermes-agent/`), then direct Codex auth at `~/.codex/auth.json`, then Codex session log files at `~/.codex/sessions/*.jsonl`, then Claude credentials at `~/.claude/.credentials.json`. Absent providers are silently skipped at the source level but surfaced in the `providers` map as `{ available: false, message }` so the renderer can show muted "Not detected" cards (this is intentional — the widget doubles as a config diagnostic).

### Persistence

Two JSON files in `app.getPath('userData')` (`%APPDATA%/Plan Usage Meter/`):

- `settings.json` — `{ openAtLogin }`. Written via `writeJsonAtomic` (tmp + rename).
- `window-state.json` — `{ x, y, width, height, mode }`. Written debounced (500ms) on `moved`/`resized`, and on `before-quit`. `mode` is the source of truth for width (`'expanded'` → 180, `'minimal'` → 96) — `widthForMode()` derives it on launch via `normalizeWindowMode()`, which clamps unknown values back to `'expanded'` so older state files (no `mode` key) load as expanded. On load, `clampToDisplay()` rejects bounds whose target display has gone away (monitor unplugged) and falls back to `defaultBottomRight()`.

### Tray-only lifecycle

`window-all-closed` is intentionally a no-op. Closing the window calls `e.preventDefault(); win.hide()`. The only path to actually exit is **tray → Quit** (sets `app.isQuitting = true` then `app.quit()`). `--hidden` CLI arg is set by `setLoginItemSettings({ openAsHidden: true, args: ['--hidden'] })` so a Windows boot lands silently in the tray.

### Renderer details worth knowing

- Provider order is locked to `['claude', 'codex']` first, then any other keys ([renderer.js](src/renderer/renderer.js)). Hermes-as-Codex-data shows up under the codex card.
- Color thresholds in [src/renderer/lib.js](src/renderer/lib.js) `thresholdClass`: <65% none, ≥65% `warn` (amber), ≥85% `error` (red). Mirror this in CSS if changing.
- Relative-time formatting in [lib.js](src/renderer/lib.js) `formatResetIn` switches to day-grain (`5d`, `5d 3h`) once `≥24h` to avoid unreadable hour counts. Re-rendered every 30s without re-polling providers.
- Minimal mode (`body.mode-minimal`) collapses the meter to a 96px chip with two stacked sections (Claude on top, Codex below). Each section is row-flex: 17px provider icon on the left, two right-aligned rows ("5h 22%", "Wk 47%") on the right. Both providers' windows map by structural slot (`primary` = 5-hour, `secondary` = Weekly) — stable across providers because [src/usage/index.js](src/usage/index.js) fixes those labels for each. Chip percentages get the full traffic-light treatment (green <65, amber ≥65, red ≥85) via a chip-only `ok` class so `thresholdClass()` semantics stay unchanged. When a provider isn't available its section greys out and shows `——`. The header keeps `↻` refresh and `✕` close visible in both modes; the toggle button swaps glyphs (`−` minimise in expanded, `□` restore in minimal).
- The whole window is a drag region (`body { -webkit-app-region: drag }`) so the user can grab any non-button surface — header, card body, or chip — to move it. `#controls` overrides back to `no-drag` for the buttons. There is no click-to-expand on the chip body (drag would swallow click events anyway); the explicit `□` button in the chip header is the affordance.

## Constraints (from SPEC, still binding)

- **No TypeScript.** Plain JS, CommonJS, Node ≥18.
- **No native modules.** `npm install` must complete with no rebuild step.
- **No bundler in the renderer** — plain `<script>` tags only.
- **No new runtime dependencies** without a strong reason. `package.json` currently has zero `dependencies` and only `electron` + `electron-builder` in `devDependencies`.
- **Tests** use built-in `node:test` only — no Jest, Mocha, or assertion libraries.
- Window width is fixed per mode (180 expanded, 96 minimal); do not expose user resize. Mode toggling is the only allowed width change and goes through `setWindowMode()` in [src/main.js](src/main.js), which uses `modeResizeBounds()` from [src/main-lib.js](src/main-lib.js) to keep the bottom-right corner anchored across the change.

## Docs

Detailed design lives in [docs/team/](docs/team/): `SPEC.md` (the what), `ARCHITECTURE.md` (the how), `TASKS.md` (the original build plan), and review/QA artifacts (`CODE-REVIEW.md`, `SECURITY-REVIEW.md`, `VERIFICATION.md`). When changing behavior, check SPEC for intent first — many "obvious improvements" (hide unavailable cards, custom poll intervals, macOS support) are explicit non-goals for v1. Note that those documents are v1 snapshots: dimensions referenced there (340 px expanded) predate the compaction work — current is 180 px expanded / 96 px minimal as documented above.
