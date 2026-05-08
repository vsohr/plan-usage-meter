# Plan Usage Meter

Always-on-top Windows desktop widget showing live plan-usage quotas for Claude, OpenAI Codex (ChatGPT), and Hermes — one card per provider, in your system tray.

_(screenshot here)_

## Prerequisites

- **OS:** Windows 11 (Windows 10 is best-effort).
- **Node:** 18 LTS or newer to run `npm install`, `npm test`, and `npm start`. (Electron 41 ships its own bundled Node + Chromium for the runtime, but the toolchain still needs Node on the host.)
- **Build tools:** none. `npm install` runs without native rebuilds.

## Install

```cmd
git clone <repo>
cd plan-usage-meter
npm install
npm start
```

A 260-pixel-wide frameless window appears in the bottom-right corner of your primary display, 16 px from the edges. The tray icon is the persistent affordance — closing the window with X *hides* it; the app keeps polling. Use **tray → Quit** to actually exit.

## Where credentials are read

The widget detects providers by reading credentials that the underlying CLIs already write to disk. Nothing is sent anywhere; the widget polls each provider's own usage endpoint locally.

- **Claude** — `~/.claude/.credentials.json` (created by `claude login`).
- **Codex** — `~/.codex/auth.json` (created by `codex login`), with `~/.codex/sessions/*.jsonl` log files as a fallback.
- **Hermes** — optional. Probed first inside WSL at `~/.hermes/hermes-agent/`. Absence is silently skipped — the app falls through to direct Codex auth, then to Codex log files.

If neither Claude nor Codex credentials exist, every card shows **"Not detected"** with the path it looked for. That's expected behaviour — the widget is also a config diagnostic, not just a meter.

## Tray menu

Right-click the tray icon for:

- **Show / Hide** — toggle the window.
- **Refresh now** — fire an immediate poll without resetting the 10-minute interval.
- **Open at login** — checkbox. Persisted across reboots in `%APPDATA%/Plan Usage Meter/settings.json`. Uses `openAsHidden: true` so a Windows boot puts the icon in the tray with no window flash.
- **Quit** — the only path that actually exits the process.

Single-click the tray icon to toggle the window.

You can also click the small refresh button in the window header to force a poll.

## Build

```cmd
npm run dist            :: NSIS installer + portable .exe
npm run dist:portable   :: portable only
```

Outputs land in `dist/`:

- `Plan Usage Meter-<version>-x64.exe` — NSIS installer (writes Start-menu and desktop shortcuts).
- `Plan Usage Meter-<version>-portable.exe` — portable, no install needed.

Both files are unsigned. **Windows SmartScreen will warn on first launch.** Either:

- Right-click the `.exe` → Properties → tick **Unblock** → OK, then launch normally, or
- Click "More info" → "Run anyway" on the SmartScreen dialog.

The build expects `assets/icon.ico` to exist with at least a 256×256 layer (electron-builder requirement). The `prebuild` script (`scripts/check-icons.js`) fails loudly if the icon is missing or undersized.

## Testing

```cmd
npm test
```

Runs the `node:test` suite in `tests/` — pure helpers only (renderer-lib + main-lib). No Electron, no network, no external deps.

## Troubleshooting

- **The window doesn't appear.** Look for the tray icon — the app launches hidden if you ticked "Open at login", and a previous session may have hidden the window. Single-click the tray.
- **Cards say "Not detected" but I have the CLI installed.** Run the actual CLI once (`claude` or `codex`) and complete the login flow so the credentials file gets written. The widget reads existing credentials; it does not create them.
- **`npm start` fails with `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`.** Your shell has `ELECTRON_RUN_AS_NODE` set, which forces `electron.exe` to run as plain Node. Unset it and retry:
  - PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`
  - cmd: `set ELECTRON_RUN_AS_NODE=`
- **Window appears off-screen after a monitor change.** Delete `%APPDATA%/Plan Usage Meter/window-state.json` and relaunch — the app falls back to bottom-right of the primary display.
- **Multiple polling apps trip Anthropic 429.** If you also run `claude-portal`'s embedded usage meter or call `claude usage` frequently, you may hit rate limits. Stop the others while testing.
- **DevTools.** Open the renderer DevTools by setting `PUM_DEVTOOLS=1` before `npm start`:
  - PowerShell: `$env:PUM_DEVTOOLS='1'; npm start`
  - cmd: `set PUM_DEVTOOLS=1 && npm start`

## Repository layout

- `src/main.js` — Electron main process (window, tray, polling, IPC).
- `src/main-lib.js` — pure helpers (timeout, persistence, clamp, tooltip).
- `src/preload.js` — context-isolation bridge.
- `src/usage/index.js` — verbatim copy of `claude-portal/lib/codex-usage.js`. Read-only by convention.
- `src/renderer/{index.html,styles.css,renderer.js,lib.js}` — the UI.
- `tests/*.test.js` — `node:test` unit tests.
- `scripts/check-icons.js` — prebuild asset assertion (AC22).
- `electron-builder.yml` — distribution config (`appId: com.vsohr.plan-usage-meter`, `productName: Plan Usage Meter`).

## What's not in scope (v1)

- Push / desktop notifications when a quota is hit.
- Historical usage charts or timelines.
- Auto-update via electron-updater.
- A shared package with `claude-portal` — the detection module is copied verbatim and accepts the drift risk for v1.
- An auth UI or token entry — credentials must already exist on disk.
- Multi-machine sync, accounts, or any cloud component.
- macOS / Linux builds.
- Custom polling interval / user-configurable refresh rate.
- Snapping to display edges or other windows.

## License

This is an internal / private project — no public license has been granted yet. See `package.json` (`"private": true`) and `docs/team/SPEC.md` for the v1 brief.
