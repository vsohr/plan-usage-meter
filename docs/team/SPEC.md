# SPEC — plan-usage-meter

## Problem
Users running multiple LLM coding tools (Claude Code, OpenAI Codex/ChatGPT, Hermes) have no single pane of glass for their plan-usage quotas. They have to context-switch between web dashboards, CLIs, or the in-claude-portal widget that only shows one provider at a time.

## Solution
A standalone Windows desktop widget — `plan-usage-meter` — that:
- Auto-detects every LLM provider whose credentials exist on the local machine.
- Polls each provider every 60 seconds for current quota usage.
- Renders one card per provider in an always-on-top, frameless, draggable window.
- Includes muted "not detected" cards so users see exactly what was/wasn't found (auto-detection is transparent, not opaque).
- Lives in the system tray, supports open-at-login, and can be closed-to-tray.

## Target user
Power users (developers) who use multiple LLM coding tools simultaneously and want at-a-glance awareness of how close they are to plan limits without opening browsers or running CLIs. Single-user, single-machine app — no auth UI, no servers.

## Tech stack (locked)
- Electron (latest, ≥28) for the desktop runtime.
- Pure JS (no TypeScript). Node ≥18.
- electron-builder for distribution (NSIS installer + portable .exe).
- No native modules — must `npm install` cleanly with no rebuild step.
- Detection logic copied verbatim from `c:/claude-portal/lib/codex-usage.js` into `src/usage/index.js`. (Standalone — no shared package with claude-portal.)

---

## Features (in scope for v1)

### F1. Provider auto-detection

#### Behavior
- On every poll, call `getAccountUsage()` from the lifted detection module.
- That function returns `{ available, providers: { codex, claude }, errors, primary, secondary, planType, label }`.
- The renderer iterates **all** keys in `providers` (not just the "preferred" one) and renders a card for each — both available and unavailable.
- Provider shape: `{ available, label, planType, primary: { label, usedPercent, windowMinutes, resetsAt }, secondary, details, message? }`.

#### Intent
- **User goal:** Know at a glance which LLM tools are configured on this machine and which aren't.
- **Feeling:** Reassured. No "did I install it right?" ambiguity.
- **Anti-goals:** Hiding "not detected" providers — the user should never wonder *why* something is missing from the UI.

---

### F2. Provider cards

#### Behavior
- Available card shows: provider name, plan type, primary window (label, %, bar, resets-in), secondary window (same), and any `details` entries (e.g. Opus weekly, Sonnet weekly).
- Bar color thresholds: green <75%, amber 75–95%, red ≥95%.
- Unavailable card shows: provider name (muted), "Not detected", and `provider.message` underneath.
- Relative-time strings ("resets in 3h 12m") refresh every 30 seconds in the renderer without re-polling the providers.

#### Intent
- **User goal:** See burn-down at a glance — color is the signal, % is the precision.
- **Feeling:** Calm at green, alert at amber, urgent at red — without alarm fatigue.
- **Why "Not detected" cards instead of hiding:** The widget is also a config diagnostic. A blank space tells the user nothing; a muted "Not detected: no credentials at `~/.codex/auth.json`" tells them exactly what to do. See F1 intent.

---

### F3. Frameless always-on-top window

#### Behavior
- 340px wide, height auto-sized to content via IPC (renderer measures `document.body.scrollHeight` → reports to main → main calls `setBounds`).
- `frame: false`, `transparent: true`, `alwaysOnTop: true`, `resizable: false`.
- Default initial position: bottom-right of primary display work area, 16px margin.
- Last position persisted to `userData/window-state.json` and restored on relaunch.
- Header has drag region (`-webkit-app-region: drag`), refresh button, and close (hide) button (both `no-drag`).

#### Intent
- **User goal:** Glanceable widget that doesn't steal focus or screen real estate.
- **Feeling:** It's "there when I want it, invisible when I don't" — like a watch face.
- **Anti-goals:** Becoming a full app with menus, settings panes, or modal dialogs.

