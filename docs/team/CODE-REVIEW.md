# Code Review

## Milestone 1 — 2026-05-01

**Verdict: PASS**

### Task Coverage (Spot Checks)

#### M1.T2 — package.json
- ✅ **Verified:** File matches TASKS.md spec exactly — name, version, main, scripts (start, test, prebuild, dist, dist:portable), devDependencies pinned to electron ^28.0.0, electron-builder ^24.13.0.
- ✅ **Entry point:** main: "src/main.js" correct.
- ✅ **Scripts:** `start` → `electron .`, `test` → `node --test tests/`, `prebuild` → `node scripts/check-icons.js`, `dist` chains prebuild then electron-builder.

#### M1.T4 — Verbatim Detection Module
- ✅ **Verified:** src/usage/index.js is 393 lines, matching c:/claude-portal/lib/codex-usage.js.
- ✅ **Exports:** Object with `getAccountUsage`, `fetchClaudeUsage`, `readCodexUsageFromLogs`, etc. as spec'd.
- ✅ **No edits:** File is copied as-is; zero modifications for timeout or other logic.

#### M1.T8 — src/main.js
- ✅ **Single-instance lock (AC10):** Lines 9–11 — `app.requestSingleInstanceLock()` called BEFORE any window creation. Returns false → app.quit(). Correct order per ARCHITECTURE.md.
- ✅ **Second-instance handler (AC10):** Lines 63–68 — handler restores/shows existing window on second-instance event. Correct.
- ✅ **Window bounds math (AC2):** Lines 24–33 — `defaultBottomRight()` calculates x = work.x + work.width - 340 - 16, y = work.y + work.height - 180 - 16. Width 340, height 180 (used in createWindow line 40–41). Margin 16px, bottom-right positioning verified.
- ✅ **webPreferences (AC22/ARCH):** Lines 50–55 — contextIsolation: true, nodeIntegration: false, sandbox: true.
- ✅ **First poll (M1 sanity check):** Lines 75–84 — calls `getAccountUsage()`, logs JSON to stdout with available/providers/label. Unhandled rejection trap (lines 15–20) in place.
- ✅ **Window ready-to-show:** Line 58–60 — show only if not --hidden flag.

#### M1.T6 — Preload
- ✅ **Verified:** src/preload.js — Lines 1–7 — Only exports __preloadVersion via contextBridge.exposeInMainWorld. No other methods exposed in v1 (stub comment hints M2 wires the actual IPC).
- ✅ **No Node globals leaked:** Only `contextBridge` used (electron module safe in preload even with sandbox: true).

### Implementation Details

- ✅ **electron-builder.yml:** appId = com.vsohr.plan-usage-meter, productName = Plan Usage Meter, icon = assets/icon.ico, targets include nsis + portable (win.target array has both). Verified lines 1–34.
- ✅ **HTML/CSS skeleton:** index.html has CSP meta, DOCTYPE, Segoe UI font, #header 36px with drag region, #cards container. styles.css has CSS variables, dark glass background rgba(20,20,24,0.92), proper button styling.
- ✅ **Renderer stub:** renderer.js (5 lines) is placeholder; console.log on DOMContentLoaded.
- ✅ **Assets:** icon.ico (1871 bytes multi-size), tray.png (84 bytes) present in assets/.
- ✅ **check-icons.js:** prebuild script exists at scripts/check-icons.js (30 lines), verifies icon.ico exists via fs.accessSync.

### No Critical Code Issues Found

- No hardcoded secrets.
- No eval, new Function, or dangerouslySetInnerHTML.
- Single responsibility per file (main.js: lifecycle; preload.js: IPC stub; renderer: placeholder).
- Error handlers in place (process.on unhandledRejection/uncaughtException).
- IPC channels not yet wired (M2 scope) — preload is correctly minimal.

---

**All M1 acceptance criteria met. Ready for merge.**
