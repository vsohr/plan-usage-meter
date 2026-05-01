# TASKS — plan-usage-meter

> **For builder:** This is the binding implementation plan. Read SPEC.md for **what**, ARCHITECTURE.md for **how**, and this file for **the order of operations**. Each task has exact file paths, complete code blocks, and verification steps. Do not improvise file structure — it is locked.
>
> **Work in a worktree:** `git worktree add worktrees/initial-scaffold -b feat/initial-scaffold`. All code commits land on that branch. The five milestones map to five logical commits (or several smaller ones — frequent commits encouraged).
>
> **Sizing:** S = ≤30 min, M = 30–90 min. There are no L tasks; if something feels L, split it before starting.
>
> **Verification ladder:** every milestone ends with a runnable `npm start`. Do not advance until that step is green.

---

## Goal

Ship a Windows-only Electron desktop widget that polls Claude/Codex/Hermes plan usage every 60 seconds and renders one card per provider in a frameless, always-on-top, system-tray-resident window.

## Architecture (one-paragraph recap)

Electron 28 (Node 18, native `fetch` + `AbortController`). Main process owns polling, persistence, tray, and the single `BrowserWindow`. Renderer is vanilla JS with `contextBridge`. Detection lives in `src/usage/index.js` — a verbatim copy of `c:/claude-portal/lib/codex-usage.js`, never edited. The wrapper-based 15s timeout (`Promise.race` with a synthetic-payload resolver) is the only place timeout logic lives. Two JSON files in `app.getPath('userData')` persist `{openAtLogin}` and `{x,y,width,height}`. NSIS + portable build via electron-builder.

## Tech stack

