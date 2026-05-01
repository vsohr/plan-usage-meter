# ARCHITECTURE — plan-usage-meter

> Source of truth for the build agent. Every decision below is binding unless SPEC.md
> overrides it. SPEC.md owns the **what**; this doc owns the **how**.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Electron ≥28 (currently 28.x ships Chromium 120, Node 18.18.2) | SPEC locks Electron. 28+ guarantees global `fetch`, `AbortController`, and `AbortSignal.timeout` in main — no polyfills, no `node-fetch`. |
| Language | Plain JavaScript (CommonJS, Node ≥18) | SPEC bans TypeScript. CJS keeps the main process simple; no ESM loader gymnastics. The renderer uses inline `<script>` (no bundler). |
| Packaging | `electron-builder` (NSIS + portable target) | SPEC F8/AC8. Mature, declarative YAML, handles ICO embedding and code-signing hooks. |
| Detection lib | Verbatim copy of `c:/claude-portal/lib/codex-usage.js` → `src/usage/index.js` | SPEC §Tech-stack: detection module is copied as-is, no edits. We wrap it externally for the timeout. |
| HTTP client | Native `fetch` (Node 18 undici) inherited via the copied module | The copied file already calls global `fetch`. No `node-fetch`, no `axios`. |
| IPC | Electron `ipcMain` / `ipcRenderer` via `contextBridge` | Only safe primitive that survives `contextIsolation: true`. |
| Persistence | Plain JSON files in `app.getPath('userData')` (`settings.json`, `window-state.json`) | Two scalars — no need for `electron-store` or sqlite. Atomic writes via tmp + rename. |
| Polling | `setInterval(60_000)` started on `app.whenReady`; first tick fires immediately. Per-call timeout is `Promise.race` with a 15s timer + `AbortController` for the in-flight `fetch`. | SPEC F5/AC19. Single timer, serialised via a `pollInFlight` flag. |
| Timeouts | `Promise.race([usagePromise, timeoutPromise])`. Timeout returns a synthetic `getAccountUsage()`-shaped payload — does **not** throw. | SPEC: do not modify the copied detection module. The wrapper is the only place timeout logic lives. |
| UI rendering | Vanilla JS, full re-render of `#cards` per push, batched in `requestAnimationFrame`. | At most 3–4 cards. No framework overhead. No diffing v1. |
| Tray | Electron `Tray` + `Menu.buildFromTemplate` | Standard. Menu rebuilt every poll so checkbox/tooltip stay accurate. |
| Tests | Node built-in `node:test` for pure helpers. No Jest, no Mocha. | SPEC bans native modules and bloat. `node:test` is zero-dep. |

---

## Project Structure

```
plan-usage-meter/
├── package.json                 # entry: src/main.js; scripts: start, dist, test
├── electron-builder.yml         # NSIS + portable targets, appId, icon
├── README.md                    # quickstart + dev/dist commands (1 page)
├── .gitignore                   # node_modules, dist/, worktrees/, userData
├── assets/
│   ├── icon.ico                 # multi-size ICO (16/32/48/64/128/256). Required at dist time.
│   └── tray.png                 # 16x16 monochrome PNG for the tray (Win renders @1x)
├── src/
│   ├── main.js                  # Electron entry: app, BrowserWindow, Tray, IPC, polling
│   ├── preload.js               # contextBridge surface — only allow-listed IPC
│   ├── usage/
│   │   └── index.js             # VERBATIM copy of c:/claude-portal/lib/codex-usage.js
│   └── renderer/
│       ├── index.html           # Single-page shell, CSP meta, loads renderer.js
│       ├── styles.css           # Card layout, bar colors, drag region styles
│       └── renderer.js          # IPC subscriber, render loop, relative-time tick
└── tests/
    ├── color-thresholds.test.js
    ├── relative-time.test.js
    └── clamp-bounds.test.js
```

One concept per file. `src/usage/index.js` is read-only (copied; do not edit).

---

## Module Boundaries

### main (`src/main.js`)
**Owns:** app lifecycle, window creation, tray, polling timer, persistence reads/writes,
single-instance lock, login-item settings, IPC handlers.
**Imports:** `electron`, `fs`, `path`, `./usage` (the copied module), nothing else.
**Never imports:** anything from `src/renderer/`.

