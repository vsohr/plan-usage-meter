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

## Features (in scope for v1)

### F1. Provider auto-detection
- On every poll, call `getAccountUsage()` from the lifted detection module.
- That function returns `{ available, providers: { codex, claude }, errors, primary, secondary, planType, label }`.
- The renderer iterates **all** keys in `providers` (not just the "preferred" one) and renders a card for each — both available and unavailable.
- Provider shape: `{ available, label, planType, primary: { label, usedPercent, windowMinutes, resetsAt }, secondary, details, message? }`.

### F2. Provider cards
- Available card shows: provider name, plan type, primary window (label, %, bar, resets-in), secondary window (same), and any `details` entries (e.g. Opus weekly, Sonnet weekly).
- Bar color thresholds: green <75%, amber 75–95%, red ≥95%.
- Unavailable card shows: provider name (muted), "Not detected", and `provider.message` underneath.
- Relative-time strings ("resets in 3h 12m") refresh every 30 seconds in the renderer without re-polling the providers.

### F3. Frameless always-on-top window
- 340px wide, height auto-sized to content via IPC (renderer measures `document.body.scrollHeight` → reports to main → main calls `setBounds`).
- `frame: false`, `transparent: true`, `alwaysOnTop: true`, `resizable: false`.
- Default initial position: bottom-right of primary display work area, 16px margin.
- Last position persisted to `userData/window-state.json` and restored on relaunch.
- Header has drag region (`-webkit-app-region: drag`), refresh button, and close (hide) button (both `no-drag`).

### F4. System tray
- Tray icon present whenever app is running.
- Tooltip is a compact one-line summary of available providers (e.g. `"Claude 42% · GPT 67%"`); unavailable providers are omitted from the tooltip. Updates every poll.
- Single-click tray = toggle window visibility.
- Right-click tray = context menu: Show/Hide, Refresh now, Open at login (checkbox), Quit.
- Closing the window (X button or OS-level close) **hides** the window — it does NOT quit the app. Only the tray "Quit" entry exits the process.

### F5. Polling & manual refresh
- Main process runs `getAccountUsage()` every 60s (first poll runs immediately on `ready`).
- Tray "Refresh now" and the in-window refresh button both trigger an immediate poll without resetting the 60s interval.

### F6. Open at login
- Tray menu has a "Open at login" toggle (checkbox).
- Toggling calls `app.setLoginItemSettings({ openAtLogin: <bool>, openAsHidden: true })`.
- Setting persisted to `userData/settings.json` so the in-menu checkmark survives restarts.
- `openAsHidden: true` means after a Windows reboot the app launches into the tray with no visible window flash.

### F7. Single-instance lock
- Main process calls `app.requestSingleInstanceLock()` at startup.
- Second launch attempt focuses the existing window and exits.

### F8. Distribution
- `npm run start` runs the app in dev (electron .).
- `npm run dist` produces both an NSIS installer and a portable .exe in `dist/`.
- electron-builder config: `appId: com.vsohr.plan-usage-meter`, `productName: "Plan Usage Meter"`, `icon: assets/icon.ico`.

## Out of scope (v1)
- Push/desktop notifications when a quota is hit (→ FUTURE.md).
- Historical charts / usage timeline (→ FUTURE.md).
- Auto-update via electron-updater (→ FUTURE.md).
- Shared package with claude-portal — we accept the copied detection module and the drift risk for v1.
- Auth UI / token entry — all detection reads existing local credentials (`~/.codex/auth.json`, `~/.claude/.credentials.json`). Missing credentials show as "not detected" cards.
- Multi-machine sync, accounts, or any cloud component.
- macOS / Linux builds.

## Constraints (from CLAUDE.md)
- Build work happens in a git worktree under `c:/git/plan-usage-meter/worktrees/`. Branch name: `feat/initial-scaffold`.
- Files <800 lines, functions <50 lines, max 3 parameters per function.
- No `any` (n/a here — JS only, no TS).
- No speculative features. No backward-compat shims.
- Errors fail fast at boundaries; no silent swallowing.

## Acceptance criteria (also QA test plan)

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

## Quality bar
- Cold launch to first card render <2 seconds on a typical Windows 11 dev machine.
- Window does not flicker or jump when auto-resizing.
- Tray menu respond <100ms after right-click.
- No console errors on a clean run.
- Zero known critical bugs at ship time.

## Assumptions
- Tray icon placeholder: a simple programmatically-generated 16x16 PNG is acceptable if no asset is supplied. Same for `icon.ico`.
- "Hermes/WSL absence" is not a failure — `codex-usage.js` already falls through to `codex-live` then `codex-logs`. No change needed.
