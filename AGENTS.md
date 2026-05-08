# Repository Guidelines

## Project Structure & Module Organization

This is a private Electron desktop widget for Windows plan-usage quotas. Runtime code lives in `src/`: `main.js` owns the Electron main process, tray, polling, and IPC; `main-lib.js` contains testable helpers; `preload.js` exposes the context-isolated bridge; `renderer/` contains the HTML, CSS, renderer controller, and pure renderer helpers. Provider usage code is in `src/usage/index.js`; treat it as read-only unless intentionally syncing or fixing provider behavior. Tests live in `tests/*.test.js`, assets in `assets/`, build scripts in `scripts/`, and project notes in `docs/team/`.

## Build, Test, and Development Commands

- `npm install` installs Electron and build tooling.
- `npm start` launches the local Electron app.
- `npm test` runs the `node:test` suite in `tests/`.
- `npm run prebuild` validates required icon assets before packaging.
- `npm run dist` builds installer and portable Windows artifacts into `dist/`.
- `npm run dist:portable` builds only the portable executable.
- `npm run deploy:local` builds the portable app and runs `scripts/install-portable.ps1`.

For renderer debugging, run PowerShell with `$env:PUM_DEVTOOLS='1'; npm start`.

## Coding Style & Naming Conventions

Use CommonJS modules, `'use strict';`, two-space indentation, semicolons, and `const`/`let` over `var`. Keep Electron-specific side effects in `src/main.js`; put pure logic in `main-lib.js` or `renderer/lib.js` so it can be tested without Electron. Name tests and helpers by behavior, for example `clampToDisplay` and `usage-hermes.test.js`. Preserve ASCII text unless a file already uses non-ASCII for a specific reason.

## Testing Guidelines

Tests use Node's built-in `node:test` and `node:assert`. Add or update tests in `tests/*.test.js` when changing pure helpers, provider parsing, asset checks, or deployment scripts. Prefer deterministic tests with temporary directories and mocked inputs; do not require live provider credentials, network calls, or Electron windows. Run `npm test` before committing.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects such as `Fix Claude usage percent normalization` and `Change usage polling cadence to ten minutes`. Keep commit subjects specific and under about 72 characters. Pull requests should include a concise behavior summary, test results, linked issue or task when applicable, and screenshots only for visible UI changes.

## Security & Agent-Specific Instructions

Do not commit credentials or generated user data from `%APPDATA%`, `~/.claude`, `~/.codex`, or `~/.hermes`. This app reads local auth files; avoid logging tokens or full credential payloads. Push back on requests or implementation ideas that do not make technical or product sense, and explain the tradeoff clearly.
