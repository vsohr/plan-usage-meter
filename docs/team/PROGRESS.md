# PROGRESS — plan-usage-meter

> Live build state. Update after each task / milestone. Keep ≤150 lines.

## Status

- **Phase:** M4 complete
- **Iteration:** 1 of 5
- **Worktree:** `c:/git/plan-usage-meter/worktrees/initial-scaffold/`
- **Branch:** `feat/initial-scaffold`
- **Plan documents:** `docs/team/SPEC.md`, `docs/team/ARCHITECTURE.md`, `docs/team/TASKS.md` (this file's sibling)

## Milestone status

| ID | Title | Tasks | Status |
|---|---|---|---|
| M1 | Scaffold & detection bridge | 11 | **complete (2026-05-01)** |
| M2 | Polling & IPC | 6 | **complete (2026-05-01)** |
| M3 | Renderer cards & relative time | 5 | **complete (2026-05-01)** |
| M4 | Tray, persistence, edge cases | 8 | **complete (2026-05-01)** |
| M5 | Tests, build, README, polish | 7 | pending |

### M1 complete — 2026-05-01

Scaffold + verbatim detection bridge + asset placeholders + electron-builder config. AC1, AC22 (build-time icon check). Detection module at `src/usage/index.js` is a verbatim copy of `c:/claude-portal/lib/codex-usage.js` — do not edit. Total project tasks: 38 (S/M only).

**Harness gotcha:** shell exports `ELECTRON_RUN_AS_NODE=1`, which forces `electron.exe` to run as plain Node. Unset it before `npm start`. Symptom: `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`.

### M2 complete — 2026-05-01

Polling + IPC. Created `src/main-lib.js` (pure helpers: `CH`, `runWithTimeout`, `buildTimeoutPayload`, `buildErrorPayload`, `readJsonSafe`, `writeJsonAtomic`, `clampToDisplay`, `buildTooltip`). `src/main.js` polling loop with `pollInFlight` serialisation + `latestUsage` cache + 5 IPC handlers. Preload exposes frozen `window.api`. Channel-name strings duplicated between main-lib and preload per sandbox boundary rule. Satisfies AC4, AC9 (wrapper side), AC16 (interval clear), AC19, AC23 (partial).

### M3 complete — 2026-05-01

Renderer cards + relative time. Created `src/renderer/lib.js` (pure: `thresholdClass`, `clampPercent`, `formatResetIn`; `module.exports` guarded by `typeof module` so the file works as both `<script>` and `require` target). Renderer rewrites `styles.css` (dark theme, color thresholds, drag region, spin keyframe) + `renderer.js` (rAF-batched `replaceChildren` for atomic swap, refresh-spinner state, height reporting with `+1px` guard). AC2, AC3, AC11 (renderer side), AC12, AC18, AC24.

**Visual smoke gotcha:** GDI `CopyFromScreen` returns transparent for `transparent: true` BrowserWindows on Win11. `PrintWindow` with `PW_RENDERFULLCONTENT=2` is the working capture path.

### M4 complete — 2026-05-01

**Files modified:**
- `src/main.js` (286 lines, budget 350) — extended `electron` require with `Tray, Menu, nativeImage`; added `main-lib` imports for `readJsonSafe`, `writeJsonAtomic`, `buildTooltip`. Added `loadSettings`/`saveSettings`/`loadWindowState`/`saveWindowState`/`scheduleWindowStateSave` (debounced 500ms, skipped while window hidden). `createWindow` now reads saved state, runs `clampToDisplay` against the matching display, falls back to `defaultBottomRight` if saved coords are off-screen (AC13). Added `tray`, `debounce`, `toggleWindow`, `setOpenAtLogin`, `rebuildTrayMenu`, `createTray`. Tray click is debounced 250ms (AC15). `poll()` updates tooltip + rebuilds menu on every tick. `whenReady` calls `loadSettings`/`createWindow`/`createTray` then re-asserts `setLoginItemSettings` from persisted intent. `before-quit` clears timers, saves window state once more, destroys tray.

**Commits (3 atomic, T4–T7 verification-only):** `M4.T1` (persistence helpers), `M4.T2` (window-state restore + off-screen fallback), `M4.T3` (tray + login-item).

**Verification:**
- Helpers smoke (Node, no Electron): `readJsonSafe` on missing file → defaults; on malformed JSON → `console.warn` + defaults (no clobber); `writeJsonAtomic` then re-read round-trips. AC17 confirmed via direct helper invocation.
- `clampToDisplay` smoke: null → null; inside → identity; `{x:99999,y:99999}` → null; `{x:-9999,y:-9999}` → null. AC13 fallback path proven.
- `electron.exe .` boot: stdout empty, stderr only Chromium SIGTERM teardown noise (network service / GPU exit_code=143 from `timeout`-kill, not from our JS). No `unhandledRejection`, no `[poll] unexpected`. AC23 happy-path clean.
- Window movement / drag and visual tray verification deferred to QA (M5.T7) — same Electron-on-headless-bash limitation as M2/M3.

**ACs satisfied:**
- AC5 (close-to-tray): `win.on('close')` `e.preventDefault()` + `win.hide()` when `!app.isQuitting`. `Quit` menu sets `app.isQuitting = true` then `app.quit()`.
- AC6 (tooltip): `tray.setToolTip(buildTooltip(usage))` on every poll.
- AC7 (persistence path): settings.json written on toggle; `setLoginItemSettings` re-asserted on every launch from persisted intent. Reboot persistence is QA-time only, manual.
- AC10 (single-instance): unchanged from M1; tray makes `second-instance` re-show effective.
- AC11 (zero credentials): `buildTooltip` returns `'No providers detected'` when no provider is `available`.
- AC13 (off-screen recovery): saved coords checked via `getDisplayMatching` + `clampToDisplay`; null result → `defaultBottomRight`.
- AC14 (single display): code uses `getAllDisplays`-equivalent semantics via `getDisplayMatching`; no assumption of secondary display.
- AC15 (tray-click debounce): `debounce(toggleWindow, 250)` on `'click'`.
- AC16 (quit during in-flight poll): `before-quit` clears `pollTimer`; `poll()` re-checks `app.isQuitting` after the awaited `runWithTimeout` and short-circuits before mutating state. No `await poll()` anywhere — fire-and-forget.
- AC17 (deleted/malformed settings.json): `readJsonSafe` defaults silently on ENOENT, warns + defaults on parse error. Fresh write on first toggle.
- AC20 (non-default %USERPROFILE%): unchanged — `app.getPath('userData')` is Electron-managed; credential paths come from the verbatim detection module.
- AC21 (DPI scaling): `clampToDisplay` uses `display.workArea` (logical pixels). Electron returns DIPs at any scale, so no math change needed.
- AC23 (happy-path clean): boot smoke captured zero stdout/stderr from JS.

**Out of scope for this subagent (flagged for QA):**
- AC7 across-reboot: full Windows reboot required to verify `openAtLogin` actually launches the app on next boot. Manual M5.T7 step.
- AC15 visual idempotence: requires interactive tray clicks. Manual M5.T7.
- AC16 1-second-quit deadline: requires injecting a temporary delay into `getAccountUsage` and observing process exit. M4.T4 documents the manual experiment (verbatim policy: do not commit the injected delay).

**Notes / surprises:**
- Plan deviation: I added `win.on('show', rebuildTrayMenu)` and `win.on('hide', rebuildTrayMenu)`. Without those, the tray menu's first item would say "Hide" forever (until next poll forces a rebuild). Cheap; keeps the menu in sync with reality.
- Plan deviation: `saveWindowState` skips when `!win.isVisible()`. During close-to-tray Electron may fire `move` events as the window slides off-screen; we don't want to persist those phantom positions. The last legitimate move/resize already triggered a 500ms debounced write before the close, so no data is lost.
- `Tray.isDestroyed()` is guarded everywhere to avoid throwing on the post-quit code path (in case `before-quit` and a late `poll()` race).
- Final main.js is 286 lines, comfortably under the 350-line cap.

## Current task

- None — M4 done. Awaiting M5 kick-off (tests + build + README + AC walkthrough).

## Next steps

1. M5: `node:test` for color thresholds, relative time, clamp bounds; `npm run dist` (NSIS + portable); README rewrite; full AC1–AC24 walkthrough including manual reboot for AC7.

## Decisions log

*(empty — populate as the build progresses)*

| Date | Decision | Rationale |
|---|---|---|
| | | |

## Open risks (carried from ARCHITECTURE.md §"Risks & Mitigations")

- **R1 — Native fetch under Electron's Node.** Electron 28 ships Node 18.18.2 (stable `fetch`, `AbortController`, `AbortSignal`). Lock `"electron": "^28.0.0"`; document the floor in README.
- **R2 — electron-builder ICO requirements.** Builder rejects ICOs whose largest layer is below 256×256. Mitigation: commit a multi-size ICO with a 256 layer; `scripts/check-icons.js` runs on `prebuild` to fail loudly if the file goes missing. AC22's loud-failure is the default behavior.
- **R3 — Windows tray DPI scaling.** A 16×16 PNG can look fuzzy at 150%/200% scaling. Out of scope per SPEC AC21. Future: ship a `@2x` variant if needed.
- **R4 — Anthropic API rate-limit collisions.** Widget + claude-portal + Claude CLI all polling `api.anthropic.com/api/oauth/usage` may trip 429s. README warns "don't co-run with claude-portal's embedded usage meter." Errors flow into `provider.message` cleanly (AC12). Future: shared on-disk cache keyed by token hash, 30s TTL.
- **R5 — Preload sandbox + `require`.** With `sandbox: true`, Node built-ins are unavailable in preload. Mitigation: preload uses only `electron`'s `contextBridge` and `ipcRenderer`. Channel constants are duplicated (not imported from `main-lib.js`) to keep preload pure-electron.
- **R6 — Unsigned builds + SmartScreen.** SmartScreen blocks unsigned `.exe` files on first run. Mitigation: README documents the workaround ("More info → Run anyway"). Code signing is FUTURE.md (requires a paid certificate).

## Verification cadence

- After every milestone: `npm start` smoke + `git log --oneline -1`.
- After M5: full AC1–AC24 walkthrough (table in `TASKS.md` § M5.T7).

## Notes for the builder

- The detection module at `src/usage/index.js` is a **verbatim copy** of `c:/claude-portal/lib/codex-usage.js`. Do not edit it. Any timeout / abort logic lives in `runWithTimeout` (in `src/main-lib.js`).
- Preload is sandboxed — only `electron` may be `require`d. Channel-name strings are intentionally duplicated between `src/main-lib.js` and `src/preload.js`.
- File budgets (CLAUDE.md): `src/main.js` ≤350 lines, `src/preload.js` ≤50, `src/renderer/renderer.js` ≤300, `src/renderer/styles.css` ≤250. Split into `src/main-lib.js` if `main.js` approaches the cap.
- Frequent commits encouraged. Five milestone commits is the floor; smaller commits within each milestone welcome.
- All work happens in the worktree at `worktrees/initial-scaffold/`. Do not edit the master working tree.

## Concerns flagged for the team lead

- **Asset placeholders (M1.T7).** `npm install` cannot pull in `sharp` (native module) per AC1. The plan calls for a hand-crafted multi-size ICO committed with the initial scaffold. If the team lead prefers a procedural placeholder, a dev-only generator script can be added — but the ICO must still be checked in and AC22's "fail loudly when icon.ico missing" must remain.
- **Manual edge-case tests (M4.T4, M4.T5, M4.T6).** AC16/AC18/AC19 require briefly editing `src/usage/index.js` to inject a delay or throw. The plan explicitly says "DO NOT COMMIT" — the verbatim policy is binding. If the team would prefer an automated harness, that's an M2-side wrapper test that mocks `getAccountUsage`; deferred to FUTURE.md per scope.
- **Open at login full verification requires a Windows reboot (AC7).** This is unavoidable on a real machine. CI cannot prove it; the M5.T7 walkthrough table flags it as a manual step.
- **Unsigned `.exe` and SmartScreen (R6).** Documented in README. If the team has a certificate, the `electron-builder.yml` `win` block needs a `certificateFile` / `certificatePassword` pair — a 2-line addition that's out of v1 scope but trivial to bolt on.