### preload (`src/preload.js`)
**Owns:** the *only* bridge between renderer and main. Exposes a frozen object on
`window.api` via `contextBridge.exposeInMainWorld`. No business logic.
**Allowed exports (locked surface):**
- `onUsage(cb)` — subscribes to push updates from main; returns an unsubscribe fn.
- `refreshNow()` — async; main → poll-or-noop.
- `hide()` — fire-and-forget.
- `quit()` — fire-and-forget.
- `reportHeight(px)` — fire-and-forget; throttled in renderer, not preload.

### renderer (`src/renderer/`)
**Owns:** DOM, render loop, relative-time formatting, click handlers, height
measurement.
**Calls only:** `window.api.*`. No `require()`, no Node globals.
**MUST NOT** import `src/usage/index.js` directly. Detection lives in main.

### usage (`src/usage/index.js`)
**Owns:** provider detection. Copied verbatim. The only public function used by
main is `getAccountUsage()`. (`module.exports` exposes more; ignore the rest for v1.)
**Boundary rule:** main wraps every call in a 15s timeout. The module itself does
not know about timeouts.

### Cross-boundary rules
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload still
  gets the `contextBridge` API under sandbox).
- All renderer→main traffic flows through `window.api`. No `<webview>`, no
  `remote` module, no `enableRemoteModule`.
- Renderer receives JSON-serialisable data only. No functions, no `Date` objects
  — timestamps cross as ISO-8601 strings (which is what the detection lib already
  produces).

---

## Data Models

### `Usage` (sent from main to renderer on every poll)

This matches `getAccountUsage()`'s return shape exactly — main passes it through
unchanged. The renderer is defensive against missing fields.

```js
// Top-level (verbatim from detection lib)
{
  available: boolean,            // true iff at least one provider is available
  source: 'account-usage',       // constant
  label: string,                 // e.g. "Claude 42%" — picked from preferred provider
  updatedAt: string,             // ISO-8601, set per call
  providers: {
    codex:  Provider,            // always present (may be unavailable)
    claude: Provider             // always present (may be unavailable)
    // future keys allowed; renderer iterates Object.keys(providers)
  },
  errors: { codex?: string, claude?: string },
  primary:   Window | null,      // mirror of preferred provider's primary
  secondary: Window | null,
  planType:  string | null
}

// Provider — available
{
  available: true,
  source: 'codex-live'|'codex-logs'|'claude-live'|'hermes-live',
  label: string,                 // "GPT 42%" / "Claude 42%"
  updatedAt: string,             // ISO-8601
  planType: string | null,
  primary:   Window | null,
  secondary: Window | null,
  details?: Window[],            // claude only (Opus weekly / Sonnet weekly / Extra)
  credits?: any,                 // raw from upstream; renderer ignores for v1
  tokens?: any                   // raw; renderer ignores
}

// Provider — unavailable
{
  available: false,
  source: string,
  label: string,                 // "GPT --" / "Claude --"
  message: string                // human-readable reason. Always present.
}

// Window
{
  label: string,                 // "Session" / "Weekly" / "Opus weekly"
  usedPercent: number,           // 0..100 (may slightly exceed 100 — clamp on display)
  windowMinutes: number | null,
  resetsAt: string | null        // ISO-8601 or null
}
```

### `Settings` (`<userData>/settings.json`)
```js
{ openAtLogin: boolean }
```
Default `{ openAtLogin: false }` if file missing or malformed.

### `WindowState` (`<userData>/window-state.json`)
```js
{ x: number, y: number, width: number, height: number }
```
Width/height are persisted but width is forced back to 340 on every launch
(SPEC: fixed width). Height is restored only as a hint — first poll's
`reportHeight` will overwrite it.

