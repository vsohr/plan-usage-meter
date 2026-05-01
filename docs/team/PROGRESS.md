# PROGRESS — plan-usage-meter

> Live build state. Update after each task / milestone. Keep ≤150 lines.

## Status

- **Phase:** M5 complete — ready for QA verification
- **Iteration:** 1 of 5
- **Worktree:** `c:/git/plan-usage-meter/worktrees/initial-scaffold/`
- **Branch:** `feat/initial-scaffold`
- **Plan documents:** `docs/team/SPEC.md`, `docs/team/ARCHITECTURE.md`, `docs/team/TASKS.md`

## Milestone status

| ID | Title | Tasks | Status |
|---|---|---|---|
| M1 | Scaffold & detection bridge | 11 | **complete (2026-05-01)** |
| M2 | Polling & IPC | 6 | **complete (2026-05-01)** |
| M3 | Renderer cards & relative time | 5 | **complete (2026-05-01)** |
| M4 | Tray, persistence, edge cases | 8 | **complete (2026-05-01)** |
| M5 | Tests, build, README, polish | 7 | **complete (2026-05-01)** |

### M1 complete — 2026-05-01

Scaffold + verbatim detection bridge + asset placeholders + electron-builder config. AC1, AC22 (build-time icon check). Detection module at `src/usage/index.js` is a verbatim copy of `c:/claude-portal/lib/codex-usage.js` — do not edit.

**Harness gotcha:** shell exports `ELECTRON_RUN_AS_NODE=1`. Unset before `npm start`.

### M2 complete — 2026-05-01

Polling + IPC. `src/main-lib.js` (CH, runWithTimeout, payload builders, persistence helpers, clampToDisplay, buildTooltip). Polling loop with serialisation + latestUsage cache + 5 IPC handlers. AC4, AC9 (wrapper), AC16, AC19, AC23 (partial).

### M3 complete — 2026-05-01

`src/renderer/lib.js` pure helpers (thresholdClass, clampPercent, formatResetIn). Renderer rewrite: dark theme, drag region, rAF-batched DOM swap, height reporting with +1 px guard. AC2, AC3, AC11 (renderer), AC12, AC18, AC24.

### M4 complete — 2026-05-01

Tray + persistence + edge cases. Settings/window-state load/save (debounced 500 ms, skipped while hidden). Window-state restore via `clampToDisplay` + off-screen fallback. Tray with debounced single-click toggle, 4-item menu, login-item re-assertion on launch. AC5, AC6, AC7, AC10, AC11, AC13, AC14, AC15, AC16, AC17, AC20, AC21, AC23.

### M5 complete — 2026-05-01

**Tests (47 total, 2 files):**
- `tests/main-lib.test.js` — CH constants, clampToDisplay (12), runWithTimeout (3), buildTimeout/Error payloads (3), buildTooltip (5), readJsonSafe / writeJsonAtomic (5).
- `tests/renderer-lib.test.js` — thresholdClass (5), clampPercent (2), formatResetIn (12 incl. day-grain polish).
- `npm test`: `# pass 47  # fail 0`. Test glob updated to `tests/*.test.js` for Node 24 compatibility.

**`formatResetIn` polish (NEW):** for resets ≥24 h away the helper now returns `resets in 5d` or `resets in 5d 3h` instead of `resets in 118h 22m`. Edited `src/renderer/lib.js`. Tests cover boundary cases: <24 h still uses h+m, exact 24 h boundary uses days, leftover hours append.

**Build (`npm run dist`):**
- Outputs: `dist/Plan Usage Meter-0.1.0-x64.exe` (NSIS, 95 MB) + `dist/Plan Usage Meter-0.1.0-portable.exe` (95 MB).
- `appId: com.vsohr.plan-usage-meter`, `productName: Plan Usage Meter`, both confirmed in `electron-builder.yml`.
- **Build hiccup resolved:** electron-builder's bundled 7zip 21.07 cannot extract winCodeSign-2.6.0.7z's macOS dylib symlinks on Windows without Developer Mode or admin (`-snld` flag is silently ignored on this 7zip version). Added `signAndEditExecutable: false` to `electron-builder.yml` win block — signing is already out of scope (R6 / unsigned builds), and SmartScreen workaround is documented in README. Build now completes in one pass.

**Prebuild loud-fail (AC22):** verified by renaming `assets/icon.ico` aside and running `npm run prebuild` → exits 1 with clear error message; restored file → succeeds.

**README:** full rewrite at `README.md` (112 lines). Sections: Prerequisites, Install, Where credentials are read, Tray menu, Build, Testing, Troubleshooting (incl. SmartScreen, ELECTRON_RUN_AS_NODE, off-screen window), Repository layout, What's not in scope (v1), License.

## Ready for verification

Final QA gate is the AC1–AC24 walkthrough in `TASKS.md` § M5.T7. Items requiring manual / interactive verification:

- AC2, AC3, AC4, AC5, AC6 — visual confirmation of cards / tray menu / refresh.
- AC7 — full Windows reboot to confirm `openAtLogin` actually launches into the tray.
- AC9 — disconnect + reconnect network mid-poll.
- AC10 — second-instance focus (run `npm start` twice).
- AC15 — rapid tray clicks settle correctly.
- AC16 — quit during in-flight poll exits within 1 s (requires temp delay injection per M4.T4).
- AC23 — DevTools console + main stdout zero-error walk through full lifecycle.
- AC24 — visual no-flicker on auto-resize.

Automated coverage (npm test + prebuild loud-fail + npm run dist) handles AC1, AC8, AC13/14 (test-side), AC17 (test-side), AC18 (test-side), AC22.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | `formatResetIn` switches to day-grain at ≥24 h | Long h-counts (e.g. `118h 22m`) are unreadable; days+hours scans cleanly |
| 2026-05-01 | `signAndEditExecutable: false` in electron-builder.yml | Bundled 7zip 21.07 cannot extract winCodeSign symlinks on Windows without Developer Mode; signing is out of scope for v1 (R6) |

## Open risks (carried from ARCHITECTURE.md)

- **R1–R6** unchanged from M4. R6 (SmartScreen / unsigned builds) explicitly accepted; README documents the "Run anyway" workaround.

## Notes for the verifier

- Detection module at `src/usage/index.js` is a **verbatim copy** — do not edit.
- File budgets respected: `main.js` 287, `main-lib.js` 113, `preload.js` 24, `renderer.js` 159, `styles.css` ≤250, `usage/index.js` untouched.
- All edits live in worktree `worktrees/initial-scaffold/`. Master untouched.
- To repeat the build: clear `dist/` first; `npm run dist` runs ~30 s after node_modules is warm.
- To rerun tests: `npm test` (47 tests, ~300 ms).
