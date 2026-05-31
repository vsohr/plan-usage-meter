#!/usr/bin/env bash
# Install Plan Usage Meter into the current Linux desktop session:
#   - app icon into the hicolor theme (from assets/app-icon.png)
#   - .desktop launcher (app menu + Desktop folder)
#   - XDG autostart entry (launch on login)
#   - KWin window rule (KDE Plasma): pin bottom-right + keep above + hide from taskbar + show on all virtual desktops
#
# Wayland forbids a client from positioning or raising itself, so the pin/always-on-top
# behaviour is delegated to a KWin rule. The rule matches the window's app-id
# (resourceClass) "plan-usage-meter". Re-run any time; it is idempotent.
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
APP_ID="plan-usage-meter"
NAME="Plan Usage"
SRC_ICON="$DIR/assets/app-icon.png"
LAUNCHER="$DIR/scripts/launch-linux.sh"

# Bottom-right anchor for a 180px-wide window above a bottom panel. Adjust to taste.
POS_X=2364
POS_Y=1170

have() { command -v "$1" >/dev/null 2>&1; }
log()  { printf '  %s\n' "$1"; }

echo "Installing $NAME from $DIR"

# 1) Icon -> hicolor theme ----------------------------------------------------
echo "[1/4] Icons"
if   have magick;  then IM() { magick "$SRC_ICON" -resize "${1}x${1}" "$2"; }
elif have convert; then IM() { convert "$SRC_ICON" -resize "${1}x${1}" "$2"; }
else echo "ERROR: ImageMagick (magick/convert) required for icon install" >&2; exit 1; fi
ICON_BASE="$HOME/.local/share/icons/hicolor"
for sz in 16 22 24 32 48 64 128 256 512; do
  dest="$ICON_BASE/${sz}x${sz}/apps/$APP_ID.png"
  mkdir -p "$(dirname "$dest")"
  IM "$sz" "$dest"
done
log "installed $APP_ID.png at 16..512 under $ICON_BASE"
have gtk-update-icon-cache && gtk-update-icon-cache -qtf "$ICON_BASE" 2>/dev/null || true

# 2) .desktop entries ---------------------------------------------------------
echo "[2/4] Desktop entries"
read -r -d '' DESKTOP <<EOF || true
[Desktop Entry]
Type=Application
Name=$NAME
GenericName=Plan usage meter
Comment=Claude / Codex plan-usage quotas, always on top
Exec=$LAUNCHER
Icon=$APP_ID
Terminal=false
Categories=Utility;Monitor;
StartupWMClass=$APP_ID
StartupNotify=false
EOF

APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
printf '%s\n' "$DESKTOP" > "$APPS_DIR/$APP_ID.desktop"
log "menu launcher  -> $APPS_DIR/$APP_ID.desktop"

if [[ -d "$HOME/Desktop" ]]; then
  printf '%s\n' "$DESKTOP" > "$HOME/Desktop/$APP_ID.desktop"
  chmod +x "$HOME/Desktop/$APP_ID.desktop"
  log "desktop icon   -> $HOME/Desktop/$APP_ID.desktop"
fi

AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
printf '%s\n' "$DESKTOP" > "$AUTOSTART_DIR/$APP_ID.desktop"
log "autostart      -> $AUTOSTART_DIR/$APP_ID.desktop"

have update-desktop-database && update-desktop-database "$APPS_DIR" 2>/dev/null || true

# 3) KWin rule: pin bottom-right + keep above + skip taskbar ------------------
echo "[3/4] KWin window rule (pin + always-on-top)"
if have kwriteconfig6; then KW=kwriteconfig6
elif have kwriteconfig5; then KW=kwriteconfig5
else KW=""; fi
if [[ -n "$KW" ]]; then
  UUID="a7c3e1f0-1234-4567-89ab-cdef00000001"
  set_rule() { "$KW" --file kwinrulesrc --group "$UUID" --key "$1" "$2"; }
  set_rule Description "$NAME (pinned bottom-right, always on top)"
  set_rule wmclass "$APP_ID"
  set_rule wmclassmatch 1          # 1 = exact match
  set_rule wmclasscomplete false
  set_rule above true;        set_rule aboverule 2        # 2 = Force (always on top)
  set_rule skiptaskbar true;  set_rule skiptaskbarrule 2
  set_rule skipswitcher true; set_rule skipswitcherrule 2
  set_rule skippager true;    set_rule skippagerrule 2
  # Empty desktops list + Force (2) = show on all virtual desktops, so the meter
  # follows the user across workspaces instead of staying on the launch desktop.
  # (Wayland forbids the client from setting this itself, like above/position.)
  set_rule desktops "";       set_rule desktopsrule 2
  # 4 = Remember: open bottom-right initially, then persist wherever it is dragged
  # (KWin writes the position back to this rule). Draggable, unlike Force (2).
  set_rule position "$POS_X,$POS_Y"; set_rule positionrule 4
  "$KW" --file kwinrulesrc --group General --key count 1
  "$KW" --file kwinrulesrc --group General --key rules "$UUID"
  log "wrote rule [$UUID] -> ~/.config/kwinrulesrc"
  if have dbus-send; then
    dbus-send --session --type=method_call --dest=org.kde.KWin /KWin org.kde.KWin.reconfigure 2>/dev/null \
      && log "reloaded KWin config" || log "could not reload KWin (will apply next login)"
  fi
else
  log "kwriteconfig not found - skipping KWin rule (not KDE?). Pin/always-on-top will need manual setup."
fi

# 4) Done ---------------------------------------------------------------------
echo "[4/4] Done"
echo
echo "$NAME installed. Launch from the app menu / Desktop, or it starts automatically next login."
echo "Restart it now to apply the KWin rule (pin bottom-right + always on top)."