### Synthetic timeout payload
When `getAccountUsage()` exceeds 15s, main substitutes:
```js
{
  available: false,
  source: 'account-usage',
  label: 'AI --',
  updatedAt: new Date().toISOString(),
  providers: {
    codex:  { available: false, source: 'codex',  label: 'GPT --',    message: 'Provider timed out' },
    claude: { available: false, source: 'claude', label: 'Claude --', message: 'Provider timed out' }
  },
  errors: { timeout: 'getAccountUsage exceeded 15000ms' },
  primary: null, secondary: null, planType: null
}
```
Shape-compatible with the renderer's normal expectations — no special-case code path.

---

## IPC Contracts

All channel names are string constants defined once in `src/main.js` and imported
by `src/preload.js`. Renderer never sees raw channel names.

| Channel | Direction | Mechanism | Payload | Intent |
|---|---|---|---|---|
| `usage:update` | main → renderer (push) | `webContents.send` | `Usage` (above) | Fired after every poll completes (success, failure, or timeout). Also fired immediately on window creation if a cached `latestUsage` exists. |
| `usage:refresh` | renderer → main | `ipcRenderer.invoke` → `ipcMain.handle` | none → `{ accepted: boolean }` | Trigger an out-of-cycle poll. Returns `accepted: false` if `pollInFlight` is true (main drops, does not queue — SPEC F5). |
| `window:hide` | renderer → main | `ipcRenderer.send` → `ipcMain.on` | none | Title-bar X button. Hides window; tray icon stays. |
| `app:quit` | renderer → main | `ipcRenderer.send` → `ipcMain.on` | none | Reserved for future menu UI. v1 keeps quit on the tray only; channel exists so renderer can wire a debug shortcut. |
| `window:report-height` | renderer → main | `ipcRenderer.send` → `ipcMain.on` | `number` (px, integer, clamped 80..1200 in main) | Renderer measures `document.body.scrollHeight` and reports. Main resizes preserving x/y/width. |

### `toggle-open-at-login` — decision

**Pick: tray-only.** No IPC channel for this in v1.

Rationale: SPEC F4 puts the "Open at login" checkbox in the tray context menu and
nowhere else. Adding a renderer toggle would require two UI sources of truth and
duplicate the persistence handling. Keeping it tray-only also keeps the renderer
free of OS-coupled controls (`app.setLoginItemSettings` is a main-process API).
If a settings panel ships in v2, add `settings:set-open-at-login` then.

### Channel constants
```js
// src/main.js (export not needed — preload imports same file via require)
const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height'
});
```

---

## Polling & Timeout Strategy

### The poll loop

```
app.whenReady
  └─ schedule first poll (immediate)
  └─ setInterval(poll, 60_000)
```

### `poll()` — sketch

```js
let pollInFlight = false;
let latestUsage = null;

async function poll() {
  if (pollInFlight) return;        // serialise — drop, do not queue
  if (app.isQuitting) return;      // AC16 — no work during shutdown
  pollInFlight = true;
  try {
    const usage = await runWithTimeout(getAccountUsage, 15_000);
    latestUsage = usage;
    broadcastUsage(usage);
    updateTray(usage);
  } catch (err) {
    // getAccountUsage itself does not throw — but Promise.race could reject if
    // we wired it that way. We pick the synthetic-payload approach instead so
    // this catch is for truly unexpected errors (programmer error). Log only.
    console.error('[poll] unexpected', err);
  } finally {
    pollInFlight = false;
  }
}
```

### `runWithTimeout(fn, ms)` — wrapper

```js
function runWithTimeout(fn, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(t); resolve(value); } };
    const t = setTimeout(() => finish(buildTimeoutPayload(ms)), ms);
    Promise.resolve().then(fn).then(finish).catch((err) => finish(buildErrorPayload(err)));
  });
}
```

Key properties:
- **Never throws.** Every code path resolves with a renderable payload.
- **15s wall-clock**, not per-fetch. The detection module makes up to three calls
  in sequence (hermes, codex, claude); 15s covers the slowest realistic walk.
- **No edits to `src/usage/index.js`.** The wrapper lives in `main.js`.
- An in-flight `fetch` started by the detection lib continues until the OS tears
  it down. The result is discarded. Detection lib already wraps each provider in
  try/catch, so no unhandled rejection (AC16).