---

### F4. System tray

#### Behavior
- Tray icon present whenever app is running.
- Tooltip is a compact one-line summary of available providers (e.g. `"Claude 42% · GPT 67%"`); unavailable providers are omitted from the tooltip. Updates every poll.
- Single-click tray = toggle window visibility.
- Right-click tray = context menu: Show/Hide, Refresh now, Open at login (checkbox), Quit.
- Closing the window (X button or OS-level close) **hides** the window — it does NOT quit the app. Only the tray "Quit" entry exits the process.

#### Intent
- **User goal:** App is always running in the background; the window is just one view onto it.
- **Why X = hide, not quit:** Polling stops when the process exits. Users will instinctively click X to dismiss the widget; we want polling to continue so the tooltip stays accurate.

---

### F5. Polling & manual refresh

#### Behavior
- Main process runs `getAccountUsage()` every 60s (first poll runs immediately on `ready`).
- Tray "Refresh now" and the in-window refresh button both trigger an immediate poll without resetting the 60s interval.
- Each `getAccountUsage()` call is wrapped in a 15-second timeout (see Edge Cases). Timeout = treat as "unavailable" with message "Provider timed out".
- Polls are serialised: if a poll is already in flight when the 60s timer or a manual refresh fires, the new request is dropped (not queued). The in-window refresh button is visually disabled (or briefly spins) while a poll is in flight.

#### Intent
- **User goal:** Numbers are fresh without me thinking about it; I can force-refresh when I just hit send and want immediate feedback.
- **Anti-goals:** Hammering Anthropic/OpenAI APIs. 60s is the floor; manual refresh is opportunistic, not a stress test.

---

### F6. Open at login

#### Behavior
- Tray menu has a "Open at login" toggle (checkbox).
- Toggling calls `app.setLoginItemSettings({ openAtLogin: <bool>, openAsHidden: true })`.
- Setting persisted to `userData/settings.json` so the in-menu checkmark survives restarts.
- `openAsHidden: true` means after a Windows reboot the app launches into the tray with no visible window flash.

#### Intent
- **User goal:** Set it and forget it — widget is part of my desktop, not something I launch each morning.
- **Why `openAsHidden: true`:** A window flash on every boot is paper-cut UX. The tray icon is the persistent affordance; the window is summoned on demand.

---

### F7. Single-instance lock

#### Behavior
- Main process calls `app.requestSingleInstanceLock()` at startup.
- Second launch attempt focuses the existing window and exits.

#### Intent
- **User goal:** Clicking the launcher again brings the existing widget forward, doesn't spawn a duplicate.
- **Anti-goals:** Two tray icons, two pollers competing.

---

### F8. Distribution

#### Behavior
- `npm run start` runs the app in dev (electron .).
- `npm run dist` produces both an NSIS installer and a portable .exe in `dist/`.
- electron-builder config: `appId: com.vsohr.plan-usage-meter`, `productName: "Plan Usage Meter"`, `icon: assets/icon.ico`.

#### Intent
- **User goal:** Two install paths — installer for "set it up properly" and portable for "try it on this laptop".

---

## Out of scope (v1)
- Push/desktop notifications when a quota is hit (→ FUTURE.md).
- Historical charts / usage timeline (→ FUTURE.md).
- Auto-update via electron-updater (→ FUTURE.md).
- Shared package with claude-portal — we accept the copied detection module and the drift risk for v1.
- Auth UI / token entry — all detection reads existing local credentials (`~/.codex/auth.json`, `~/.claude/.credentials.json`). Missing credentials show as "not detected" cards.
- Multi-machine sync, accounts, or any cloud component.
- macOS / Linux builds.
- Custom polling interval / user-configurable refresh rate (→ FUTURE.md).
- DPI-aware fractional position math — we use integer pixel coordinates returned by Electron and trust them across scaling factors. If the user sees a 1–2px offset at 150%/200%, that is accepted-risk for v1.
- Snapping to display edges or other windows (→ FUTURE.md).

