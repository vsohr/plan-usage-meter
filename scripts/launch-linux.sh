#!/usr/bin/env bash
# Launch Plan Usage Meter on Linux.
#
# Runs the bundled Electron binary directly (not `npm start`/`electron .`) so the
# launcher works from a .desktop entry or autostart, where the session PATH may
# not contain the `node` used to install. Display/Wayland/sandbox switches are
# applied inside src/main.js for process.platform === 'linux'.
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
ELECTRON="$DIR/node_modules/electron/dist/electron"

if [[ ! -x "$ELECTRON" ]]; then
  echo "Electron binary not found at $ELECTRON" >&2
  echo "Run 'npm install' (and re-extract Electron if its postinstall left dist/ incomplete)." >&2
  exit 1
fi

exec "$ELECTRON" "$DIR" "$@"