### After every poll
1. Cache result in `latestUsage`.
2. `webContents.send('usage:update', usage)` for every open BrowserWindow.
3. Rebuild tray menu (so the "Open at login" checkbox stays current).
4. Update tray tooltip (compact one-liner — see Tray Lifecycle).

### Manual refresh (`usage:refresh`)
- If `pollInFlight`: handler returns `{ accepted: false }`. Renderer leaves the
  spinner state for ≤500ms then resets — purely a visual cue.
- Else: handler kicks `poll()` (does not await — returns `{ accepted: true }`
  immediately, the broadcast handles the result).
- Manual refresh **does not reset the 60s interval** (SPEC F5).

---

## Window Lifecycle

### Creation (on `whenReady`)
```js
const state = readWindowState();          // null on first run / corrupt
const work = screen.getPrimaryDisplay().workArea;
const bounds = clampToDisplay(state, work) ?? defaultBottomRight(work);
win = new BrowserWindow({
  width: 340,
  height: bounds.height,
  x: bounds.x,
  y: bounds.y,
  frame: false,
  transparent: true,
  resizable: false,
  alwaysOnTop: true,
  skipTaskbar: true,                       // tray-only presence
  show: false,                             // wait for ready-to-show to avoid white flash
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
});
win.once('ready-to-show', () => {
  if (!process.argv.includes('--hidden')) win.show();
});
```

### Closing → hide
```js
win.on('close', (e) => {
  if (app.isQuitting) return;             // tray "Quit" sets this flag first
  e.preventDefault();
  win.hide();
});
```

### Toggle from tray
```js
function toggleWindow() {
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}
```

### Position restoration (AC13)
```js
function clampToDisplay(state, _work) {
  if (!state || typeof state.x !== 'number' || typeof state.y !== 'number') return null;
  const target = screen.getDisplayMatching({ x: state.x, y: state.y, width: 340, height: 200 });
  // getDisplayMatching always returns a display; check overlap manually.
  const a = target.workArea;
  const fullyOff =
    state.x + 340 < a.x ||
    state.x > a.x + a.width ||
    state.y + 200 < a.y ||
    state.y > a.y + a.height;
  if (fullyOff) return null;
  return { x: state.x, y: state.y, width: 340, height: state.height || 200 };
}

function defaultBottomRight(work) {
  const margin = 16;
  const height = 200;                     // first-render placeholder
  return {
    x: work.x + work.width  - 340 - margin,
    y: work.y + work.height - height - margin,
    width: 340,
    height
  };
}
```

### Single-instance lock
```js
// Top of main.js, before any other electron import-side-effects.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
```

### Auto-resize from `report-height` (AC24)
```js
let resizeRaf = null;
ipcMain.on(CH.WIN_HEIGHT, (_e, raw) => {
  const px = Math.max(80, Math.min(1200, Math.round(Number(raw) || 0)));
  if (resizeRaf) return;                   // throttle to ~60fps
  resizeRaf = setTimeout(() => {
    resizeRaf = null;
    if (!win || win.isDestroyed()) return;
    const cur = win.getBounds();
    // Bottom-anchor: keep bottom edge fixed so growth is upward (matches default position).
    const newY = cur.y + (cur.height - px);
    win.setBounds({ x: cur.x, y: newY, width: 340, height: px }, false);  // animate=false
  }, 16);
});
```
Bottom-anchor is the implementation hint from AC24. `animate: false` avoids any
implicit animation that could cause perceived flicker.

---

## Tray Lifecycle

```js
let tray = null;

app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray.setToolTip('Plan Usage Meter');
  rebuildTrayMenu();                       // initial menu
  tray.on('click', debounce(toggleWindow, 250));
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (tray) { tray.destroy(); tray = null; }
});
```

### Menu (rebuilt every poll)
```
Show / Hide              ← label flips based on win.isVisible()
Refresh now              ← invokes poll()
─────────────────
Open at login   [✓]      ← checkbox; calls app.setLoginItemSettings
─────────────────
Quit
```

`rebuildTrayMenu()` is called in three places: app ready, after every poll, and
after the user toggles "Open at login". This keeps the checkbox and tooltip
fresh without diffing logic.