---

## Constraints (from CLAUDE.md)
- Build work happens in a git worktree under `c:/git/plan-usage-meter/worktrees/`. Branch name: `feat/initial-scaffold`.
- Files <800 lines, functions <50 lines, max 3 parameters per function.
- No `any` (n/a here — JS only, no TS).
- No speculative features. No backward-compat shims.
- Errors fail fast at boundaries; no silent swallowing.

---

## Acceptance criteria (also QA test plan)

> AC1–AC10 are locked numbers. AC11+ are additions from PASS-2 review (edge cases & quality bar). Do NOT renumber.

### AC1 — `npm install`
**Given** a clean Windows 11 machine with Node 18+
**When** the user runs `npm install` in the project root
**Then** the install completes with no native module rebuild and no errors.

### AC2 — `npm start` opens widget
**Given** valid Claude and/or Codex credentials present locally
**When** the user runs `npm start`
**Then** a frameless 340px-wide always-on-top window appears in the bottom-right corner of the primary display with a 16px margin.

### AC3 — Renders all providers
**Given** the app is running
**When** the first poll completes
**Then** the window shows one card per key in `usage.providers`:
- Available providers show plan + primary/secondary/details bars with correct percentages and reset times.
- Unavailable providers show a muted "Not detected" card with the upstream `message`.

### AC4 — Polling and manual refresh
**Given** the app is running
**When** 60 seconds elapse, OR the user clicks the in-window refresh button, OR the user clicks tray → Refresh now
**Then** `getAccountUsage()` runs and cards update with new values; manual triggers fire immediately without waiting for the 60s interval.

### AC5 — Close-to-tray and tray menu
**Given** the app is running
**When** the user clicks the window's close (X) button
**Then** the window hides (does NOT quit) and the tray icon remains.
**And when** the user right-clicks the tray, the menu shows: Show/Hide, Refresh now, Open at login (checkbox), Quit.
**And when** the user single-clicks the tray, the window toggles visibility.
**And when** the user clicks tray → Quit, the process fully exits.

### AC6 — Tray tooltip
**Given** the app has completed at least one poll
**When** the user hovers the tray icon
**Then** the tooltip shows a compact summary like `"Claude 42% · GPT 67%"` listing only available providers; unavailable providers are omitted; tooltip updates each poll.

### AC7 — Open at login persistence
**Given** the user has toggled "Open at login" ON
**When** the OS restarts
**Then** the app launches automatically into the tray (no visible window flash, because `openAsHidden: true`), and the tray menu still shows the "Open at login" item checked.

### AC8 — `npm run dist`
**When** the user runs `npm run dist`
**Then** `dist/` contains both an NSIS installer `.exe` and a portable `.exe`, both with `appId: com.vsohr.plan-usage-meter` and `productName: "Plan Usage Meter"`.

### AC9 — Network failure handling
**Given** the app is running with network connectivity
**When** the user disconnects from the network
**Then** the next poll's cards flip to "unavailable" with the upstream error message displayed in each affected card.
**And when** the user reconnects, the next poll within 60 seconds restores the cards to available state.

### AC10 — Single-instance lock
**Given** the app is already running
**When** the user double-clicks the launcher again (or runs `npm start` a second time)
**Then** no new process spawns; the existing window is focused and brought to front.

---

### AC11 — First launch with zero credentials
**Given** a fresh machine with neither `~/.codex/auth.json` nor `~/.claude/.credentials.json`
**When** the user runs the app for the first time
**Then** the window opens (does not error or crash) and shows a "Not detected" card for each known provider key (`codex`, `claude`) with a clear `message` indicating the missing credentials path.
**And** the tray tooltip reads `"No providers detected"` (no percentages).
**And** no console errors are emitted.