Electron ≥28, plain CommonJS JS, electron-builder ^24, `node:test` for unit tests. Zero runtime deps. Two static binary assets: `assets/tray.png` (16×16) and `assets/icon.ico` (16/32/48/64/128/**256**).

## Risks (carried from ARCHITECTURE.md)

- **R2 — ICO size:** electron-builder rejects ICOs whose largest size <256×256. `prebuild` script asserts existence; humans must verify size on first commit.
- **R4 — Anthropic 429s:** triple-polling claude-portal + CLI + this widget can rate-limit. README must warn.
- **R5 — sandbox preload:** preload may only `require('electron')` — no Node built-ins.

---

# Milestone M1 — Scaffold & detection bridge

**Exit criteria:**
- `npm install` completes with no native rebuild and no errors (AC1).
- `npm start` opens an empty 340×180 frameless window in the bottom-right of the primary display (AC2 partial — width/position/frame-style verified).
- Main process logs the first `getAccountUsage()` payload to stdout within 2 seconds.
- Single-instance lock prevents a second `npm start` from spawning a second window (AC10).

**Tasks: 11. Estimated total: ~5–6 hours.**

---

### M1.T1 — Worktree + repo bootstrap [S]

**Depends on:** —

**Files:**
- Modify (no-op verify): `c:/git/plan-usage-meter/.gitignore`

**Steps:**

1. Create the worktree from the existing master branch:
   ```bash
   cd c:/git/plan-usage-meter
   git worktree add worktrees/initial-scaffold -b feat/initial-scaffold
   cd worktrees/initial-scaffold
   ```
2. Confirm `.gitignore` covers `node_modules/`, `dist/`, `out/`, `worktrees/`. (It already does — verify, do not rewrite.)
3. Confirm `docs/team/SPEC.md`, `ARCHITECTURE.md`, `TASKS.md`, `PROGRESS.md` are present (they are checked in on master and inherited via worktree).

**Acceptance:**
- `git status` is clean inside the new worktree.
- `git branch --show-current` prints `feat/initial-scaffold`.

**Verification:** `git status && git branch --show-current`

**Satisfies:** Project setup precondition (no AC directly).

---

### M1.T2 — `package.json` [S]

**Depends on:** M1.T1

**Files:**
- Create: `package.json`

**Complete file content:**

```json
{
  "name": "plan-usage-meter",
  "version": "0.1.0",
  "description": "Always-on-top desktop widget for Claude / Codex / Hermes plan-usage quotas.",
  "main": "src/main.js",
  "private": true,
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/",
    "prebuild": "node scripts/check-icons.js",
    "dist": "npm run prebuild && electron-builder",
    "dist:portable": "npm run prebuild && electron-builder --win portable"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.13.0"
  }
}
```

**Acceptance:**
- File parses as JSON (no trailing comma, no comments).
- `main` points at `src/main.js`.
- Five scripts present: `start`, `test`, `prebuild`, `dist`, `dist:portable`.

**Verification:** `node -e "require('./package.json')"` exits 0.

**Satisfies:** AC1, AC8.

---

### M1.T3 — `npm install` [S]

**Depends on:** M1.T2

**Files:** none (creates `package-lock.json` and `node_modules/`)

**Steps:**

1. Run `npm install`. First run downloads Electron (~100MB) — be patient.
2. Confirm zero `gyp ERR!`, zero `node-pre-gyp` output. If you see either, stop — a transitive dep has a native module and the spec forbids it.

**Acceptance:**
- `npm install` exit code 0.
- `node_modules/electron` and `node_modules/electron-builder` exist.
- `package-lock.json` created.

**Verification:** `npm install && npm ls --depth=0`

**Satisfies:** AC1.

**Parallel-safe with:** none (must complete before any task that imports electron).

---

### M1.T4 — Verbatim copy of detection module [S]

**Depends on:** M1.T1

**Files:**
- Create: `src/usage/index.js` (binary-equal copy of `c:/claude-portal/lib/codex-usage.js`)

**Steps:**

1. Create the directory: `mkdir -p src/usage`.
2. Copy verbatim using `cp` (do **not** retype, do **not** edit):
   ```bash
   cp c:/claude-portal/lib/codex-usage.js src/usage/index.js
   ```
3. Hash both files; they must match:
   ```bash
   sha256sum c:/claude-portal/lib/codex-usage.js src/usage/index.js
   ```

**Acceptance:**
- The two files have identical SHA-256 sums.
- Line count is 393 (or whatever the source currently is — must match).
- `node -e "console.log(Object.keys(require('./src/usage/index.js')))"` prints all six exported function names.

**Verification:** `node -e "const u = require('./src/usage/index.js'); console.log(typeof u.getAccountUsage)"` prints `function`.

**Satisfies:** Tech-stack constraint (no AC directly; underpins AC3, AC9, AC11, AC12).

**Parallel-safe with:** M1.T2, M1.T3, M1.T5.

---

### M1.T5 — Renderer skeleton (HTML/CSS/JS placeholders) [S]

**Depends on:** M1.T1

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles.css`
- Create: `src/renderer/renderer.js`

**`src/renderer/index.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';" />
  <title>Plan Usage Meter</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header id="header">
    <span id="title">Plan Usage Meter</span>
    <div id="controls">
      <button id="refresh" type="button" title="Refresh now">&#x21bb;</button>
      <button id="close" type="button" title="Hide window">&#x2715;</button>
    </div>
  </header>
  <main id="cards"></main>
  <script src="renderer.js"></script>
</body>
</html>
```

**`src/renderer/styles.css`** (placeholder — fully styled in M3):

```css
:root {
  --bg: rgba(20, 20, 24, 0.92);
  --border: rgba(255, 255, 255, 0.08);
  --fg: #e7e7ea;
  --muted: #9aa0a6;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: transparent; color: var(--fg); font-family: Segoe UI, Arial, sans-serif; font-size: 12px; }
body { padding: 0; overflow: hidden; }
#header {
  height: 36px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px;
  -webkit-app-region: drag;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
#header button { -webkit-app-region: no-drag; background: transparent; color: var(--fg); border: 0; cursor: pointer; font-size: 14px; padding: 4px 6px; }
#cards { background: var(--bg); padding: 8px 12px 12px; }
```

**`src/renderer/renderer.js`** (placeholder — IPC wired in M2):

```js
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  console.log('[renderer] mounted');
});
```

**Acceptance:**
- Three files created, each <50 lines.
- HTML has the cards container and the renderer.js script tag.
- CSS sets `background: transparent` on `html, body` (required for `transparent: true` window).

**Verification:** `node -e "require('fs').accessSync('src/renderer/index.html')"` exits 0; same for styles and renderer.

**Satisfies:** AC2 (window has content; empty cards container is acceptable for M1).

**Parallel-safe with:** M1.T2, M1.T3, M1.T4, M1.T6, M1.T7.

---

### M1.T6 — Preload skeleton [S]

**Depends on:** M1.T1

**Files:**
- Create: `src/preload.js`

**Complete file content (channels added in M2 — for now, expose nothing but prove the bridge loads):**

```js
'use strict';
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', Object.freeze({
  // M2 wires onUsage / refreshNow / hide / quit / reportHeight here.
  __preloadVersion: '0.1.0'
}));
```

**Acceptance:**
- File <20 lines.
- Uses only `electron` (sandbox-safe — no Node built-ins).
- `Object.freeze` applied.

**Verification:** Visual inspection. Will be exercised when window loads in M1.T8.

**Satisfies:** Architecture constraint (no AC; prerequisite for AC4, AC24).

**Parallel-safe with:** M1.T4, M1.T5.

---

### M1.T7 — Asset placeholders + icon-check script [S]

**Depends on:** M1.T1

**Files:**
- Create: `assets/tray.png` (16×16 transparent PNG, any monochrome glyph)
- Create: `assets/icon.ico` (multi-size ICO; 256×256 layer mandatory)
- Create: `scripts/check-icons.js`

**`scripts/check-icons.js`** (used by `prebuild`):

```js
'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = [
  { p: path.join('assets', 'icon.ico'), minBytes: 1024 },
  { p: path.join('assets', 'tray.png'), minBytes: 64 }
];

let failed = false;
for (const a of ASSETS) {
  try {
    const stat = fs.statSync(a.p);
    if (stat.size < a.minBytes) {
      console.error(`[check-icons] ${a.p} is too small (${stat.size} bytes < ${a.minBytes}). Replace with real artwork before dist.`);
      failed = true;
    }
  } catch (err) {
    console.error(`[check-icons] missing ${a.p}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('\n[check-icons] FAIL: required asset(s) missing or undersized.');
  console.error('See docs/team/ARCHITECTURE.md "Tray Icon Generation" for size requirements.');
  console.error('icon.ico must contain a 256x256 layer (electron-builder requirement).');
  process.exit(1);
}
console.log('[check-icons] OK');
```

**How to obtain placeholders:** the simplest workable path is to commit small static binaries. Two acceptable methods:

- **Hand-crafted (recommended):** open any image editor (Paint.NET, GIMP, online ICO converter), produce a 16×16 PNG with one solid-color square on a transparent background and save as `assets/tray.png`. For `icon.ico`, build a multi-size ICO from a 256×256 PNG using https://convertio.co/png-ico/ or `magick convert icon-256.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico` if ImageMagick is available.
- **No image tooling available:** skip programmatic generation (it would require `sharp`, which has native deps and violates AC1). Instead, use a known-good public-domain placeholder — e.g. download any 256×256 PNG of a solid color and convert with the online tool above. The pixels do not matter for v1; a non-empty multi-size ICO is the only requirement.

Document in README (M5.T6): "Replace `assets/icon.ico` and `assets/tray.png` with branded artwork before public release."

**Acceptance:**
- Both files exist on disk (`assets/tray.png` ≥ 64 bytes, `assets/icon.ico` ≥ 1024 bytes — small ICOs are usually >2 KB even with a single 256 layer).
- `scripts/check-icons.js` exits 0 when both files present, exits 1 with a clear message when either is missing.
- `assets/icon.ico` opened in Windows Explorer's preview pane shows a 256×256 layer (right-click → Properties → Details → "Bit depth"/"Width" should report 256).

**Verification:** `node scripts/check-icons.js` prints `[check-icons] OK`. Then temporarily rename `assets/icon.ico` and rerun — it must exit 1.

**Satisfies:** AC22.

**Parallel-safe with:** M1.T4, M1.T5, M1.T6.

---

### M1.T8 — `src/main.js` v0: lock + window + first poll log [M]

**Depends on:** M1.T3, M1.T4, M1.T5, M1.T6

**Files:**
- Create: `src/main.js`

**Complete file content (M1 surface — polling and IPC wiring expand in M2):**

```js
'use strict';

const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

const { getAccountUsage } = require('./usage');

// --- Single-instance lock (AC10) ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// --- Last-resort error backstops (AC23) ---
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

let win = null;

function defaultBottomRight(work) {
  const margin = 16;
  const width = 340;
  const height = 180;
  return {
    x: work.x + work.width - width - margin,
    y: work.y + work.height - height - margin,
    width,
    height
  };
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const bounds = defaultBottomRight(work);
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(async () => {
  createWindow();
  // M1 sanity poll — proves the detection bridge works end-to-end.
  // M2 replaces this with the timer + IPC broadcast.
  try {
    const usage = await getAccountUsage();
    console.log('[poll:M1] %s', JSON.stringify({
      available: usage.available,
      providers: Object.keys(usage.providers || {}),
      label: usage.label
    }));
  } catch (err) {
    console.error('[poll:M1] failed', err);
  }
});

app.on('window-all-closed', () => {
  // Tray takes over in M4 — for M1, quitting on last-window-close is fine.
  app.quit();
});
```

**Acceptance:**
- File <100 lines.
- No `require` of anything in `src/renderer/`.
- Single-instance lock at the very top, before `whenReady`.
- Window created with the locked properties: `frame:false`, `transparent:true`, `alwaysOnTop:true`, `resizable:false`, `skipTaskbar:true`, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`.

**Verification:**
1. `npm start` — within ~2s, a small dark frameless rectangle appears in the bottom-right corner of the primary display.
2. Console (terminal) prints one `[poll:M1] {...}` line within 5 seconds. The JSON contains `providers: ["codex","claude"]`.
3. Open a second terminal, run `npm start` again — no second window appears; the original window pops to front. Second `npm start` exits.
4. Right-clicking the window shows nothing (no native menu — frameless). Clicking the X glyph does nothing yet (no IPC); close the app from the terminal with Ctrl+C.

**Satisfies:** AC2, AC10, AC11 (partial — payload returns "Not detected" providers if creds missing without crashing), AC20.

---

### M1.T9 — `electron-builder.yml` [S]

**Depends on:** M1.T2

**Files:**
- Create: `electron-builder.yml`

**Complete file content:**

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
      arch:
        - x64
    - target: portable
      arch:
        - x64
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

**Acceptance:**
- YAML parses (no tab indentation; spaces only).
- `appId` exactly `com.vsohr.plan-usage-meter`.
- Both `nsis` and `portable` targets present, `arch: x64`.
- `icon: assets/icon.ico` matches the path used by `check-icons.js`.

**Verification:** `npm run dist` is the real verification, but we defer that to M5. For now, visual review.

**Satisfies:** AC8, AC22.

**Parallel-safe with:** M1.T2 onwards.

---

### M1.T10 — README stub [S]

**Depends on:** M1.T2

**Files:**
- Create: `README.md`

**Complete file content (full README delivered in M5.T6):**

```markdown
# plan-usage-meter

Always-on-top desktop widget for Claude / Codex / Hermes plan-usage quotas.

## Status: scaffold

Full README ships at end of M5. For now:

- **Prereqs:** Node 18 LTS or newer, Windows 10/11.
- **Run:** `npm install && npm start`.
- **Dist:** `npm run dist` (after M5; requires `assets/icon.ico` with a 256x256 layer).

See `docs/team/SPEC.md` for the feature spec and `docs/team/ARCHITECTURE.md` for the build design.
```

**Acceptance:** `README.md` exists at repo root, ≥ 8 lines, references SPEC and ARCHITECTURE paths.

**Verification:** `node -e "require('fs').accessSync('README.md')"` exits 0.

**Satisfies:** Documentation precondition (full coverage in M5.T6).

**Parallel-safe with:** every M1 task except M1.T1.

---

### M1.T11 — Milestone-1 smoke walkthrough [S]

**Depends on:** M1.T2..M1.T10

**Steps:**

1. From the worktree root: `npm install` exits 0, no `gyp` errors.
2. `npm start` — frameless 340-wide dark rectangle appears bottom-right.
3. Console prints `[poll:M1] ...`.
4. `npm start` again in a separate terminal — second instance exits, first window focuses.
5. Close everything (Ctrl+C the terminal hosting Electron).
6. `git add -A && git status` — review the file list. Stage and commit:
   ```
   git commit -m "feat(M1): scaffold electron app + verbatim detection bridge"
   ```

**Acceptance:** all six steps above succeed; AC1, AC2 (geometry), AC10, AC22 (script-side), AC20 verified manually.

**Verification:** the `npm start` walkthrough above plus `git log --oneline -1`.

**Satisfies:** AC1, AC2 (geometry only), AC10, AC20, AC22 (script presence).

---

# Milestone M2 — Polling & IPC

**Exit criteria:**
- Polling loop runs every 60s; first tick fires immediately on `whenReady`.
- 15s timeout wrapper substitutes the synthetic payload when `getAccountUsage()` exceeds the cap (AC19).
- `pollInFlight` flag serialises overlapping requests (AC4 anti-stampede + AC16).
- All five IPC channels round-trip: `usage:update`, `usage:refresh`, `window:hide`, `app:quit`, `window:report-height`.
- Renderer console (DevTools) prints incoming `Usage` payloads — but does not yet render cards (M3 does that).

**Tasks: 6. Estimated total: ~3.5–4.5 hours.**

---

### M2.T1 — Channel constants + main-lib helpers (`runWithTimeout`, payloads) [M]

**Depends on:** M1.T11

**Files:**
- Create: `src/main-lib.js`

**Complete file content:**

```js
'use strict';

const fs = require('fs');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height'
});

function buildTimeoutPayload(ms) {
  return {
    available: false,
    source: 'account-usage',
    label: 'AI --',
    updatedAt: new Date().toISOString(),
    providers: {
      codex:  { available: false, source: 'codex',  label: 'GPT --',    message: 'Provider timed out' },
      claude: { available: false, source: 'claude', label: 'Claude --', message: 'Provider timed out' }
    },
    errors: { timeout: `getAccountUsage exceeded ${ms}ms` },
    primary: null,
    secondary: null,
    planType: null
  };
}

function buildErrorPayload(err) {
  const message = (err && err.message) || String(err) || 'Unknown error';
  return {
    available: false,
    source: 'account-usage',
    label: 'AI --',
    updatedAt: new Date().toISOString(),
    providers: {
      codex:  { available: false, source: 'codex',  label: 'GPT --',    message },
      claude: { available: false, source: 'claude', label: 'Claude --', message }
    },
    errors: { fatal: message },
    primary: null,
    secondary: null,
    planType: null
  };
}

function runWithTimeout(fn, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(value);
    };
    const t = setTimeout(() => finish(buildTimeoutPayload(ms)), ms);
    Promise.resolve()
      .then(fn)
      .then(finish)
      .catch((err) => finish(buildErrorPayload(err)));
  });
}

function readJsonSafe(filePath, defaults) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (defaults === null) return parsed;
    return { ...defaults, ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[persist] ${filePath}: ${err.message}`);
    return defaults === null ? null : { ...defaults };
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function clampToDisplay(state, display, width = 340, fallbackHeight = 200) {
  if (!state || typeof state.x !== 'number' || typeof state.y !== 'number') return null;
  if (!display || !display.workArea) return null;
  const a = display.workArea;
  const fullyOff =
    state.x + width < a.x ||
    state.x > a.x + a.width ||
    state.y + fallbackHeight < a.y ||
    state.y > a.y + a.height;
  if (fullyOff) return null;
  return { x: state.x, y: state.y, width, height: state.height || fallbackHeight };
}

function buildTooltip(usage) {
  const providers = (usage && usage.providers) || {};
  const avail = Object.values(providers).filter((p) => p && p.available);
  if (avail.length === 0) return 'No providers detected';
  return avail.map((p) => p.label).join(' · ');
}

module.exports = {
  CH,
  buildTimeoutPayload,
  buildErrorPayload,
  runWithTimeout,
  readJsonSafe,
  writeJsonAtomic,
  clampToDisplay,
  buildTooltip
};
```

**Acceptance:**
- File <200 lines.
- Pure functions only — no `electron` import.
- All exports named.
- `runWithTimeout` resolves (never rejects).
- `readJsonSafe` returns `null` when defaults is `null` and the file is missing/malformed (AC13/AC17 fallback).

**Verification:**
```bash
node -e "const {runWithTimeout} = require('./src/main-lib'); runWithTimeout(() => new Promise(()=>{}), 100).then(p => console.log(p.errors.timeout));"
```
Expected output: `getAccountUsage exceeded 100ms`.

**Satisfies:** AC9, AC12, AC13, AC16, AC17, AC19 (helpers); AC6/AC11 helper for tooltip.

---

### M2.T2 — Wire polling loop + IPC handlers into `src/main.js` [M]

**Depends on:** M2.T1

**Files:**
- Modify: `src/main.js`

**Replace the M1 sanity poll with the full polling + IPC layer.** Complete new `src/main.js` (excluding tray and persistence — those land in M4):

```js
'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const { getAccountUsage } = require('./usage');
const { CH, runWithTimeout, clampToDisplay } = require('./main-lib');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err)    => console.error('[uncaughtException]', err));

let win = null;
let pollInFlight = false;
let pollTimer = null;
let latestUsage = null;
let resizeTimer = null;

function defaultBottomRight(work) {
  const margin = 16;
  const width = 340;
  const height = 180;
  return {
    x: work.x + work.width - width - margin,
    y: work.y + work.height - height - margin,
    width,
    height
  };
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const bounds = defaultBottomRight(work);
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.PUM_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
    if (latestUsage) win.webContents.send(CH.USAGE_UPDATE, latestUsage);
  });
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
  });
}

function broadcastUsage(usage) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(CH.USAGE_UPDATE, usage);
  }
}

async function poll() {
  if (pollInFlight) return;
  if (app.isQuitting) return;
  pollInFlight = true;
  try {
    const usage = await runWithTimeout(getAccountUsage, 15_000);
    latestUsage = usage;
    broadcastUsage(usage);
    // M4 adds: rebuildTrayMenu(); tray.setToolTip(buildTooltip(usage));
  } catch (err) {
    console.error('[poll] unexpected', err);
  } finally {
    pollInFlight = false;
  }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle(CH.USAGE_REFRESH, () => {
    if (pollInFlight) return { accepted: false };
    poll();
    return { accepted: true };
  });
  ipcMain.on(CH.WIN_HIDE,  () => { if (win) win.hide(); });
  ipcMain.on(CH.APP_QUIT,  () => { app.isQuitting = true; app.quit(); });
  ipcMain.on(CH.WIN_HEIGHT, (_e, raw) => {
    const px = Math.max(80, Math.min(1200, Math.round(Number(raw) || 0)));
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!win || win.isDestroyed()) return;
      const cur = win.getBounds();
      const newY = cur.y + (cur.height - px);
      win.setBounds({ x: cur.x, y: newY, width: 340, height: px }, false);
    }, 16);
  });

  poll();
  pollTimer = setInterval(poll, 60_000);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
});

app.on('window-all-closed', () => {
  // Tray takes over in M4. For M2, hide-not-quit is wired via win.on('close').
});

void clampToDisplay; // M4 wires this.
```

**Acceptance:**
- File ≤200 lines (will grow in M4 — keep an eye on the 350 budget).
- `pollInFlight` declared once; checked at the top of `poll()`.
- 60s interval set, first call immediate.
- All five IPC channels wired.
- `before-quit` clears the interval (AC16).

**Verification:**
1. `PUM_DEVTOOLS=1 npm start` (PowerShell: `$env:PUM_DEVTOOLS='1'; npm start`).
2. In the renderer console: `await window.api.refreshNow()` returns `{ accepted: true }`.
3. Within 60 seconds of launch, the renderer console (M2.T4) logs a second incoming payload.

**Satisfies:** AC4, AC9 (poll cadence), AC16 (clearInterval on quit), AC19 (timeout wrapper invoked).

---

### M2.T3 — Preload `window.api` surface [S]

**Depends on:** M2.T1

**Files:**
- Modify: `src/preload.js` (full rewrite)

**Complete file content:**

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height'
});

contextBridge.exposeInMainWorld('api', Object.freeze({
  onUsage(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, usage) => cb(usage);
    ipcRenderer.on(CH.USAGE_UPDATE, handler);
    return () => ipcRenderer.removeListener(CH.USAGE_UPDATE, handler);
  },
  refreshNow() { return ipcRenderer.invoke(CH.USAGE_REFRESH); },
  hide()       { ipcRenderer.send(CH.WIN_HIDE); },
  quit()       { ipcRenderer.send(CH.APP_QUIT); },
  reportHeight(px) { ipcRenderer.send(CH.WIN_HEIGHT, px); }
}));
```

**Acceptance:**
- ≤40 lines.
- `CH` duplicated here intentionally — preload is sandbox-isolated.
- `onUsage` returns an unsubscribe function.
- All five methods present.
- `Object.freeze` on the exposed object.

**Verification:** in renderer DevTools console: `Object.keys(window.api)` lists the five method names; `Object.isFrozen(window.api)` is `true`.

**Satisfies:** AC4, AC5 (hide channel), AC24 (height channel).

**Parallel-safe with:** M2.T2 (different files).

---

### M2.T4 — Renderer logs incoming payloads [S]

**Depends on:** M2.T2, M2.T3

**Files:**
- Modify: `src/renderer/renderer.js`

**Complete file content (final card rendering lands in M3 — for M2 we just verify the bridge):**

```js
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  console.log('[renderer] mounted, api keys =', Object.keys(window.api || {}));
  if (!window.api || typeof window.api.onUsage !== 'function') {
    console.error('[renderer] preload bridge missing');
    return;
  }
  window.api.onUsage((usage) => {
    console.log('[renderer:M2] usage update', usage && usage.label, Object.keys(usage?.providers || {}));
  });

  document.getElementById('refresh').addEventListener('click', async () => {
    const res = await window.api.refreshNow();
    console.log('[renderer:M2] refresh accepted =', res?.accepted);
  });
  document.getElementById('close').addEventListener('click', () => window.api.hide());
});
```

**Acceptance:**
- ≤30 lines.
- Listens for `usage:update` and logs.
- Refresh button calls `refreshNow()`; close button calls `hide()`.

**Verification:**
1. `PUM_DEVTOOLS=1 npm start`.
2. Renderer DevTools console shows `[renderer:M2] usage update` within 5s.
3. Click refresh button — log line appears with `accepted = true`.
4. Click close button — window hides.

**Satisfies:** AC4 (manual refresh round-trip), AC5 (window:hide round-trip).

**Parallel-safe with:** M2.T5.

---

### M2.T5 — Verify timeout payload synthesizes correctly [S]

**Depends on:** M2.T1

**Files:** none (verification-only)

**Steps:**

```bash
node -e "
const { runWithTimeout } = require('./src/main-lib');
runWithTimeout(() => new Promise(() => {}), 200).then(p => {
  console.log('label:', p.label);
  console.log('keys :', Object.keys(p.providers));
  console.log('codex.message:', p.providers.codex.message);
  console.log('errors.timeout:', p.errors.timeout);
});
"
```

**Acceptance:**
```
label: AI --
keys : [ 'codex', 'claude' ]
codex.message: Provider timed out
errors.timeout: getAccountUsage exceeded 200ms
```

**Satisfies:** AC19.

**Parallel-safe with:** M2.T2, M2.T3, M2.T4.

---

### M2.T6 — Milestone-2 smoke + commit [S]

**Depends on:** M2.T2, M2.T3, M2.T4, M2.T5

**Steps:**

1. `PUM_DEVTOOLS=1 npm start`.
2. Wait ~65 seconds; observe a second `[renderer:M2] usage update` log (proves 60s interval).
3. Click X — window hides. Quit Electron from terminal (Ctrl+C).
4. Commit:
   ```
   git commit -m "feat(M2): polling loop + IPC contract"
   ```

**Acceptance:** end-to-end IPC verified visually; `git log --oneline -1` shows the M2 commit.

**Verification:** the `npm start` walkthrough above.

**Satisfies:** AC4, AC9, AC16, AC19.

---

# Milestone M3 — Renderer cards & relative time

**Exit criteria:**
- Live cards render for all keys in `usage.providers`, including unavailable ones (AC3, AC11).
- Bar colours follow the 75/95 thresholds (F2).
- Relative-time strings tick every 30s without re-polling (AC18 included via "resets soon" guard).
- Window auto-resizes upward (bottom-anchored) without flicker (AC24).

**Tasks: 5. Estimated total: ~3–4 hours.**

---

### M3.T1 — Pure helpers in `src/renderer/lib.js` (importable from Node) [M]

**Depends on:** M2.T6

**Files:**
- Create: `src/renderer/lib.js`

**Complete file content:**

```js
'use strict';

function thresholdClass(usedPercent) {
  if (typeof usedPercent !== 'number' || Number.isNaN(usedPercent)) return '';
  if (usedPercent < 0) return '';
  if (usedPercent >= 95) return 'error';
  if (usedPercent >= 75) return 'warn';
  return '';
}

function clampPercent(usedPercent) {
  if (typeof usedPercent !== 'number' || Number.isNaN(usedPercent)) return 0;
  if (usedPercent < 0) return 0;
  if (usedPercent > 100) return 100;
  return usedPercent;
}

function formatResetIn(isoString, now) {
  const t0 = typeof now === 'number' ? now : Date.now();
  if (!isoString) return '—';
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return '—';
  const diffMs = t - t0;
  if (diffMs <= 60_000) return 'resets soon';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `resets in ${hours}h ${rem}m`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { thresholdClass, clampPercent, formatResetIn };
}
```

**Acceptance:**
- Pure functions, no DOM, no Electron.
- `module.exports` guarded by `typeof module` check so the same file works as a `<script>` tag in renderer and a `require()` target in `node:test`.
- `formatResetIn` returns `'resets soon'` for negative diffs (AC18).
- `thresholdClass` returns `''` for NaN/null/undefined/negative.

**Verification:**
```bash
node -e "
const {thresholdClass, formatResetIn} = require('./src/renderer/lib');
console.log(thresholdClass(50), thresholdClass(80), thresholdClass(95), thresholdClass(NaN));
console.log(formatResetIn(null), formatResetIn(new Date(Date.now()+30*60_000).toISOString()));
"
```
Expected: `'' warn error ''` followed by `— resets in 30m` (em-dash and minutes).

**Satisfies:** AC18 (helper).

---

### M3.T2 — Final `styles.css` (cards, bars, header, drag region) [M]

**Depends on:** M2.T6

**Files:**
- Modify: `src/renderer/styles.css` (full rewrite)

**Complete file content:**

```css
:root {
  --bg: rgba(20, 20, 24, 0.92);
  --bg-card: rgba(34, 34, 40, 0.85);
  --border: rgba(255, 255, 255, 0.08);
  --fg: #e7e7ea;
  --muted: #9aa0a6;
  --green: #22c55e;
  --amber: #facc15;
  --red: #ef4444;
  --radius: 8px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: transparent;
  color: var(--fg);
  font-family: "Segoe UI", system-ui, Arial, sans-serif;
  font-size: 12px;
  user-select: none;
}

body { overflow: hidden; }

#header {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  -webkit-app-region: drag;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  border-top-left-radius: var(--radius);
  border-top-right-radius: var(--radius);
}

#title { font-weight: 600; letter-spacing: 0.2px; }

#controls {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

#controls button {
  background: transparent;
  color: var(--fg);
  border: 0;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 4px;
}

#controls button:hover { background: rgba(255,255,255,0.08); }

#controls button#refresh.spinning { animation: spin 0.8s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

#cards {
  background: var(--bg);
  padding: 8px 12px 12px;
  border-bottom-left-radius: var(--radius);
  border-bottom-right-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 8px;
  will-change: contents;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card.unavailable { opacity: 0.55; }

.card .head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.card .name { font-weight: 600; font-size: 12.5px; }
.card .plan { color: var(--muted); font-size: 10.5px; }

.card .row { display: flex; flex-direction: column; gap: 3px; }
.card .row .label { display: flex; justify-content: space-between; color: var(--muted); font-size: 10.5px; }

.bar {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.06);
  overflow: hidden;
}

.bar > .fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  background: var(--green);
  border-radius: 2px;
  transition: width 200ms ease-out;
}

.bar.warn  > .fill { background: var(--amber); }
.bar.error > .fill { background: var(--red); }

.card .message { color: var(--muted); font-size: 10.5px; line-height: 1.3; }
```

**Acceptance:**
- File ≤250 lines (CLAUDE.md budget).
- Drag region applied to `#header` only; controls have `-webkit-app-region: no-drag`.
- Bar colours: green default, `.warn` amber, `.error` red.
- `html, body { background: transparent }` (matches `transparent: true`).
- `will-change: contents` on `#cards` to suppress flicker on resize (AC24 belt-and-braces).

**Verification:** visually confirmed in M3.T4.

**Satisfies:** AC2 (visual style), AC3 (card visuals), F2 (color thresholds — visual side; helper side covered in M3.T1), AC24 (compositor hint).

**Parallel-safe with:** M3.T1, M3.T3.

---

### M3.T3 — Card builder + render loop in `renderer.js` (DOM-API based) [M]

**Depends on:** M3.T1, M3.T2

**Files:**
- Modify: `src/renderer/renderer.js` (full rewrite, replacing M2 placeholder)
- Modify: `src/renderer/index.html` (add `<script src="lib.js"></script>` BEFORE `renderer.js`)

**`src/renderer/index.html`** — replace the trailing `<script src="renderer.js"></script>` line with:

```html
  <script src="lib.js"></script>
  <script src="renderer.js"></script>
```

**`src/renderer/renderer.js`** complete content. Note: cards are built using `document.createElement` + `textContent` (no innerHTML) — this is both XSS-safe and matches the project's "fail fast at boundaries" rule for any unexpected upstream content:

```js
'use strict';

let latestUsage = null;
let renderRaf = null;
let refreshInFlight = false;

const PROVIDER_DISPLAY_NAMES = {
  claude: 'Claude',
  codex:  'Codex',
  hermes: 'Hermes'
};

const PROVIDER_ORDER = ['claude', 'codex'];

function providerOrderedKeys(providers) {
  const keys = Object.keys(providers || {});
  const head = PROVIDER_ORDER.filter((k) => keys.includes(k));
  const tail = keys.filter((k) => !PROVIDER_ORDER.includes(k));
  return [...head, ...tail];
}

function el(tag, opts) {
  const node = document.createElement(tag);
  if (!opts) return node;
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.style) {
    for (const [k, v] of Object.entries(opts.style)) node.style.setProperty(k, v);
  }
  return node;
}

function buildWindowRow(w) {
  if (!w || typeof w.usedPercent !== 'number') return null;
  const pct = Math.round(clampPercent(w.usedPercent));
  const cls = thresholdClass(w.usedPercent);
  const reset = formatResetIn(w.resetsAt);

  const row = el('div', { className: 'row' });
  const label = el('div', { className: 'label' });
  label.appendChild(el('span', { text: w.label || 'Usage' }));
  label.appendChild(el('span', { text: `${pct}% · ${reset}` }));
  const bar = el('div', { className: cls ? `bar ${cls}` : 'bar' });
  const fill = el('div', { className: 'fill' });
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  row.appendChild(label);
  row.appendChild(bar);
  return row;
}

function buildCard(name, provider) {
  const display = PROVIDER_DISPLAY_NAMES[name] || name;
  const card = el('article', { className: 'card' });
  const head = el('div', { className: 'head' });
  head.appendChild(el('span', { className: 'name', text: display }));

  if (!provider || provider.available !== true) {
    card.classList.add('unavailable');
    head.appendChild(el('span', { className: 'plan', text: 'Not detected' }));
    card.appendChild(head);
    card.appendChild(el('div', { className: 'message', text: provider?.message || 'Not detected' }));
    return card;
  }

  head.appendChild(el('span', { className: 'plan', text: provider.planType || 'Plan' }));
  card.appendChild(head);

  const rows = [
    buildWindowRow(provider.primary),
    buildWindowRow(provider.secondary),
    ...(provider.details || []).map(buildWindowRow)
  ].filter(Boolean);
  for (const row of rows) card.appendChild(row);
  return card;
}

function renderCards(usage) {
  const root = document.getElementById('cards');
  if (!root) return;
  // Build the new DOM tree first, then replace in a single mutation. Single-mutation
  // replacement is what keeps the resize flicker-free (AC24).
  const next = document.createDocumentFragment();
  if (!usage || !usage.providers) {
    const placeholder = el('article', { className: 'card unavailable' });
    const head = el('div', { className: 'head' });
    head.appendChild(el('span', { className: 'name', text: 'Plan Usage Meter' }));
    head.appendChild(el('span', { className: 'plan', text: 'loading…' }));
    placeholder.appendChild(head);
    next.appendChild(placeholder);
  } else {
    for (const k of providerOrderedKeys(usage.providers)) {
      next.appendChild(buildCard(k, usage.providers[k]));
    }
  }
  // Replace children atomically.
  root.replaceChildren(next);
}

function reportHeight() {
  const h = document.body.scrollHeight;
  if (window.api && typeof window.api.reportHeight === 'function') {
    window.api.reportHeight(h);
  }
}

function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = null;
    renderCards(latestUsage);
    reportHeight();
  });
}

function setRefreshSpinning(active) {
  const btn = document.getElementById('refresh');
  if (!btn) return;
  btn.classList.toggle('spinning', !!active);
  btn.disabled = !!active;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.api) {
    console.error('[renderer] preload bridge missing');
    return;
  }
  window.api.onUsage((usage) => {
    latestUsage = usage;
    refreshInFlight = false;
    setRefreshSpinning(false);
    scheduleRender();
  });

  document.getElementById('refresh').addEventListener('click', async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    setRefreshSpinning(true);
    try {
      const res = await window.api.refreshNow();
      if (!res || res.accepted === false) {
        setTimeout(() => { refreshInFlight = false; setRefreshSpinning(false); }, 500);
      }
      // If accepted, the next 'usage:update' broadcast clears the spinner.
    } catch (err) {
      console.warn('[renderer] refresh failed', err);
      refreshInFlight = false;
      setRefreshSpinning(false);
    }
  });

  document.getElementById('close').addEventListener('click', () => window.api.hide());

  // Relative-time tick: re-render every 30s without re-polling (F2/AC18).
  setInterval(() => { if (latestUsage) scheduleRender(); }, 30_000);

  scheduleRender();
});
```

**Acceptance:**
- File ≤300 lines (budget).
- `renderCards` iterates `Object.keys(usage.providers)`, not a hardcoded list (AC3, AC11).
- Unavailable card carries `provider.message` (AC11, AC12).
- All dynamic strings written via `textContent` — no `innerHTML` anywhere (XSS-safe by construction; satisfies AC23 console-clean rule under any future security audit).
- Bar fill width clamped via `clampPercent` (defensive against >100 from upstream).
- Relative-time tick uses `setInterval(30_000)` and only re-renders, never re-polls.
- `replaceChildren(fragment)` is the single-mutation swap that prevents resize flicker (AC24).
- Refresh spinner state managed both for `accepted: true` (cleared by `usage:update` push) and `accepted: false` (timeout reset after 500ms).

**Verification:**
1. `PUM_DEVTOOLS=1 npm start`.
2. Within 5s, two cards render: Claude and Codex (or both as "Not detected" depending on local creds).
3. With at least one available provider: bars appear with the correct colour for the percentage. Hover the title region — cursor stays default (drag region). Cursor over the buttons — clickable.
4. Click refresh — refresh icon spins; within 1–2s, payload returns and spinner stops.
5. Click X — window hides.
6. Wait 30s with the window open: relative-time strings tick (e.g. `resets in 12m` → `resets in 11m`). Confirm no `[poll]` log in the main terminal during the 30s tick (proves the renderer ticks without re-polling).

**Satisfies:** AC3, AC11, AC12, AC18, AC23 (XSS-safe DOM construction), AC24 (atomic replaceChildren).

---

### M3.T4 — Auto-resize without flicker [S]

**Depends on:** M3.T3

**Steps:**

1. Confirm the M2 handler in `main.js` resizes from the bottom anchor: `newY = cur.y + (cur.height - px)`.
2. Confirm `setBounds(..., false)` is called with `animate: false`.
3. In renderer, ensure `reportHeight()` is invoked **after** DOM replacement (it is — inside `scheduleRender`'s `requestAnimationFrame`).
4. Visual check: with two available providers + secondary + details, the window grows upward. With one "Not detected" + one available, it shrinks. No white flash.
5. Belt and braces: `will-change: contents` on `#cards` (added in M3.T2) tells the compositor to keep the layer opaque during paint.

**Acceptance:**
- Two consecutive `usage:update` events with different content heights — window's bottom edge stays pinned, top edge moves.
- No white/blank/dark flash at the resize moment.
- Resize completes within 16ms perceived (single frame).

**Verification:** record the screen for 5 seconds while triggering a manual refresh; play back at 0.25× speed; confirm no flash.

**Satisfies:** AC24.

**Parallel-safe with:** M3.T5.

---

### M3.T5 — Milestone-3 smoke + commit [S]

**Depends on:** M3.T1..M3.T4

**Steps:**

1. `npm start` (no DevTools needed for smoke — clean run).
2. With Claude+Codex creds present: two available cards render with bars, percentages, plan label, and a relative-time string per row.
3. With creds removed (rename `~/.codex/auth.json` aside): two "Not detected" cards render with the upstream `message`.
4. Restore creds; within 60s the next poll restores the available state (AC9 partial — full network test in M5).
5. Wait 30s without touching anything: the relative-time strings tick down.
6. Click refresh repeatedly: spinner runs; second click while spinner is active is ignored.
7. Commit:
   ```
   git commit -m "feat(M3): renderer cards + relative-time tick"
   ```

**Acceptance:** all six steps green.

**Satisfies:** AC3, AC9 (partial), AC11, AC12, AC18, AC24.

---

# Milestone M4 — Tray, persistence, and edge cases

**Exit criteria:**
- Tray icon present, tooltip updates each poll, context menu rebuilt each poll, single-click toggles window with 250ms debounce (AC5, AC6, AC15).
- Closing window hides (does not quit); only tray Quit exits the process (AC5).
- Open at login persists across restarts via `userData/settings.json` and `app.setLoginItemSettings({ openAtLogin, openAsHidden: true })` (AC7).
- Window position persists in `userData/window-state.json`; saved-position-off-screen falls back to default (AC13, AC14, AC17, AC21).
- Quit-during-in-flight-poll exits within 1 second (AC16).

**Tasks: 8. Estimated total: ~5–6 hours.**

---

### M4.T1 — Persistence wiring (settings + window-state read) [M]

**Depends on:** M3.T5

**Files:**
- Modify: `src/main.js` (top-of-file plumbing)

**Patch — extend the `require` block and add helpers:**

```js
const fs = require('fs');
const {
  CH,
  runWithTimeout,
  clampToDisplay,
  readJsonSafe,
  writeJsonAtomic,
  buildTooltip
} = require('./main-lib');

let settings = { openAtLogin: false };
let settingsPath = null;
let windowStatePath = null;
let saveStateTimer = null;

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  settings = readJsonSafe(settingsPath, { openAtLogin: false });
}

function saveSettings() {
  if (!settingsPath) return;
  try {
    writeJsonAtomic(settingsPath, settings);
  } catch (err) {
    console.warn('[settings] save failed:', err.message);
  }
}

function loadWindowState() {
  windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  return readJsonSafe(windowStatePath, null);
}

function saveWindowState() {
  if (!win || win.isDestroyed() || !windowStatePath) return;
  try {
    const b = win.getBounds();
    writeJsonAtomic(windowStatePath, { x: b.x, y: b.y, width: 340, height: b.height });
  } catch (err) {
    console.warn('[window-state] save failed:', err.message);
  }
}

function scheduleWindowStateSave() {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    saveWindowState();
  }, 500);
}
```

**Acceptance:**
- `loadSettings()` returns `{ openAtLogin: false }` when file missing.
- `loadWindowState()` returns `null` when file missing or malformed (per `readJsonSafe`'s null-defaults branch added in M2.T1).
- `saveWindowState` debounced 500ms; called on every `move`/`resize` event but FS hits at most once per debounce window.

**Verification:** open `app.getPath('userData')` (Windows: `%APPDATA%/plan-usage-meter/`) — drag window, wait, observe `window-state.json` updated.

**Satisfies:** AC13, AC17 (read paths).

---

### M4.T2 — Apply window state on launch with off-screen fallback [M]

**Depends on:** M4.T1

**Files:**
- Modify: `src/main.js` (`createWindow` body)

**Replace** the M2 `createWindow` body with:

```js
function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const saved = loadWindowState();
  let bounds = null;
  if (saved) {
    const display = screen.getDisplayMatching({
      x: saved.x ?? 0,
      y: saved.y ?? 0,
      width: 340,
      height: saved.height || 200
    });
    bounds = clampToDisplay(saved, display);
  }
  if (!bounds) bounds = defaultBottomRight(work);

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.PUM_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
    if (latestUsage) win.webContents.send(CH.USAGE_UPDATE, latestUsage);
  });
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('moved',   scheduleWindowStateSave);
  win.on('resized', scheduleWindowStateSave);
}
```

**Acceptance:**
- Saved x/y inside any display's work area — window restores there.
- Saved x/y fully outside all displays — falls back to `defaultBottomRight` of the primary display (AC13).
- `move` and `resize` events trigger debounced save (AC13 round-trip).

**Verification:**
1. `npm start`, drag window to top-left, quit.
2. Re-open: window restores to top-left.
3. Stop the app. Edit `%APPDATA%/plan-usage-meter/window-state.json` to `{"x":-9999,"y":-9999,"width":340,"height":200}`. Save.
4. Re-open: window appears at the default bottom-right, not off-screen.

**Satisfies:** AC13, AC14, AC17, AC21.

---

### M4.T3 — Tray with menu, tooltip, and click debounce [M]

**Depends on:** M4.T2

**Files:**
- Modify: `src/main.js` (extend the `electron` require + add tray glue)

**Patch — update the electron require to include Tray/Menu/nativeImage:**

```js
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
```

**Patch — add helpers and tray glue:**

```js
let tray = null;

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) return;
    t = setTimeout(() => { t = null; }, ms);
    fn(...args);
  };
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

function setOpenAtLogin(value) {
  const desired = !!value;
  try {
    app.setLoginItemSettings({
      openAtLogin: desired,
      openAsHidden: true,
      args: desired ? ['--hidden'] : []
    });
    settings.openAtLogin = desired;
  } catch (err) {
    console.warn('[setOpenAtLogin] failed:', err.message);
    // Leave settings.openAtLogin unchanged so the menu reflects reality.
  }
  saveSettings();
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const visible = !!(win && win.isVisible());
  const template = [
    { label: visible ? 'Hide' : 'Show', click: toggleWindow },
    { label: 'Refresh now', click: () => poll() },
    { type: 'separator' },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: !!settings.openAtLogin,
      click: (item) => setOpenAtLogin(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const trayPath = path.join(__dirname, '..', 'assets', 'tray.png');
  let image;
  try {
    image = nativeImage.createFromPath(trayPath);
    if (image.isEmpty()) throw new Error('tray.png decoded to empty image');
  } catch (err) {
    console.warn('[tray] failed to load icon:', err.message);
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('Plan Usage Meter');
  tray.on('click', debounce(toggleWindow, 250));
  rebuildTrayMenu();
}
```

**Patch — extend `poll()` to update tray:**

```js
async function poll() {
  if (pollInFlight) return;
  if (app.isQuitting) return;
  pollInFlight = true;
  try {
    const usage = await runWithTimeout(getAccountUsage, 15_000);
    latestUsage = usage;
    broadcastUsage(usage);
    if (tray) {
      tray.setToolTip(buildTooltip(usage));
      rebuildTrayMenu();
    }
  } catch (err) {
    console.error('[poll] unexpected', err);
  } finally {
    pollInFlight = false;
  }
}
```

**Patch — extend `whenReady` and `before-quit`:**

```js
app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  // Re-assert login item from persisted setting on every launch (defensive).
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.openAtLogin,
      openAsHidden: true,
      args: settings.openAtLogin ? ['--hidden'] : []
    });
  } catch (err) {
    console.warn('[setLoginItemSettings] init failed:', err.message);
  }

  ipcMain.handle(CH.USAGE_REFRESH, () => {
    if (pollInFlight) return { accepted: false };
    poll();
    return { accepted: true };
  });
  ipcMain.on(CH.WIN_HIDE,  () => { if (win) win.hide(); });
  ipcMain.on(CH.APP_QUIT,  () => { app.isQuitting = true; app.quit(); });
  ipcMain.on(CH.WIN_HEIGHT, (_e, raw) => {
    const px = Math.max(80, Math.min(1200, Math.round(Number(raw) || 0)));
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!win || win.isDestroyed()) return;
      const cur = win.getBounds();
      const newY = cur.y + (cur.height - px);
      win.setBounds({ x: cur.x, y: newY, width: 340, height: px }, false);
    }, 16);
  });

  poll();
  pollTimer = setInterval(poll, 60_000);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveWindowState();
  if (tray) { tray.destroy(); tray = null; }
});
```

**Patch — replace `app.on('window-all-closed', ...)`:**

```js
app.on('window-all-closed', () => {
  // Tray-only presence: do NOT quit on window close.
  // Process exits only via the tray "Quit" menu (sets app.isQuitting and calls app.quit()).
});
```

**Acceptance:**
- Tray icon appears in the Windows system tray on launch.
- Right-click — 4-item menu (Show/Hide, Refresh now, Open at login, Quit) plus separators.
- Single-click tray toggles window visibility (debounced 250ms).
- Tooltip on hover shows compact summary — "No providers detected" if none, otherwise " · "-joined labels.
- Closing the window via X hides it; tray Quit fully exits.
- Open at login toggle persists across launches.

**Verification:**
1. `npm start`. Tray icon present.
2. Hover tray — tooltip reads e.g. `Claude 42% · GPT 67%` (with creds) or `No providers detected` (without).
3. Right-click — 4 actions visible. Click "Refresh now" — within 1s a poll fires.
4. Tick "Open at login". Open Task Manager → Startup tab. Find "Plan Usage Meter" — Status = Enabled.
5. Click X on the window — window hides, tray icon stays.
6. Single-click tray — window reappears.
7. Right-click tray → Quit. Process exits within 1s.

**Satisfies:** AC5, AC6, AC7, AC11 (tooltip side), AC15, AC16.

---

### M4.T4 — Quit-during-in-flight-poll [S]

**Depends on:** M4.T3

**Steps:**

1. Confirm `poll()`'s top guard checks `if (app.isQuitting) return;` (it does).
2. Confirm `before-quit` clears `pollTimer` (it does).
3. Confirm there is no `await poll()` anywhere (timer fires `poll` fire-and-forget).

**To prove AC16 manually:**

1. Add a temporary `await new Promise(r => setTimeout(r, 5000));` to the *very first line* of `getAccountUsage` in `src/usage/index.js` (DO NOT COMMIT — verbatim policy is binding).
2. `npm start`. Within the first 5 seconds (during the artificial delay), right-click tray → Quit.
3. Process should exit within 1 second; no `unhandledRejection` log.
4. Revert the temp edit. Confirm `git diff src/usage/index.js` is empty.

**Acceptance:** the manual experiment above ends within 1 second; main stdout shows no rejection log.

**Satisfies:** AC16.

---

### M4.T5 — Negative resets-in / clock skew guard [S]

**Depends on:** M3.T1

**Files:** none (already handled by `formatResetIn`).

**Steps:**

1. Confirm `formatResetIn` returns `'resets soon'` for `diffMs <= 60_000` (which includes all negative values). It does (M3.T1).
2. In renderer DevTools console: `formatResetIn(new Date(Date.now() - 3*60_000).toISOString())` returns `resets soon`.
3. Confirm bar fill renders despite negative resets-in: `clampPercent` returns the percentage independently of the timestamp.

**Acceptance:** rendering with a past `resetsAt` yields a card with the bar filled and a "resets soon" subtitle. No NaN, no `-3m`, no "Invalid Date".

**Satisfies:** AC18.

---

### M4.T6 — Catastrophic `getAccountUsage` failure path [S]

**Depends on:** M2.T1

**Files:** none (handled by `runWithTimeout`'s `.catch(buildErrorPayload)`).

**Steps:**

1. Confirm `runWithTimeout` catches synchronous throws via `Promise.resolve().then(fn)` (it does).
2. Confirm rejected promise yields a renderable Usage shape via `buildErrorPayload` (it does).
3. Renderer's `buildCard` already handles `provider.available === false` with a "Not detected" / message card.

**Manual test (DO NOT COMMIT):**

1. Temporarily prepend to `getAccountUsage` in `src/usage/index.js`: `throw new Error('test catastrophic');`.
2. `npm start`. Both cards show "Not detected" with message `test catastrophic`.
3. Revert. `git diff` empty.

**Acceptance:** widget does not crash on `getAccountUsage` throw; both cards render in their unavailable state with the thrown message.

**Satisfies:** AC9 (catastrophic side), AC12.

---

### M4.T7 — Settings.json edge cases [S]

**Depends on:** M4.T1

**Steps:**

1. Run app with no `settings.json` — opens with `openAtLogin: false`, no error (AC17).
2. Stop app, delete `settings.json`, restart — same as 1.
3. Stop app, write `settings.json` with malformed JSON (`{"openAtLogin":` ), restart — `console.warn "[persist] ..."`, widget runs with default `openAtLogin: false`, file is NOT clobbered until next legitimate set.
4. Toggle Open at login — file is now valid.

**Acceptance:** all four scenarios pass.

**Satisfies:** AC17.

**Parallel-safe with:** M4.T5, M4.T6.

---

### M4.T8 — Milestone-4 smoke walkthrough + commit [S]

**Depends on:** M4.T1..M4.T7

**Steps:**

1. `npm start`. Confirm: tray icon, tooltip, 4-item menu, close-to-tray, single-click toggle, refresh, Open at login persistence (full reboot test deferred to M5.T7), window-position persistence (drag → quit → relaunch → restored).
2. Off-screen recovery: edit `window-state.json` x to `-9999`, relaunch — window opens at default position.
3. Network-off: disable network, wait 60s — both cards flip to "Not detected" with the upstream error message. Re-enable; within 60s cards restore.
4. Commit:
   ```
   git commit -m "feat(M4): tray + persistence + edge cases"
   ```

**Acceptance:** the four scenarios pass; commit lands.

**Satisfies:** AC5, AC6, AC7, AC9, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC21.

---

# Milestone M5 — Tests, build, README, polish

**Exit criteria:**
- `npm test` runs three `node:test` files green (color thresholds, relative time, clamp-bounds).
- `npm run dist` produces both NSIS and portable `.exe` files (AC8).
- `prebuild` script fails loudly when `assets/icon.ico` is missing (AC22).
- README is the public 1-page quickstart (AC1, AC8, AC22 documented).
- Final smoke run passes AC23 (zero console errors on a clean walkthrough).

**Tasks: 7. Estimated total: ~3.5–4 hours.**

---

### M5.T1 — Test: `tests/color-thresholds.test.js` [S]

**Depends on:** M3.T1

**Files:**
- Create: `tests/color-thresholds.test.js`

**Complete file content:**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { thresholdClass } = require('../src/renderer/lib');

test('thresholdClass: <75 returns empty', () => {
  assert.strictEqual(thresholdClass(0), '');
  assert.strictEqual(thresholdClass(50), '');
  assert.strictEqual(thresholdClass(74.9), '');
});

test('thresholdClass: 75..95 returns warn', () => {
  assert.strictEqual(thresholdClass(75), 'warn');
  assert.strictEqual(thresholdClass(85), 'warn');
  assert.strictEqual(thresholdClass(94.9), 'warn');
});

test('thresholdClass: >=95 returns error', () => {
  assert.strictEqual(thresholdClass(95), 'error');
  assert.strictEqual(thresholdClass(100), 'error');
  assert.strictEqual(thresholdClass(150), 'error');
});

test('thresholdClass: invalid input returns empty', () => {
  assert.strictEqual(thresholdClass(NaN), '');
  assert.strictEqual(thresholdClass(null), '');
  assert.strictEqual(thresholdClass(undefined), '');
  assert.strictEqual(thresholdClass(-5), '');
  assert.strictEqual(thresholdClass('80'), '');
});
```

**Verification:** `node --test tests/color-thresholds.test.js` — all green.

**Satisfies:** F2 (test-side).

**Parallel-safe with:** M5.T2, M5.T3.

---

### M5.T2 — Test: `tests/relative-time.test.js` [S]

**Depends on:** M3.T1

**Files:**
- Create: `tests/relative-time.test.js`

**Complete file content:**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatResetIn } = require('../src/renderer/lib');

const NOW = Date.parse('2026-05-01T12:00:00Z');
const EM_DASH = '—';

test('formatResetIn: null/empty returns em-dash', () => {
  assert.strictEqual(formatResetIn(null, NOW), EM_DASH);
  assert.strictEqual(formatResetIn('', NOW), EM_DASH);
  assert.strictEqual(formatResetIn(undefined, NOW), EM_DASH);
});

test('formatResetIn: invalid date returns em-dash', () => {
  assert.strictEqual(formatResetIn('not-a-date', NOW), EM_DASH);
});

test('formatResetIn: past timestamp returns "resets soon"', () => {
  const past = new Date(NOW - 5 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(past, NOW), 'resets soon');
});

test('formatResetIn: <=60s in the future returns "resets soon" (AC18)', () => {
  const tenSec = new Date(NOW + 10_000).toISOString();
  assert.strictEqual(formatResetIn(tenSec, NOW), 'resets soon');
});

test('formatResetIn: <60min in the future returns minutes', () => {
  const t30 = new Date(NOW + 30 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t30, NOW), 'resets in 30m');
});

test('formatResetIn: >=60min returns h+m', () => {
  const t = new Date(NOW + (3 * 60 + 12) * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t, NOW), 'resets in 3h 12m');
});

test('formatResetIn: exact-hour rolls over cleanly', () => {
  const t = new Date(NOW + 60 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t, NOW), 'resets in 1h 0m');
});
```

**Verification:** `node --test tests/relative-time.test.js` — all green.

**Satisfies:** AC18 (test-side).

**Parallel-safe with:** M5.T1, M5.T3.

---

### M5.T3 — Test: `tests/clamp-bounds.test.js` [S]

**Depends on:** M2.T1

**Files:**
- Create: `tests/clamp-bounds.test.js`

**Complete file content:**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { clampToDisplay } = require('../src/main-lib');

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

test('clampToDisplay: null state returns null', () => {
  assert.strictEqual(clampToDisplay(null, display), null);
});

test('clampToDisplay: missing x or y returns null', () => {
  assert.strictEqual(clampToDisplay({ y: 100 }, display), null);
  assert.strictEqual(clampToDisplay({ x: 100 }, display), null);
});

test('clampToDisplay: fully inside returns same x/y', () => {
  const r = clampToDisplay({ x: 100, y: 100, width: 340, height: 200 }, display);
  assert.deepStrictEqual(r, { x: 100, y: 100, width: 340, height: 200 });
});

test('clampToDisplay: off-screen left returns null', () => {
  assert.strictEqual(clampToDisplay({ x: -500, y: 100, height: 200 }, display), null);
});

test('clampToDisplay: off-screen right returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 5000, y: 100, height: 200 }, display), null);
});

test('clampToDisplay: off-screen top returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: -500, height: 200 }, display), null);
});

test('clampToDisplay: off-screen bottom returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: 5000, height: 200 }, display), null);
});

test('clampToDisplay: width forced to 340', () => {
  const r = clampToDisplay({ x: 50, y: 50, width: 999, height: 200 }, display);
  assert.strictEqual(r.width, 340);
});

test('clampToDisplay: missing height defaults to 200', () => {
  const r = clampToDisplay({ x: 50, y: 50 }, display);
  assert.strictEqual(r.height, 200);
});

test('clampToDisplay: null display returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: 100, height: 200 }, null), null);
});
```

**Verification:** `node --test tests/clamp-bounds.test.js` — all green.

**Satisfies:** AC13, AC14 (test-side).

**Parallel-safe with:** M5.T1, M5.T2.

---

### M5.T4 — Run full test suite & wire `npm test` [S]

**Depends on:** M5.T1, M5.T2, M5.T3

**Files:** none (script already in `package.json` from M1.T2).

**Steps:**

1. `npm test` — all three files run, all assertions pass.
2. Output ends with a TAP summary like `# pass 18  # fail 0`.

**Acceptance:** `npm test` exit code 0; ≥18 passing assertions across the three files.

**Verification:** `npm test`.

**Satisfies:** AC18, AC13, AC14, F2 (suite is the harness).

---

### M5.T5 — Build dist + verify both targets [M]

**Depends on:** M4.T8, M5.T4

**Steps:**

1. Confirm `assets/icon.ico` is present and valid (256-layer). Confirm `assets/tray.png` is present.
2. `npm run dist`. First run downloads the Electron framework cache (~150MB).
3. Wait for completion. Inspect `dist/`:
   - `Plan Usage Meter Setup 0.1.0.exe` — NSIS installer.
   - `Plan Usage Meter-0.1.0-portable.exe` — portable.
4. Run the NSIS installer in a sandbox / VM if available; otherwise install to a non-Program-Files folder. Verify:
   - Installed app's tray icon is the configured `assets/icon.ico` (NOT the default Electron diamond) (AC22).
   - First poll completes; cards render.
5. Run the portable `.exe` directly (no install). Same behavior.
6. Loud-failure check (AC22):
   - `mv assets/icon.ico assets/icon.ico.bak`
   - `npm run dist`
   - Expected: `prebuild` exits 1 with a clear error pointing at `assets/icon.ico`. Build does NOT proceed.
   - Restore: `mv assets/icon.ico.bak assets/icon.ico`.

**Acceptance:** both `.exe` files in `dist/` work; loud-failure check passes.

**Satisfies:** AC8, AC22.

---

### M5.T6 — Final README [M]

**Depends on:** M5.T5

**Files:**
- Modify: `README.md` (full rewrite)

**Complete file content:**

```markdown
# Plan Usage Meter

Always-on-top Windows desktop widget showing live plan-usage quotas for Claude, OpenAI Codex (ChatGPT), and Hermes — one card per provider, in your system tray.

## Prerequisites

- **OS:** Windows 11 (Windows 10 is best-effort).
- **Node:** 18 LTS or newer.
- **Build tools:** none. `npm install` runs without native rebuilds.
- **Credentials (optional, per provider):**
  - Claude — `~/.claude/.credentials.json` (created by Claude Code CLI on login).
  - Codex — `~/.codex/auth.json` (created by Codex CLI), or `~/.codex/sessions/*.jsonl` log fallback.
  - Hermes — WSL with `~/.hermes/hermes-agent/` set up. Optional; absence is not an error.

If a credential file is missing, the corresponding card shows "Not detected" with the path it looked for. The widget is useful as a config diagnostic on a fresh machine.

## Run from source

```cmd
git clone <repo>
cd plan-usage-meter
npm install
npm start
```

A 340-pixel-wide frameless window appears in the bottom-right corner of your primary display. The tray icon is your persistent affordance — closing the window with X *hides* it (it does not quit). Use **tray → Quit** to exit.

## Build

```cmd
npm run dist            :: NSIS installer + portable .exe
npm run dist:portable   :: portable only
```

Outputs land in `dist/`. The build expects `assets/icon.ico` to exist and contain a 256x256 layer (electron-builder requirement). The `prebuild` script fails loudly if `assets/icon.ico` is missing.

The build is unsigned. Windows SmartScreen will warn on first install — click "More info → Run anyway".

## Features

- Auto-detects Claude / Codex / Hermes from local credentials.
- Polls every 60 seconds; each call has a 15s wall-clock timeout.
- Manual refresh from the in-window button or tray menu.
- "Not detected" cards explain exactly what's missing.
- Tray tooltip: compact one-liner, e.g. `Claude 42% · GPT 67%`.
- Open at login (with `--hidden`, so no window flash on boot).
- Single-instance lock: a second launch focuses the existing window.
- Position remembered across launches; falls back if the saved spot is off-screen.

## Configuration

There is no settings UI. Two state files live in `%APPDATA%/plan-usage-meter/`:
- `settings.json` — `{ openAtLogin: boolean }`.
- `window-state.json` — `{ x, y, width, height }`.

Both are written atomically (tmp + rename). Delete either file to reset; the app recreates them on the next save.

## Troubleshooting

- **All cards say "Not detected":** no credential files were found. Use the relevant CLI to log in (e.g. `claude login`, `codex login`).
- **Claude card shows "HTTP 401":** OAuth token expired. Re-run `claude login`.
- **Hermes card not shown:** expected if you don't run Hermes — the widget falls through to Codex live API and Codex log fallback.
- **Tray icon missing:** check that `assets/tray.png` is on disk (in dev) or that the install was not corrupted (in dist).
- **Window appears off-screen after monitor change:** delete `%APPDATA%/plan-usage-meter/window-state.json` and relaunch.
- **Multiple polling apps:** if you also run claude-portal's embedded usage meter or `claude usage`, you may hit Anthropic 429 rate limits. Stop the others while testing.

## Console policy

A clean run produces zero console errors and zero unhandled promise rejections (AC23). Run with the `PUM_DEVTOOLS` environment variable to open renderer DevTools:
- PowerShell: `$env:PUM_DEVTOOLS='1'; npm start`
- cmd:        `set PUM_DEVTOOLS=1 && npm start`

## Repository layout

- `src/main.js` — Electron main process (window, tray, polling, IPC).
- `src/preload.js` — context-isolation bridge.
- `src/usage/index.js` — verbatim copy of `claude-portal/lib/codex-usage.js`. Read-only by convention.
- `src/main-lib.js` — pure helpers (timeout, persistence, clamp).
- `src/renderer/{index.html,styles.css,renderer.js,lib.js}` — the UI.
- `tests/` — `node:test` unit tests.
- `electron-builder.yml` — distribution config.

## License

Internal. See `docs/team/SPEC.md` for the v1 product brief and `docs/team/ARCHITECTURE.md` for the build design.
```

**Acceptance:**
- README ≤2 pages rendered.
- Covers: prereqs, install, run, build, features, configuration, troubleshooting (incl. SmartScreen + 429 + missing icon), repo layout.
- Mentions `PUM_DEVTOOLS=1` env in both PowerShell and cmd forms.

**Verification:** open in a Markdown viewer; lint visually.

**Satisfies:** AC1 (documented), AC8 (documented), AC22 (documented), AC23 (documented), R6 (mitigation referenced).

**Parallel-safe with:** M5.T7.

---

### M5.T7 — Final smoke walkthrough (AC1–AC24) + commit [M]

**Depends on:** M5.T5, M5.T6

**Steps:** Run through every AC. Pass/fail noted; fail-state requires a fix and re-run.

| AC | Action | Expected |
|---|---|---|
| AC1 | Fresh `node_modules`: `rm -rf node_modules && npm install` | Exit 0, no `gyp ERR!` |
| AC2 | `npm start` | 340px frameless window, bottom-right, 16px margin |
| AC3 | Inspect cards | One card per `Object.keys(usage.providers)`; available cards have plan + bars; unavailable cards show message |
| AC4 | Wait 60s; click in-window refresh; tray → Refresh now | All three trigger polls; cards update |
| AC5 | Click X; right-click tray | Window hides; menu has Show/Hide, Refresh now, Open at login (checkbox), Quit |
| AC6 | Hover tray | `Claude X% · GPT Y%` (omits unavailable) |
| AC7 | Tick Open at login; reboot Windows | App starts into tray, no window flash, checkbox still ticked |
| AC8 | `npm run dist` | `dist/` has NSIS .exe + portable .exe |
| AC9 | Disable network → wait 60s; re-enable → wait 60s | Cards flip to unavailable then restore |
| AC10 | Run `npm start` while running | Original window focuses; no second instance |
| AC11 | Move all credential files aside; restart | Both cards "Not detected"; tooltip "No providers detected"; zero console errors |
| AC12 | Edit `~/.claude/.credentials.json` to be invalid JSON; restart; wait | Claude card "Not detected" with parse-error message; Codex unaffected |
| AC13 | Edit `window-state.json` to off-screen coords; restart | Window opens at default bottom-right |
| AC14 | Single-monitor run-through | All ACs above pass on a one-display machine |
| AC15 | Rapidly click tray ~10 times | Settles to either fully shown or fully hidden; no stuck state |
| AC16 | (Optional manual: temp 5s delay in getAccountUsage) Quit during in-flight | Exits within 1s; no rejection log |
| AC17 | Delete `settings.json`; restart | Defaults applied; no error |
| AC18 | (DevTools) `formatResetIn(<past>)` | `'resets soon'` |
| AC19 | (Optional manual: temp 20s hang in getAccountUsage) Wait 16s | Cards flip to "Provider timed out"; next poll proceeds |
| AC20 | Run as a user whose %USERPROFILE% is non-default | Credentials read from `process.env.USERPROFILE` (already in copied module) |
| AC21 | Set display scaling to 150%; restart | 340px logical width preserved; position restores |
| AC22 | Rename `assets/icon.ico` aside; `npm run dist` | Build fails loudly; restore the file — succeeds |
| AC23 | DevTools console + main stdout during a full walk | Zero errors, zero unhandled rejections |
| AC24 | Trigger height change (resize details list) | No flash; perceived single-frame resize |

**Commit:**

```
git commit -m "feat(M5): tests, dist, README, AC walkthrough green"
```

**Acceptance:** every AC ticks. Any fail — fix and re-run before commit.

**Satisfies:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24 (final verification gate).

---

# AC Coverage Matrix

| AC | Title | Tasks that satisfy it |
|---|---|---|
| AC1 | `npm install` clean | M1.T2, M1.T3, M5.T6 (docs), M5.T7 (final verify) |
| AC2 | `npm start` opens widget | M1.T8, M3.T2 (visual), M5.T7 |
| AC3 | Renders all providers | M3.T3, M5.T7 |
| AC4 | Polling and manual refresh | M2.T2, M2.T3, M2.T4, M3.T3, M4.T3 (tray Refresh now), M5.T7 |
| AC5 | Close-to-tray and tray menu | M2.T2 (close), M4.T3 (tray + Quit), M5.T7 |
| AC6 | Tray tooltip | M2.T1 (`buildTooltip`), M4.T3 (wired), M5.T7 |
| AC7 | Open at login persistence | M4.T1 (load), M4.T3 (apply + persist), M5.T7 |
| AC8 | `npm run dist` | M1.T2 (script), M1.T9 (config), M5.T5, M5.T6 (docs), M5.T7 |
| AC9 | Network failure handling | M2.T1 (`buildErrorPayload`), M2.T2 (poll cadence), M4.T8 (manual test), M5.T7 |
| AC10 | Single-instance lock | M1.T8, M5.T7 |
| AC11 | First launch with zero credentials | M1.T8 (no crash), M3.T3 (Not detected card), M2.T1 + M4.T3 (tooltip "No providers detected"), M5.T7 |
| AC12 | Expired/invalid credentials | M3.T3 (`provider.message`), M4.T6 (catastrophic catch), M5.T7 |
| AC13 | Saved position off-screen | M2.T1 (`clampToDisplay`), M4.T2 (apply on launch), M5.T3 (test), M5.T7 |
| AC14 | Single display only | M4.T2 (uses `getPrimaryDisplay`), M5.T3 (test), M5.T7 |
| AC15 | Tray click debounce | M4.T3 (`debounce(toggleWindow, 250)`), M5.T7 |
| AC16 | Quit during in-flight poll | M2.T1 (timeout never throws), M2.T2 (`pollInFlight` + `isQuitting` guard, clearInterval on `before-quit`), M4.T4, M5.T7 |
| AC17 | Manually deleted settings.json | M2.T1 (`readJsonSafe` ENOENT branch), M4.T1 (load), M4.T7, M5.T7 |
| AC18 | Clock skew / negative resets-in | M3.T1 (`formatResetIn` "resets soon"), M4.T5, M5.T2 (test), M5.T7 |
| AC19 | Per-poll timeout | M2.T1 (`runWithTimeout`, `buildTimeoutPayload`), M2.T5, M5.T7 |
| AC20 | Non-default %USERPROFILE% | M1.T4 (verbatim copy uses `process.env.USERPROFILE`), M4.T1 (`app.getPath('userData')`), M5.T7 |
| AC21 | DPI scaling | M4.T2 (logical pixels via Electron), M5.T7 |
| AC22 | App icon present + loud build failure | M1.T7 (`scripts/check-icons.js`), M1.T9 (electron-builder.yml icon), M5.T5, M5.T7 |
| AC23 | No console errors on clean run | M1.T8 (`process.on('unhandledRejection')`), M3.T3 (defensive renderer + DOM-API construction), M5.T7 |
| AC24 | No flicker on auto-resize | M2.T2 (bottom-anchored `setBounds(..., false)`), M3.T2 (`will-change: contents`), M3.T3 (rAF-batched `replaceChildren`), M3.T4, M5.T7 |

**Coverage status:** all 24 ACs covered by at least one task. Final verification gate is M5.T7.

---

# Parallelisation Map

Within milestones, these task pairs/groups are independent:

- **M1:** T2, T4, T5, T6, T7, T9, T10 are all parallel-safe with each other once T1 has produced the worktree. T3 (`npm install`) blocks T8 only.
- **M2:** T3 (preload) is parallel-safe with T2 (main). T5 (verify timeout) is parallel-safe with T2/T3/T4.
- **M3:** T1 (lib.js helpers) and T2 (CSS) are parallel-safe with each other.
- **M4:** T5 (formatResetIn negative-time check), T6 (catastrophic-failure check), T7 (settings edge cases) are parallel-safe with each other once T3 lands.
- **M5:** T1, T2, T3 (the three test files) are parallel-safe. T6 (README) is parallel-safe with T7 (smoke).

A small team could compress timeline by ~25–30% via the noted parallelism. Sequential single-engineer estimate: 19–22 hours total across all five milestones.

---

# Cross-cutting checklist

- [ ] Every task lists exact file paths.
- [ ] Every non-trivial code change includes the complete code block, not "implement X".
- [ ] Every milestone ends with a runnable `npm start`.
- [ ] All 24 ACs traced to ≥1 task in the matrix above.
- [ ] No L tasks anywhere — re-split if a task starts feeling >90 min.
- [ ] Frequent commits — every milestone has at least one; smaller commits within each milestone welcome.
- [ ] File budgets respected: `main.js` ≤350, `preload.js` ≤50, `renderer.js` ≤300, `styles.css` ≤250, `usage/index.js` untouched.
- [ ] No edits to `src/usage/index.js` after M1.T4 (verbatim policy).

---

*End of TASKS.md. Builder: open PROGRESS.md and tick milestones as you go.*