### Tooltip format (AC6, AC11)
```js
function buildTooltip(usage) {
  const avail = Object.values(usage?.providers || {}).filter(p => p?.available);
  if (avail.length === 0) return 'No providers detected';
  return avail.map(p => p.label).join(' · ');   // " · "
}
```

### Click debounce (AC15)
250ms wrapper around `toggleWindow`. Subsequent clicks within the window are
ignored — Electron's `show`/`hide` are synchronous on Windows so debouncing is
purely defensive against double-firing OS events.

---

## Persistence

Both files live in `app.getPath('userData')`. Always:
1. Read on startup.
2. If parse fails: log `console.warn`, return defaults, **do not** rewrite immediately
   (avoid clobbering on a transient FS hiccup). Rewrite happens on the next legitimate
   set/save.
3. Write atomically: `fs.writeFileSync(tmpPath, json)` then `fs.renameSync(tmpPath, finalPath)`.

```js
function readJsonSafe(filePath, defaults) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[persist] ${filePath}: ${err.message}`);
    return { ...defaults };
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}
```

### Window-state save trigger
Listen for `win.on('moved')` and `win.on('resized')`, debounce ~500ms, then
`writeJsonAtomic`. Don't save on every pixel of a drag.

### Settings save trigger
Only when "Open at login" is toggled. Fire `app.setLoginItemSettings` first,
then write the file (so a failure of the OS call doesn't poison the JSON).

---

## Error Handling Strategy

**Boundaries:**
- `getAccountUsage()` failures and timeouts are converted to a renderable `Usage`
  payload by `runWithTimeout`. The renderer never receives a thrown error.
- File I/O wraps in try/catch with default fallback. ENOENT is silent; other
  errors warn-but-continue.
- `app.setLoginItemSettings` is wrapped — if Windows refuses (unlikely), warn
  and revert the in-memory `openAtLogin` flag so the menu reflects reality.

**Renderer defensiveness:**
```js
const pct = typeof window?.usedPercent === 'number' ? window.usedPercent : null;
const reset = window?.resetsAt;          // string|null|undefined — formatter handles all
const pct100 = clampPercent(pct);        // returns 0 if pct is null/NaN
```
All "missing" displays fall back to `"—"` (em dash). No "undefined", no "NaN%".

**Console policy (AC23):**
- Zero `console.error` on a clean run.
- `console.warn` reserved for recoverable issues (corrupt JSON, login-item set failure).
- Unhandled rejections in main:
  ```js
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);   // log only — do NOT exit
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    // Continue running — main loop is independent of any single failure.
  });
  ```
  These exist as a backstop. Code is structured so they never fire on normal paths.

---

## Renderer Architecture

Single page. Vanilla JS. No framework, no bundler.

### State
```js
let latestUsage = null;        // most recent payload from main
let lastRenderAt = 0;          // for relative-time tick gating
```

### IPC subscription (run once on DOMContentLoaded)
```js
window.api.onUsage((usage) => {
  latestUsage = usage;
  scheduleRender();
});
```

### Render scheduling
```js
let renderRaf = null;
function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = null;
    renderCards(latestUsage);
    reportHeight();
  });
}
```

### `renderCards` — full re-render
- Take `Object.keys(usage.providers)` in stable order: `['claude', 'codex', ...rest]`.
- For each, build a `<div class="card">` using template literals.
- Replace `#cards.innerHTML` in one assignment (single layout pass).
- Color thresholds applied to each bar: `.bar.warn` (75–95), `.bar.error` (≥95).

**Why full re-render, not diff?**
- ≤4 cards. The cost is negligible.
- A single `innerHTML` assignment is the most flicker-resistant approach (the
  browser commits the whole tree in one frame).
- Diffing would add complexity for no measurable win at this scale.

### Relative-time tick (no re-poll)
```js
setInterval(() => {
  if (!latestUsage) return;
  scheduleRender();              // re-render uses fresh "now"
}, 30_000);
```

### Height reporting (AC24)
```js
function reportHeight() {
  const h = document.body.scrollHeight;
  window.api.reportHeight(h);
}
```
Called after every render. Main throttles to 16ms — see Window Lifecycle.

