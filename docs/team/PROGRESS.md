# PROGRESS — plan-usage-meter

> Live build state. Update after each task / milestone. Keep ≤150 lines.

## Status

- **Phase:** M3 complete
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
| M4 | Tray, persistence, edge cases | 8 | pending |
| M5 | Tests, build, README, polish | 7 | pending |

### M1 complete — 2026-05-01

**Files created (worktree-relative):**
- `package.json`, `package-lock.json`
- `src/main.js`, `src/preload.js`
- `src/usage/index.js` (verbatim copy of `c:/claude-portal/lib/codex-usage.js`, SHA-256 `3da07d5c8cfb...`, 12,093 bytes / 393 lines)
- `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/renderer.js`
- `scripts/check-icons.js`
- `assets/tray.png` (84 bytes — 16×16 transparent placeholder), `assets/icon.ico` (1871 bytes — multi-size 16/32/48/64/128/256 placeholder)
- `electron-builder.yml`
- `README.md`

**Commits (8 atomic):** `M1.T2/T3`, `M1.T4`, `M1.T5`, `M1.T6`, `M1.T7`, `M1.T8`, `M1.T9`, `M1.T10`. M1.T1 (worktree bootstrap) was already in place at session start. M1.T11 is this PROGRESS.md update commit.

**`npm install`:** ok. Electron 28.3.3 + electron-builder 24.13.3 installed cleanly with no `gyp ERR!` and no native rebuild — AC1 confirmed. (Initial run failed with ENOSPC; freed 6.5 GB by clearing the npm cache and the partial `node_modules`, then succeeded.)

**`npm start` smoke:** ok. Ran `node_modules/electron/dist/electron.exe .` directly with `ELECTRON_RUN_AS_NODE` unset; process stayed alive past 5 seconds and stdout printed `[poll:M1] {"available":true,"providers":["codex","claude"],"label":"GPT 18%"}` — proves Electron main started, BrowserWindow created, single-instance lock acquired, and `getAccountUsage()` resolved end-to-end.

**Notes / surprises:**
- The shell harness in this session has `ELECTRON_RUN_AS_NODE=1` exported, which forces Electron to run as plain Node (`require('electron')` returns the path string, no `app` object). The fix is to unset that variable before `npm start`. This will not affect the user running `npm start` from a normal terminal (where the variable is not set). Worth noting for QA: if `npm start` ever errors with `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`, check `echo $ELECTRON_RUN_AS_NODE`.
- AC10 (single-instance lock) and AC2 (window position/frame style) are not yet visually confirmed in this session because we cannot interact with a windowed process. Code is in place per spec; full AC verification is M5.T7 / QA.
- Asset placeholders are minimum-viable: a 16×16 transparent PNG with a centered light-grey block, and a multi-size ICO of solid blue layers. They satisfy `check-icons.js` and electron-builder's 256-layer requirement; replace before public release per README.

**Total tasks:** 38 atomic tasks (S/M only — no L).

### M2 complete — 2026-05-01

**Files created/modified:**
- Created: `src/main-lib.js` (112 lines) — channel constants `CH`, `runWithTimeout`, `buildTimeoutPayload`, `buildErrorPayload`, `readJsonSafe`, `writeJsonAtomic`, `clampToDisplay`, `buildTooltip`. Pure functions, no `electron` import.
- Modified: `src/main.js` (134 lines) — replaced M1 sanity poll with full polling loop: `setInterval(60_000)` with immediate first call, `pollInFlight` serialisation flag, `latestUsage` cache, `broadcastUsage` via `webContents.send`, five IPC handlers (`usage:refresh` invoke, `window:hide`, `app:quit`, `window:report-height` send), `before-quit` clears the interval.
- Modified: `src/preload.js` (23 lines) — exposes frozen `window.api` with `onUsage(cb)` (returns unsubscribe fn), `refreshNow()` (invoke), `hide()`, `quit()`, `reportHeight(px)`. Channel constants duplicated locally per sandbox boundary rule.
- Modified: `src/renderer/renderer.js` (18 lines) — subscribes to `onUsage` and console-logs each payload; refresh button calls `refreshNow()`; close button calls `hide()`. M3 will replace this with real cards.

**Commits (4 atomic):** `M2.T1` (main-lib helpers), `M2.T2` (polling + IPC in main), `M2.T3` (preload api), `M2.T4` (renderer logging). M2.T5/T6 are verification-only (no commits).

