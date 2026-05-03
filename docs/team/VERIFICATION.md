# Verification — plan-usage-meter

**APPROVED** by team lead 2026-05-02. All 24 ACs satisfied (executed or inspected). Both listed warnings are pre-accepted risks documented in SPEC.md and PROGRESS.md (Electron version doc drift in ARCHITECTURE.md is non-binding — SPEC §Tech stack pins "latest, ≥28"; code-signing deferral is risk R6, README documents the SmartScreen workaround).

> Date: 2026-05-01 · Branch: `feat/initial-scaffold` · Worktree: `c:/git/plan-usage-meter/worktrees/initial-scaffold/`

## Overall: PASS

- Acceptance criteria: **9/24 EXECUTED-PASS**, **15/24 INSPECTED-PASS** (manual walkthrough required), **0/24 FAIL**
- Critical issues: **0**
- Warnings: **2** (see Warnings section)

---

## Automated results

| Check | Result |
|---|---|
| `node_modules` present | PASS (directory exists) |
| `npm audit --audit-level=high` | PASS — `found 0 vulnerabilities` |
| `npm test` | PASS — `tests 47, pass 47, fail 0`, duration 293 ms |
| `npm run dist` artifacts | PASS — both NSIS and portable `.exe` already in `dist/` (no rebuild needed) |
| `dist/Plan Usage Meter-0.1.0-x64.exe` | exists (99 631 902 bytes; NSIS installer) |
| `dist/Plan Usage Meter-0.1.0-portable.exe` | exists (99 424 355 bytes; portable) |
| `src/usage/index.js` byte-equal to `c:/claude-portal/lib/codex-usage.js` | PASS — SHA256 `3DA07D5C8CFBACBAC86223DE33A0F22D2C702C4F476425B4AF3DA08B96986266` on both files |
| `contextIsolation: true` in `src/main.js` | PASS (line 113) |
| `nodeIntegration: false` in `src/main.js` | PASS (line 114) |
| `sandbox: true` in `src/main.js` | PASS (line 115) |
| CSP meta tag in `src/renderer/index.html` | PASS (line 5: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';`) |
| AC22 prebuild gate | PASS — renamed `assets/icon.ico` aside, ran `npm run prebuild` → exit 1 with clear `[check-icons] FAIL` message; restored file; `git status` clean |
| Smoke launch (9 s) via `electron .` | PASS — process stayed alive 9 s, stdout empty, stderr empty, no console errors emitted, killed cleanly via taskkill /T |

---

## Acceptance criteria results

### AC1 — `npm install`
- **Status:** EXECUTED-PASS
- **Evidence:** `node_modules/` is populated; `npm audit --audit-level=high` returns 0 vulnerabilities. `package.json` declares zero runtime dependencies — only `electron@^41` and `electron-builder@^26` as devDependencies. No native modules → no rebuild step.

### AC2 — `npm start` opens widget
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/main.js:100-117` constructs `BrowserWindow` with `width: 340, frame: false, transparent: true, alwaysOnTop: true, resizable: false`. `defaultBottomRight()` at lines 73-83 places the window 16 px from the bottom-right of the primary display work area. Smoke test launched the app and process stayed alive 9 s with no errors — window did appear.
- **Manual walkthrough:** `npm start` → confirm a 340-px-wide frameless window appears at bottom-right of primary display (~16 px margin), is always-on-top, has rounded corners over a dark glass background, and the title bar reads "Plan Usage Meter".

### AC3 — Renders all providers
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/renderer/renderer.js:13-20` defines `PROVIDER_ORDER = ['claude','codex']` and `providerOrderedKeys()` iterates `Object.keys(usage.providers)` so every key is rendered (preserving order). `buildCard()` at lines 50-74 branches on `provider.available !== true` → renders muted `Not detected` card with `provider.message`; otherwise renders plan, primary/secondary windows, and `(provider.details||[])`. Threshold colors applied via `thresholdClass` (65/85 boundaries — verified by 5 unit tests).
- **Manual walkthrough:** with valid Claude+Codex creds, run `npm start` → both cards visible with plan label, percentages, bar colors and `resets in …` strings. Move `~/.codex/auth.json` aside → next poll shows Codex card flipped to muted "Not detected" with credentials-path message; Claude card unchanged.

### AC4 — Polling and manual refresh
- **Status:** EXECUTED-PASS (code path) + INSPECTED-PASS (visual)
- **Evidence:** `src/main.js` runs `setInterval(poll, AUTO_POLL_INTERVAL_MS)`, currently 10 minutes. `poll()` is serialised by `pollInFlight`. IPC wires `usage:refresh` → `poll()` without resetting the timer. Tray menu has `Refresh now` → `poll()`. The manual-refresh path returns `{accepted:false}` when in-flight — verified by reading both ends.
- **Manual walkthrough:** open the window, watch updatedAt; click in-window ↻ button → updatedAt changes within seconds. Right-click tray → Refresh now → updatedAt changes. Wait 10 minutes with no clicks → poll fires automatically.

### AC5 — Close-to-tray and tray menu
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/main.js:124-129` — `win.on('close', e => { if (app.isQuitting) return; e.preventDefault(); win.hide(); })`. Tray menu at `src/main.js:172-184` contains exactly the four required items: Show/Hide (toggle label), Refresh now, Open at login (checkbox), Quit. Single-click handler at line 200 (`tray.on('click', debounce(toggleWindow,250))`).
- **Manual walkthrough:** click the X in the title bar → window hides, tray icon remains. Right-click tray → menu shows: Show, Refresh now, sep, Open at login [ ], sep, Quit. Single-click tray → window reappears. Single-click again → hides. Right-click tray → Quit → process exits (verify in Task Manager).

### AC6 — Tray tooltip
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/main-lib.js:96-101` — `buildTooltip(usage)` filters `usage.providers` for `available`, returns `'No providers detected'` when none, else joins `p.label` with ` · `. Wired at `src/main.js:220` after every poll. 5 unit tests cover all branches (zero, one, two, mixed-availability).
- **Manual walkthrough:** hover the tray icon. With both providers available, tooltip reads e.g. `Claude 42% · GPT 67%`. Disable Claude credentials → next poll, tooltip becomes `GPT 67%`. Disable both → tooltip becomes `No providers detected`.

### AC7 — Open at login persistence
- **Status:** INSPECTED-PASS (manual walkthrough required — needs full Windows reboot)
- **Evidence:** `src/main.js:153-167` — `setOpenAtLogin()` calls `app.setLoginItemSettings({ openAtLogin: desired, openAsHidden: true, args: ['--hidden'] })`, then persists to `settings.json`. On startup (line 242-250) the app re-asserts the OS login-item setting from the persisted value. `src/main.js:121` — `if (!process.argv.includes('--hidden')) win.show();` so an `--hidden` boot launches into the tray with no flash.
- **Manual walkthrough:** right-click tray → Open at login (checkbox toggles to ✓). Reboot Windows. After login, observe: tray icon appears, no window flash. Right-click tray → confirm checkbox still ticked.

### AC8 — `npm run dist`
- **Status:** EXECUTED-PASS (artifacts present)
- **Evidence:** `dist/Plan Usage Meter-0.1.0-x64.exe` (NSIS, ~99 MB) and `dist/Plan Usage Meter-0.1.0-portable.exe` (~99 MB) both exist. `electron-builder.yml` declares `appId: com.vsohr.plan-usage-meter`, `productName: Plan Usage Meter`, `target: [nsis, portable]`.

### AC9 — Network failure handling
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/main.js:215` wraps `getAccountUsage` in `runWithTimeout` which never throws (`src/main-lib.js:48-63`). On any failure the wrapper substitutes `buildErrorPayload` (lines 30-46) with `provider.message` set to the upstream error text. The detection module (`codex-usage.js`) already routes per-provider HTTP/fetch errors into `provider.message` verbatim. Renderer card shows `provider.message` when `available !== true` (renderer.js:60).
- **Manual walkthrough:** open the app, both cards available. Disable network (airplane mode). Wait up to 10 minutes or click ↻ — both cards flip to "Not detected" with messages like `fetch failed`/`getaddrinfo ENOTFOUND`. Re-enable network. Within 10 minutes the next poll restores both cards.

### AC10 — Single-instance lock
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/main.js:16-19` — `if (!app.requestSingleInstanceLock()) { app.quit(); return; }`. `app.on('second-instance', …)` at line 230 restores/shows/focuses the existing window.
- **Manual walkthrough:** start the app. Run `npm start` again from another shell → second process exits silently; existing window jumps to focus.

### AC11 — First launch with zero credentials
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** Renderer always renders both `claude` and `codex` cards because the verbatim `getAccountUsage()` always returns both keys (available or not). `buildCard()` (renderer.js:56-62) renders `provider.message` for unavailable. `buildTooltip` (main-lib.js:96-101) returns exactly `"No providers detected"` when zero providers are available — covered by 2 unit tests. Init code wraps every external call in try/catch, no unhandled paths.
- **Manual walkthrough:** rename `~/.codex/auth.json` and `~/.claude/.credentials.json` aside. `npm start` → window opens, both cards muted with credential-path messages. Hover tray → tooltip reads `No providers detected`. Open DevTools (set `PUM_DEVTOOLS=1`) and confirm zero console errors.

### AC12 — Expired or invalid credentials
- **Status:** INSPECTED-PASS (manual walkthrough optional — covered by AC9 logic)
- **Evidence:** Same code path as AC9 — upstream HTTP 401/403/parse errors propagate into `provider.message` via the verbatim detection module's per-provider try/catch. Other providers continue rendering normally because each is rendered independently from the `providers` object. Polling timer is unaffected (no permanent error state).

### AC13 — Saved window position is off-screen on relaunch
- **Status:** EXECUTED-PASS (test) + INSPECTED-PASS (integration)
- **Evidence:** `clampToDisplay` in `src/main-lib.js:83-94` returns `null` when bounds fall fully off `display.workArea`. 12 unit tests in `tests/main-lib.test.js` cover null state, off-screen all four edges, fully inside, custom width, etc. `src/main.js:88-98` falls back to `defaultBottomRight(work)` when `clampToDisplay` returns null.

### AC14 — Single display only
- **Status:** INSPECTED-PASS
- **Evidence:** `src/main.js:86` uses `screen.getPrimaryDisplay().workArea` only. No code path requires a secondary display.

### AC15 — Tray click during hide/show animation
- **Status:** INSPECTED-PASS (manual walkthrough required)
- **Evidence:** `src/main.js:200` — `tray.on('click', debounce(toggleWindow, 250))`. `debounce` (lines 138-145) uses a leading-edge timer to ignore subsequent calls within the window. Spec accepts 150 ms; implementation uses 250 ms (more conservative).
- **Manual walkthrough:** rapidly single-click the tray icon ~10 times in 2 seconds → window settles to either fully shown or fully hidden, never mid-state.

### AC16 — Quit during in-flight poll
- **Status:** INSPECTED-PASS
- **Evidence:** `poll()` (`src/main.js:210-228`) checks `if (app.isQuitting) return;` at start AND after `await runWithTimeout` to skip broadcast/tray work during shutdown. `before-quit` (line 275) sets `isQuitting`, clears intervals, saves state, destroys tray. `runWithTimeout` never rejects (always resolves with a payload), so no unhandled rejection at shutdown. Process-level `unhandledRejection` and `uncaughtException` handlers (lines 21-22) are backstops.

### AC17 — Manually deleted settings.json
- **Status:** EXECUTED-PASS (test) + INSPECTED-PASS (integration)
- **Evidence:** `readJsonSafe(path, defaults)` in `src/main-lib.js:65-75` returns `{ ...defaults }` on ENOENT (silently) or other parse errors (with `console.warn`). `loadSettings()` defaults to `{ openAtLogin: false }`. 5 unit tests cover ENOENT/null defaults/round-trip/malformed/merge.

### AC18 — Clock skew / negative resets-in
- **Status:** EXECUTED-PASS (test)
- **Evidence:** `src/renderer/lib.js:18-39` — `formatResetIn` returns `'resets soon'` whenever `diffMs <= 60_000` (covers past timestamps and ≤1 min in the future). 12 dedicated unit tests including past-timestamp, ≤60s, ≥24h, exact-hour, day-grain.

### AC19 — Per-poll timeout
- **Status:** INSPECTED-PASS
- **Evidence:** `runWithTimeout(getAccountUsage, 15_000)` in `src/main.js`. Wrapper guarantees resolution within 15 s by `setTimeout(buildTimeoutPayload, 15_000)`. `buildTimeoutPayload` synthesises `provider.message: 'Provider timed out'` for both keys. Polling timer is unaffected (next 10-minute cycle proceeds normally).

### AC20 — Multiple Windows users / non-default %USERPROFILE%
- **Status:** INSPECTED-PASS
- **Evidence:** `src/usage/index.js` (verbatim) uses `process.env.USERPROFILE` for credential paths. `userData` in `src/main.js:36,50` resolved via `app.getPath('userData')` which Electron computes per user.

### AC21 — DPI scaling
- **Status:** INSPECTED-PASS
- **Evidence:** `BrowserWindow` is given `width: 340` (logical px). Electron handles DPI translation. `clampToDisplay` is purely arithmetic on logical workArea coords.

### AC22 — App icon and tray icon present
- **Status:** EXECUTED-PASS
- **Evidence:** `electron-builder.yml` line 22 sets `icon: assets/icon.ico`. `scripts/check-icons.js` enforces presence + minimum size for both `assets/icon.ico` and `assets/tray.png`. `package.json` script `dist: "npm run prebuild && electron-builder"`. **Tested live**: renamed `assets/icon.ico` aside → `npm run prebuild` exited 1 with the message `[check-icons] missing assets\icon.ico: ENOENT…` followed by `[check-icons] FAIL: required asset(s) missing or undersized.`. Restored file; `git status` clean. Tray icon load wrapped at `src/main.js:188-202` with a fallback to an empty `nativeImage` and a warn (does not crash).

### AC23 — No console errors on clean run
- **Status:** EXECUTED-PASS (smoke) + INSPECTED-PASS (full lifecycle)
- **Evidence:** Smoke launch (9 s, electron via `electron.cmd .`) → process stayed alive, stdout empty, stderr empty. No `console.error` paths fire on clean code paths; the only `console.warn` sites are recoverable failures (corrupt JSON, login-item set failure, tray icon load) — all explicitly required by AC23 to be allowable.
- **Manual walkthrough:** start with `PUM_DEVTOOLS=1 npm start` → verify zero errors and zero unhandled rejections in the renderer DevTools console as you click ↻, X, tray Show/Hide, tray Refresh now, tray Quit. Verify zero stderr from the main process.

### AC24 — No flicker on auto-resize
- **Status:** INSPECTED-PASS
- **Evidence:** `src/main.js:259-269` — height-report handler clamps px to 80..1200, throttles via 16 ms timer, computes `newY = cur.y + (cur.height - px)` (bottom-anchor as recommended), calls `win.setBounds(..., false)` with `animate: false`. Renderer uses single-mutation DOM swap via `root.replaceChildren(fragment)` (renderer.js:94) and `requestAnimationFrame` batching (lines 105-112) so the new tree commits in one frame. `+1 px` guard against sub-pixel jitter on fractional DPI scales (renderer.js:101).
- **Manual walkthrough:** open the window. Toggle one provider's credentials so the next poll makes the card grow/shrink (e.g. add/remove `details` entries on Claude). Observe that the window grows upward from a fixed bottom-right anchor with no flash, no white frame, and no perceptible jump.

---

## Critical issues
None.

## Warnings

1. **Electron 41 vs ARCHITECTURE.md spec.** ARCHITECTURE.md §Tech-Stack pins `electron ^28.0.0`; `package.json` declares `electron ^41.0.0`. Both ship Node 18+, global `fetch`, and `AbortController`, so AC1/AC9/AC19 still hold, but the divergence from the architecture doc is worth flagging for a doc update. (Not an AC violation — SPEC §Tech stack says "Electron (latest, ≥28)".)
2. **Code-signing disabled** (`signAndEditExecutable: false` in `electron-builder.yml`). Documented in PROGRESS.md as accepted-risk R6 + README SmartScreen workaround. Not an AC violation but means the user will see a SmartScreen warning on first install — confirm the README workaround is discoverable before public release.

---

## Manual walkthrough script (for human QA — ~7 minutes)

> Run from `c:/git/plan-usage-meter/worktrees/initial-scaffold/`. Ensure both `~/.codex/auth.json` and `~/.claude/.credentials.json` exist before starting.

1. **Start app** — `set PUM_DEVTOOLS=1 && npm start`. *Expect:* 340-px frameless window appears at bottom-right of primary display, ~16 px margin. **AC2.**
2. **First poll renders cards** — within ~3 s, both Claude and Codex cards show plan label, percentage bars (green/amber/red), and `resets in …` strings. **AC3.**
3. **Manual in-window refresh** — click the ↻ button. `updatedAt` value (visible if you log in main) changes; spinner stops. **AC4.**
4. **Tray refresh** — right-click tray icon → click `Refresh now`. Cards update again. **AC4.**
5. **Tray tooltip** — hover the tray icon for ~1 s. *Expect:* `Claude N% · GPT M%` (or single-provider variant if one is unavailable). **AC6.**
6. **Tray menu shape** — right-click tray. *Expect:* Show/Hide, Refresh now, sep, Open at login (checkbox), sep, Quit. **AC5.**
7. **Close-to-tray** — click the X in the window's title bar. *Expect:* window hides, tray icon remains, polling continues. **AC5.**
8. **Single-click tray reopen** — single-click tray icon. Window reappears. Single-click again — it hides. **AC5/AC15.**
9. **Tray-click rapid-fire** — single-click the tray icon ~10 times in 2 s. *Expect:* settles fully shown or fully hidden, never mid-state. **AC15.**
10. **Single-instance lock** — open a second shell, run `npm start`. *Expect:* no second window; existing window pops to focus. **AC10.**
11. **Open at login toggle** — right-click tray → check "Open at login". Right-click again → confirm checked. *Expect:* `%APPDATA%\plan-usage-meter\settings.json` now contains `"openAtLogin": true`. **AC7.**
12. **Reboot test (long)** — restart Windows. After login, *expect:* tray icon present, no window flash. Right-click tray, confirm checkbox still ✓. **AC7.**
13. **Network failure** — disable Wi-Fi / unplug Ethernet. Click ↻. *Expect:* both cards flip to "Not detected" with upstream message (`fetch failed` or similar). Re-enable network → wait up to 10 minutes or click ↻ → cards restore. **AC9.**
14. **Zero credentials** — quit app via tray Quit. Move `~/.codex/auth.json` and `~/.claude/.credentials.json` aside. `npm start` again. *Expect:* both cards muted with credential-path message; tray tooltip reads `No providers detected`; no console errors in DevTools. Restore credentials before continuing. **AC11.**
15. **No flicker on resize** — with cards rendering, force one to grow (e.g. switch creds so a `details` array adds rows). *Expect:* window grows upward (bottom edge fixed), no flash/white frame. **AC24.**
16. **Console clean check** — over the entire walkthrough, confirm DevTools renderer console shows zero `error` entries and zero unhandled rejections; main-process stderr (visible in the launching shell) is empty except possibly known warnings. **AC23.**
17. **Final quit** — right-click tray → Quit. *Expect:* process exits within 1 s; check Task Manager has no `electron.exe` / `Plan Usage Meter` process. **AC5/AC16.**