### Relative-time formatter (pure helper, unit-tested)
```js
function formatResetIn(isoString, now = Date.now()) {
  if (!isoString) return '—';
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return '—';
  const diffMs = t - now;
  if (diffMs <= 60_000) return 'resets soon';     // AC18
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `resets in ${hours}h ${rem}m`;
}
```

### Color-threshold helper (unit-tested)
```js
function thresholdClass(usedPercent) {
  if (typeof usedPercent !== 'number' || Number.isNaN(usedPercent)) return '';
  if (usedPercent >= 95) return 'error';
  if (usedPercent >= 75) return 'warn';
  return '';
}
```

### CSS feel (matches claude-portal)
- `--bg`: dark glass (`rgba(20,20,24,0.92)`), `--border` `rgba(255,255,255,0.08)`.
- Bars: 4px tall, 2px radius. Default green (`#22c55e`); warn `#facc15`; error `#ef4444`.
- Header: 36px tall, drag region active across the whole header except buttons
  (`-webkit-app-region: drag` on header, `no-drag` on each `<button>`).
- Frameless + `transparent: true` requires the body's outermost element to have
  the rounded background; the window itself is fully transparent.

---

## Tray Icon Generation

**Pick: ship checked-in PNG and ICO.** Do not generate at install time.

Rationale:
- `npm install` must run on a clean machine without extra tooling (SPEC AC1).
- Generating PNGs at install time means a `postinstall` script and a runtime
  dependency on `nativeImage` or canvas — adds risk for zero benefit.
- Two static binary files in `assets/` are reviewable and version-controlled.

### Files to create
- `assets/tray.png` — 16x16 monochrome PNG on transparent background. Used by
  `new Tray(path)`. One size suffices at integer scale factors.