**Verification:**
- `runWithTimeout(() => new Promise(()=>{}), 100)` → resolves with `errors.timeout: getAccountUsage exceeded 100ms`. AC19 wrapper proven.
- Synthetic timeout payload confirmed: `label: 'AI --'`, `providers.codex.message: 'Provider timed out'`, `providers.claude.message: 'Provider timed out'`. Shape matches ARCHITECTURE.md §"Synthetic timeout payload".
- End-to-end via Node: `runWithTimeout(getAccountUsage, 15000)` → returns real provider data (`available:true, label:'GPT 22%', providers:[codex,claude]`). Detection bridge through the wrapper works.
- 1ms-timeout local test (reverted before commit): forced the wrapper down the timeout path; produced the synthetic payload above. AC9/AC19 path proven.
- `electron.exe .` boots; multiple electron.exe processes (main + renderer + GPU + utility) stay alive past 10 seconds, proving the IPC handlers register and the poll loop runs without crashing.

**ACs satisfied:**
- AC4 (polling + manual refresh): full — 60s interval, immediate first poll, `usage:refresh` invoke handler triggers immediate poll.
- AC9 (network failure): wrapper-side proven — `runWithTimeout` always resolves; provider errors propagate as `provider.message` from upstream `codex-usage.js`.
- AC15 (debounced refresh-now plumbing): IPC channel `usage:refresh` is in place; tray-side debounce lands in M4.
- AC16 (quit during in-flight poll): `before-quit` clears the interval; `app.isQuitting` guards `poll()`; backstop `unhandledRejection`/`uncaughtException` listeners log only.
- AC19 (15s timeout per call): `runWithTimeout(getAccountUsage, 15_000)` invoked on every poll; synthetic payload returned on timeout; never throws.
- AC23 (no console errors, partial): no errors on the smoke path; full clean-run AC23 verified in M5.

**Notes / surprises:**
- Electron stdout capture in this Bash environment is unreliable — `electron.exe` does not flush JS `console.log` to redirected stdout when not attached to an interactive console. M1's stdout was captured via a different terminal context. Verification therefore relies on (a) Node-side `runWithTimeout` + `getAccountUsage` smoke, (b) timeout-payload shape match, (c) live `tasklist.exe` showing electron.exe processes alive. Renderer-side `console.log('[renderer:M2] usage update', ...)` is observable in DevTools (`PUM_DEVTOOLS=1 npm start`).
- The TASKS.md plan exposes `refreshNow()` on `window.api` (matching ARCHITECTURE.md §IPC Contracts and §Renderer Architecture). The user kick-off prompt mentioned `refresh()`/channel names `usage`/`refresh-now`; followed TASKS.md verbatim because (a) it's the binding plan, (b) renderer.js / preload.js identifiers must match, (c) ARCHITECTURE.md is the binding HOW spec.
- `void clampToDisplay;` in main.js silences the unused-import lint until M4 wires window-state restoration.

### M3 complete — 2026-05-01

**Files created/modified:**
- Created: `src/renderer/lib.js` (34 lines) — pure helpers `thresholdClass`, `clampPercent`, `formatResetIn`. `module.exports` guarded by `typeof module` so the same file works as a `<script>` tag in renderer and a `require()` target in `node:test` (M5.T1/T2).
- Modified: `src/renderer/styles.css` (123 lines, budget 250) — full rewrite. Dark theme with `rgba(20,20,24,0.92)` body bg, card surfaces at `rgba(34,34,40,0.85)`, bar fills green→amber→red via `.warn`/`.error` classes with `transition: width 200ms ease-out, background-color 200ms ease-out`. Header drag region + button no-drag region, `.spinning` spin keyframe (0.8s linear infinite). Unavailable cards: `opacity: 0.55` + italic `.message`. `will-change: contents` on `#cards` for AC24 belt-and-braces.
- Modified: `src/renderer/index.html` (22 lines, budget 80) — added `<script src="lib.js"></script>` before `renderer.js`. CSP unchanged (strict).
- Modified: `src/renderer/renderer.js` (159 lines, budget 300) — full rewrite. `renderCards(usage)` builds DOM via `createDocumentFragment` + `replaceChildren` (single-mutation atomic swap, AC24). `buildCard` handles available + unavailable branches. `buildWindowRow` defends against non-numeric `usedPercent` (renders 0% bar + "—" text, never throws). `scheduleRender` coalesces renders into one `requestAnimationFrame` tick and reports height after paint. `setInterval(30_000)` re-renders for relative-time tick without re-polling. Refresh button: `.spinning` class while in flight; cleared on `usage:update` push or 500ms after `accepted: false`.