> Intent: the widget must be useful as a *diagnostic* on a fresh machine, not just on a configured one.

### AC12 — Expired or invalid credentials
**Given** a credentials file exists at the expected path but the token is expired/revoked/malformed (HTTP 401/403 from upstream, or JSON parse error)
**When** a poll runs
**Then** the affected provider card flips to "unavailable" with the upstream error surfaced verbatim in `provider.message` (e.g. "HTTP 401" or "Codex access token not found").
**And** other providers continue to render normally.
**And** subsequent polls keep retrying — the app does NOT enter a permanent error state for that provider.

### AC13 — Saved window position is off-screen on relaunch
**Given** `userData/window-state.json` contains a position that no longer falls within any connected display's work area (e.g. monitor was unplugged, resolution changed, user dragged into negative coords)
**When** the app launches
**Then** the saved position is discarded and the window opens at the default position (bottom-right of primary display, 16px margin).
**And** the next successful drag re-saves a valid position.

> Intent: never lose the window. A widget the user can't find is worse than one that "forgot" its position.

### AC14 — Single display only
**Given** the machine has exactly one display connected
**When** the app launches
**Then** the window opens in the bottom-right of that display's work area with 16px margin.
**And** no code path assumes a secondary display exists.

### AC15 — Tray click during hide/show animation
**Given** the user single-clicks the tray icon
**When** they single-click the tray icon again before the previous toggle completes (Electron `show()`/`hide()` are synchronous on Windows so this is mainly a debounce concern, not an animation one)
**Then** the toggle is idempotent: rapid clicks settle to either fully shown or fully hidden, never to a partially-rendered or stuck state. Implementation may debounce tray clicks at 150ms.

### AC16 — Quit during in-flight poll
**Given** a `getAccountUsage()` call is in progress
**When** the user clicks tray → Quit
**Then** the app exits within 1 second; the in-flight request is abandoned (not awaited).
**And** no "unhandled promise rejection" is logged on shutdown — the poll function's catch handler is no-ops if the app is quitting.

### AC17 — Manually deleted settings.json
**Given** the user has deleted `userData/settings.json` while the app was not running
**When** the app next launches
**Then** the app launches with default settings (Open at login = OFF) and writes a fresh `settings.json` on the first setting change.
**And** no error dialog or crash occurs.

> Same applies to `window-state.json` — see AC13.

### AC18 — Clock skew / negative resets-in
**Given** a provider's `resetsAt` timestamp is in the past relative to the local clock (clock skew, stale cache, or upstream returned an old window)
**When** the renderer computes the relative-time string
**Then** the display shows `"resets soon"` (not a negative duration like `"-3m"` or `"resets in 0m"`).
**And** the bar still renders with the last-known percentage; no NaN or "Invalid Date".

### AC19 — Per-poll timeout
**Given** the upstream provider API hangs or is unreachable at the TCP level (no response, no error)
**When** 15 seconds elapse from the start of `getAccountUsage()`
**Then** the call is aborted (via `AbortController` or equivalent) and treated as a failure for the current poll.
**And** the affected provider card shows "unavailable" with message `"Timed out"`.
**And** the next 60s poll cycle proceeds normally.

> Intent: a hung API must not freeze the polling loop. Without this, one bad upstream stalls all card refreshes for both providers.

### AC20 — Multiple Windows users / non-default %USERPROFILE%
**Given** the app is run by a Windows user whose `%USERPROFILE%` is not `C:\Users\<user>` (e.g. `D:\Users\<user>`, or the user has redirected their profile)
**When** the app starts
**Then** credential paths are resolved via `process.env.USERPROFILE` (matching `codex-usage.js` behavior), not hardcoded `C:\Users\...`.
**And** `userData` is resolved via `app.getPath('userData')` (Electron-managed), which already handles per-user roaming.