- `assets/icon.ico` — multi-resolution ICO with 16/32/48/64/128/**256**.
  The 256 is mandatory: electron-builder rejects ICOs whose largest size is
  below 256 ("image must be at least 256x256").

### Build-time validation (AC22)
electron-builder already fails on missing/undersized icon. Added defensive
`prebuild` script for a cleaner error message:

```json
// package.json scripts
"prebuild": "node -e \"require('fs').accessSync('assets/icon.ico')\"",
"dist":     "npm run prebuild && electron-builder"
```

### Placeholder policy
A monochrome 16x16 PNG and a 256-anchored ICO ship in the initial commit
(any image editor — needn't be pretty for v1). README notes: "Replace
`assets/icon.ico` and `assets/tray.png` with branded artwork before public release."

---

## Component Architecture (lifecycle diagrams)

### App startup
```
process start → requestSingleInstanceLock()
  ├─ false → app.quit, exit
  └─ true → register second-instance + unhandledRejection/uncaughtException handlers
            → app.whenReady
              → readSettings, readWindowState
              → createWindow(bounds), createTray, rebuildTrayMenu
              → poll() (immediate)
              → setInterval(poll, 60_000)
```

### Poll cycle
```
timer fires (or refresh handler called)
  → if pollInFlight: drop, return
  → pollInFlight = true
  → runWithTimeout(getAccountUsage, 15_000) [always resolves]
  → latestUsage = usage
  → for each open window: webContents.send('usage:update', usage)
  → rebuildTrayMenu(); tray.setToolTip(buildTooltip(usage))
  → pollInFlight = false
```

### Manual refresh
```
renderer click → window.api.refreshNow() → ipcRenderer.invoke('usage:refresh')
  → ipcMain.handle:
      if pollInFlight: resolve { accepted:false }
      else: poll() (no await); resolve { accepted:true }
  → renderer: if !accepted, flash spinner ~500ms; else wait for usage:update push
```

### Window close
```
renderer X → window.api.hide() → ipcMain.on('window:hide') → win.hide()
(close event listener also catches OS-level closes and preventDefaults quit)
```

### Second-instance attempt
```
2nd process: requestSingleInstanceLock() → false → app.quit()
1st process: 'second-instance' event → restore-if-min, win.show(), win.focus()
```

### Login-at-boot (openAsHidden: true)
```
Windows boot → login item launches: plan-usage-meter.exe --hidden
  → lock acquired → app.whenReady → createWindow({ show:false })
  → ready-to-show: if argv has --hidden, skip show()
  → tray icon visible; window stays hidden until user clicks tray
```
`setLoginItemSettings({ openAsHidden:true })` already adds `--hidden` on Windows;
we treat it defensively as both a flag and a configuration assertion.

---

## Testing Strategy

### What we test (unit, `node:test`)
Pure helpers only. These functions have no Electron dependency — runnable as
`node --test tests/`.

| Test file | Function under test | Properties |
|---|---|---|
| `color-thresholds.test.js` | `thresholdClass(pct)` | `<75 → ''`, `[75,95) → 'warn'`, `>=95 → 'error'`, NaN/null/undefined → `''`, negative → `''` |
| `relative-time.test.js` | `formatResetIn(iso, now)` | null → `'—'`, invalid → `'—'`, past → `'resets soon'`, <60min → `'resets in Nm'`, >=60min → `'resets in Hh Mm'` |
| `clamp-bounds.test.js` | `clampToDisplay(state, work)` | null state → null, x off-screen left/right/top/bottom → null, fully inside → returns same. |

These three helpers are **factored to be importable without Electron**: `thresholdClass`
and `formatResetIn` live in a `src/renderer/lib.js` re-exported via `module.exports`
inside a `if (typeof module !== 'undefined')` guard so the same file works in the
renderer (script tag) and Node (require). `clampToDisplay` lives in
`src/main-lib.js` (zero Electron imports — pure math on `{x,y,width,height}`
shapes) and `main.js` requires it.

### What we do NOT test (out of scope, v1)
- Integration tests for IPC, window lifecycle, tray menu — these need a headed
  Electron runtime. Spectron is unmaintained; `playwright-electron` is viable but
  adds CI complexity. Logged in FUTURE.md.
- Detection lib internals — it's copied verbatim; the upstream owns its tests.
- Auto-update, code-signing — out of scope per SPEC.

### QA: manual smoke walkthrough
QA agent runs SPEC's AC1–AC24 as a script. Per-AC commands:

```bash
cd c:\git\plan-usage-meter
npm install            # AC1: no errors, no native rebuild
npm start              # AC2,AC3: 340px frameless window, cards render bottom-right
                       # AC4: click in-window refresh → updatedAt changes
                       # AC5: click X → hides; right-click tray → 4-item menu
                       # AC6: hover tray → "Claude 42% · GPT 67%"
                       # AC10: 2nd `npm start` → focuses existing, no 2nd window
                       # AC11: with creds moved aside → "Not detected" cards + tooltip
                       # AC23: DevTools open through full walk → 0 errors/rejections
                       # AC24: trigger card height change → no flash
# AC7: tray → Open at login (check); reboot Windows; verify tray-only at boot
npm run dist           # AC8: dist/*.exe (NSIS) + dist/*-portable.exe
                       # AC22: rename assets/icon.ico aside → build fails loudly
```
Each AC has explicit pass/fail. QA writes results into a checklist file.

---

## Build & Distribution

### `package.json` (relevant excerpts)
```json
{
  "name": "plan-usage-meter",
  "version": "0.1.0",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/",
    "prebuild": "node -e \"require('fs').accessSync('assets/icon.ico')\"",
    "dist": "npm run prebuild && electron-builder"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.13.0"
  }
}
```
No runtime dependencies. The detection module's only `require`s are Node
built-ins (`fs`, `path`, `child_process`).

### `electron-builder.yml` (minimal but complete)
```yaml
appId: com.vsohr.plan-usage-meter
productName: Plan Usage Meter
copyright: Copyright (c) 2026 vsohr

directories:
  output: dist
  buildResources: assets

files:
  - "src/**/*"
  - "assets/**/*"
  - "package.json"

win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  icon: assets/icon.ico
  artifactName: "${productName}-${version}-${arch}.${ext}"

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: "Plan Usage Meter"

portable:
  artifactName: "${productName}-${version}-portable.${ext}"
