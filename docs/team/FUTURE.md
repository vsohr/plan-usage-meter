# FUTURE — plan-usage-meter

Ideas surfaced during spec review that are explicitly NOT in v1. Park here, revisit after v1 ships.

## Notifications & alerts
- Desktop/toast notification when a quota crosses an amber or red threshold.
- Configurable threshold per provider.
- "Quiet hours" so notifications don't fire overnight.

## History & analytics
- Local SQLite of poll results so users can see usage over the last 7/30 days.
- Sparkline under each card showing the current window's burn rate.
- Export usage history to CSV.

## Distribution & updates
- Auto-update via `electron-updater` (GitHub Releases as the feed).
- Code signing (Authenticode) so SmartScreen doesn't warn on first install.
- macOS and Linux builds.

## Window & layout
- Compact mode (icon-only row) vs. expanded mode (current card layout).
- User-configurable polling interval (current: hardcoded 60s).
- Snap-to-edges / snap-to-monitor-corners while dragging.
- Collapsible "Not detected" cards (or a "Hide unavailable" toggle).
- Per-provider show/hide toggle in tray menu.
- Pin/unpin always-on-top from tray menu (currently always pinned).
- Themes (light/dark/auto-follow-OS).

## Detection improvements
- Shared package with claude-portal so detection logic doesn't drift across two codebases.
- Plugin model: third-party providers can register their own detector + card schema.
- Detect more providers: Cursor, Aider, GitHub Copilot, Gemini CLI.

## Auth & multi-account
- UI to paste a token if the credential file is missing (currently we just say "not detected").
- Multi-account per provider (e.g. two Claude accounts, switch between them).

## Cross-machine
- Optional cloud sync of settings (window position, open-at-login, hidden providers).
- Multi-machine view: see usage across all my dev boxes.

## DPI / display polish
- Re-clamp window position automatically when displays are added/removed at runtime (currently only handled on launch — see AC13).
- Sub-pixel-perfect position math at fractional DPI scaling (current v1 trusts Electron's logical pixels — see "Out of scope" in SPEC).

## Diagnostics
- "Copy diagnostics" tray menu item that dumps detected paths, last poll result, and error messages to clipboard for bug reports.
- Verbose logging mode toggle.