### AC21 — DPI scaling
**Given** the user's primary display is set to 150% or 200% scaling
**When** the app launches
**Then** the window appears at the documented 340px logical width (Electron handles DPI automatically; we use logical, not physical, pixels).
**And** the window's saved position restores correctly across reboots at the same scaling factor.
**Out of scope:** changing scaling between launches — if the user changes scaling and the saved position now falls outside the work area, AC13 applies.

### AC22 — App icon and tray icon present
**Given** `npm run dist` has been run
**When** the installer runs and the app launches
**Then** the taskbar/tray shows the configured `assets/icon.ico` (not the default Electron icon).
**And** if `assets/icon.ico` is missing at build time, the build fails loudly rather than silently shipping a default icon.

### AC23 — No console errors on clean run
**Given** valid credentials for at least one provider
**When** the app runs through: launch → first poll → manual refresh → close-to-tray → reopen from tray → quit
**Then** the DevTools console (renderer) and the main-process stdout/stderr show zero errors and zero unhandled rejections.
**And** warnings are limited to known Electron deprecation notices, if any.

### AC24 — No flicker on auto-resize
**Given** the renderer reports a new content height to main
**When** main calls `setBounds` to resize the window
**Then** the visible window does not flash, jump, or briefly show a different background color.
**And** the resize completes in a single frame from the user's perspective (≤16ms perceived).

> Implementation hint (non-binding): set `useContentSize: true` and resize from the bottom-anchor (keep the bottom-right corner pinned so vertical growth happens upward, matching the default position).

---

## Quality bar
- **Reference products:** Rainmeter widgets, macOS menu-bar apps (Bartender, iStat Menus). Calm, glanceable, never-in-the-way.
- **Polish level:** Polished MVP. Not "premium" — no animations, no theming — but zero paper cuts.
- **Performance:**
  - Cold launch to first card render <2 seconds on a typical Windows 11 dev machine.
  - Tray menu opens <100ms after right-click.
  - Window auto-resize completes in ≤16ms perceived (no flicker — see AC24).
  - Idle CPU <1% between polls; idle RAM <150MB resident.
- **Stability:**
  - Zero console errors on a clean run (see AC23).
  - No unhandled promise rejections, ever.
  - 24-hour soak: app still polling, tray still responsive, RAM has not grown >20MB.
- **Responsiveness:** Single fixed window size (340px). No viewport adaptation needed.
- **Bug bar:** Zero known critical bugs at ship time. Minor cosmetic issues acceptable if documented.

---

## Assumptions
- Tray icon placeholder: a simple programmatically-generated 16x16 PNG is acceptable if no asset is supplied. Same for `icon.ico`. (Note: AC22 requires the real icon at dist time.)
- "Hermes/WSL absence" is not a failure — `codex-usage.js` already falls through to `codex-live` then `codex-logs`. No change needed.
- The 15s per-poll timeout (AC19) is enforced by the plan-usage-meter caller via `AbortController`, not by modifying the copied `codex-usage.js`. Rationale: keep the copied file verbatim per tech-stack constraint.
- Windows 11 is the target; Windows 10 is best-effort (should work, not tested).

---

## Open questions (resolved during PASS-2)

| Question | Decision | Rationale |
|---|---|---|
| Does manual refresh reset the 60s timer? | No | F5 already says so. Confirmed: simpler, predictable cadence. |
| What if both refresh sources fire while a poll is in flight? | Drop the new request | F5 + AC16. Avoids stampedes; next 60s tick will pick up. |
| Should "Not detected" cards be collapsible? | No | Out of scope (FUTURE.md). v1 keeps a single static layout. |
| What happens if `getAccountUsage()` itself throws (not just per-provider error)? | All cards flip to a single error state with the thrown message; next poll retries | Captured under AC9 + AC12 spirit; main-process catch-all required. |
| Per-poll timeout duration? | 15 seconds | Long enough for slow upstreams, short enough that one hung provider doesn't starve the UI for a full minute. See AC19. |