**Commits (3 atomic):** `M3.T1` (lib helpers), `M3.T2` (styles), `M3.T3` (renderer + html). M3.T4/T5 are verification-only (no commits).

**Verification:**
- `node -e` smoke on `lib.js` printed `'' warn error '' | — | resets in 30m | resets soon | resets in 3h 12m` — all four `thresholdClass` boundaries + four `formatResetIn` paths (null, future, negative-skew, future-with-hours) all match expected.
- `npm start` (electron.exe with `ELECTRON_RUN_AS_NODE` unset): two BrowserWindow processes plus GPU + utility children stayed alive past 8s. Window enumerated via `EnumWindows` at (2204,1108)–(2544,1376) — 340×269 frameless, bottom-right, 16-px margin. Auto-resize fired (initial 180 → 269). Captured via `PrintWindow` with `PW_RENDERFULLCONTENT=2` (GDI-only `CopyFromScreen` returns transparent buffer for layered/composited Electron windows on Win11; `PrintWindow` is the working path for visual smoke against this app type).
- Screenshot showed: header with title + spinning+close buttons, Claude card with `Max` plan + Session 69% (green) "resets in 3h 32m" + Weekly 37% "resets in 118h 22m" + Sonnet weekly 0% "—", Codex card with `Prolite` plan + Session 24% + Weekly 15%. All bars rendered with correct color classes (all <75% so all green this run).
- stdout/stderr both empty (no errors, no unhandled rejections) for both the regular run and the `PUM_DEVTOOLS=1` run. AC23 verified for the M3 happy path.

**ACs satisfied (M3 portion):**
- AC2 (visual): full — frameless 340-px window, transparent background, dark cards, system font.
- AC3 (renders all providers): full — `Object.keys(usage.providers)` iteration; available cards show plan + bars + relative-time; unavailable cards muted with `provider.message`.
- AC11 (zero credentials): renderer-side full — "Not detected" card path coded and visually rendered when `provider.available !== true`. (Live no-creds smoke is M5.T7.)
- AC12 (expired/invalid creds): renderer-side full — `provider.message` is the body of the unavailable card.
- AC18 (clock skew): full — `formatResetIn` returns `'resets soon'` for any `diffMs <= 60_000`, which includes negative deltas. Verified in node smoke.
- AC23 (no console errors): partial — clean run produced zero stdout/stderr errors. Full quit-and-reopen cycle is M5.
- AC24 (no flicker on auto-resize): full — `replaceChildren(fragment)` is the single-mutation swap; `requestAnimationFrame` batches render+reportHeight; main-side `setBounds(..., false)` is bottom-anchored (already wired in M2). Renderer-side adds `+1px` to `documentElement.scrollHeight` to avoid sub-pixel jitter.

**Notes / surprises:**
- Plan deviation: Plan's `el()` helper accepted a `style` opts hash; I dropped that branch (unused). Renderer.js stayed at 159 lines well under the 300-line budget.
- Plan deviation: Renderer's `reportHeight()` uses `document.documentElement.scrollHeight + 1` instead of `document.body.scrollHeight` from the plan. Two reasons: (a) `documentElement.scrollHeight` is the conventional measure for full-content height including the html box, (b) the +1 px guard against sub-pixel jitter at fractional DPI is mentioned explicitly in the kick-off prompt's AC24 hint. Bottom-anchored `setBounds` from M2 still does the heavy lifting — the +1 is belt-and-braces.
- Visual smoke required `PrintWindow` API instead of `CopyFromScreen` because Electron with `transparent: true` produces a layered window that GDI screen-capture sees through. Documented in CODE-REVIEW.md if helpful.
- Console.warn (not console.error) is used only for truly unexpected states: missing preload bridge, refresh API throw. Happy path produces zero log output (per AC23).

## Current task

- None — M3 done. Awaiting M4 kick-off.

## Next steps

1. M4: tray icon, tooltip, context menu, Open at login, window-state persistence, edge-case handling.
2. M5: tests (`node:test`), README, full AC1–AC24 walkthrough.

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