```

### How `npm run dist` works
1. `prebuild` asserts the ICO is on disk (loud failure if missing → AC22).
2. `electron-builder` reads `electron-builder.yml`, packs the app, embeds the
   ICO, generates `dist/Plan Usage Meter-0.1.0-x64.exe` (NSIS) and
   `dist/Plan Usage Meter-0.1.0-portable.exe`.
3. No code-signing in v1 — Windows SmartScreen will warn on first install. Note
   in README. Signing is FUTURE.md.

---

## File Size Budget

Hard limits per CLAUDE.md (functions <50 lines, files <800 lines, ≤3 params).
Practical targets:

| File | Target | Rationale |
|---|---|---|
| `src/main.js` | ≤350 lines | App + window + tray + IPC + polling. Extract helpers (`runWithTimeout`, `buildTooltip`, persistence) into `src/main-lib.js` if it gets crowded. |
| `src/preload.js` | ≤50 lines | Five `contextBridge` methods. Anything bigger is leaking logic into preload. |
| `src/renderer/renderer.js` | ≤300 lines | State + render + format helpers + IPC subscriber. |
| `src/renderer/index.html` | ≤80 lines | Static shell only — header markup, `#cards` container, script tag. |
| `src/renderer/styles.css` | ≤250 lines | Cards, bars, header, drag region. No theming. |
| `src/usage/index.js` | ~395 lines (verbatim) | Copied from upstream. Untouched. Already within the 800 cap. |
| `src/main-lib.js` | ≤200 lines | If extracted: pure helpers (`runWithTimeout`, `clampToDisplay`, `readJsonSafe`, `writeJsonAtomic`, `buildTimeoutPayload`). |
| `tests/*.test.js` | ≤150 lines each | Per-helper test file. |

If `main.js` exceeds 350, the split point is `main-lib.js`: pure helpers move
out, `main.js` becomes orchestration only. This keeps separation of concerns
and respects the budget.

---

## Risks & Mitigations

### Risk 1 — Native fetch under Electron's Node
**Risk:** Detection lib uses global `fetch`. Older Node lacks it.
**Mitigation:** Electron 28 ships Node 18.18.2 (stable `fetch`, `AbortController`,
`AbortSignal`). Lock `"electron": "^28.0.0"` and document floor in README.

### Risk 2 — electron-builder ICO requirements
**Risk:** electron-builder rejects ICOs whose largest size is below 256x256
("image must be at least 256x256"). Swapping in a 48x48-only ICO breaks `dist`.
**Mitigation:** `assets/icon.ico` committed as 16/32/48/64/128/256 multi-size.
`prebuild` script asserts the file exists. README documents the size requirement.
AC22's loud-failure is already the default behavior.

### Risk 3 — Windows tray DPI scaling
**Risk:** A 16x16 PNG can look fuzzy at 150%/200% scaling.
**Mitigation:** Out of scope per SPEC AC21 ("accepted-risk for v1"). Ship a
single 16x16. FUTURE.md adds a `@2x` 32x32 variant via `nativeImage` if needed.

### Risk 4 — Anthropic API rate-limit collisions
**Risk:** Widget + claude-portal + Claude CLI all polling
`api.anthropic.com/api/oauth/usage` triples baseline traffic and may trip 429s.
**Mitigation:** README documents "don't co-run with claude-portal's embedded
usage meter." The detection lib's HTTP errors flow into `provider.message`
cleanly — a 429 surfaces as "HTTP 429" in the unavailable card (AC12).
FUTURE.md: shared on-disk cache keyed by token hash, 30s TTL.

### Risk 5 — Preload sandbox + `require`
**Risk:** With `sandbox: true`, Node built-ins are unavailable in preload.
**Mitigation:** Preload uses only `contextBridge` and `ipcRenderer` (sandbox-safe).
No Node imports. The 50-line budget enforces this naturally.

### Risk 6 — Unsigned builds + SmartScreen
**Risk:** Windows SmartScreen blocks unsigned `.exe` files on first run.
**Mitigation:** README documents the SmartScreen workaround ("More info → Run
anyway"). Code signing is FUTURE.md — requires a paid certificate.

---

*End of ARCHITECTURE.md. Builder agent: read SPEC.md and this doc together;
this doc is binding for HOW, SPEC.md is binding for WHAT.*
