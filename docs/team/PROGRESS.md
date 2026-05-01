# PROGRESS — plan-usage-meter

> Live build state. Update after each task / milestone. Keep ≤150 lines.

## Status

- **Phase:** M1 complete
- **Iteration:** 1 of 5
- **Worktree:** `c:/git/plan-usage-meter/worktrees/initial-scaffold/`
- **Branch:** `feat/initial-scaffold`
- **Plan documents:** `docs/team/SPEC.md`, `docs/team/ARCHITECTURE.md`, `docs/team/TASKS.md` (this file's sibling)

## Milestone status

| ID | Title | Tasks | Status |
|---|---|---|---|
| M1 | Scaffold & detection bridge | 11 | **complete (2026-05-01)** |
| M2 | Polling & IPC | 6 | pending |
| M3 | Renderer cards & relative time | 6 | pending |
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

## Current task

- None — awaiting kick-off. First action: `M1.T1` (worktree bootstrap).

## Next steps

1. Create the worktree per `M1.T1`.
2. Run `M1.T2..T10` (parallelisable subset noted in TASKS.md).
3. Land the M1 commit per `M1.T11`. Smoke `npm start` → empty 340-px frameless window in bottom-right.
4. Continue to M2.

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
