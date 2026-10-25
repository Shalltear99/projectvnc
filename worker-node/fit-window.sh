#!/bin/sh
# Scale the emulator window up to fill the virtual desktop.
#
# FreeJ2ME launches at scaleFactor 1, i.e. a 240x320 game sits in a 250x375
# window on a 1280x720 desktop — a fifth of the available area. This fits the
# window to the screen instead.
#
# Two things make this less trivial than "maximise the window":
#
#   1. FreeJ2ME letterboxes the LCD inside its own frame and paints the
#      leftover area with the LCD component's background, which is WHITE. So a
#      naive fullscreen resize gives a 1280x720 white canvas with a small game
#      in the middle — strictly worse than the small window. The fix is to size
#      the window to the GAME's aspect ratio, so there is no leftover area at
#      all; the surrounding desktop shows through instead of white.
#
#   2. The AWT menu bar (File/Settings/Debug) is inside the window, so the
#      client area is window height minus the menu bar. Sizing the window to the
#      target height would leave a sliver of white, hence MENU_BAR_PX is added.
#
# The window is re-fitted whenever the desktop geometry changes: a phone client
# asks for a different screen size, and without this the game would stay sized
# for the old geometry.
set -u

export DISPLAY="${DISPLAY:-:1}"
export XAUTHORITY="${XAUTHORITY:-/home/cloudjava/.Xauthority}"

WINDOW_NAME="${WINDOW_NAME:-FreeJ2ME-Plus}"
GAME_ASPECT="${GAME_ASPECT:-240x320}"
MENU_BAR_PX="${MENU_BAR_PX:-25}"

aw=${GAME_ASPECT%x*}
ah=${GAME_ASPECT#*x}
case "$aw" in ''|*[!0-9]*) aw=240 ;; esac
case "$ah" in ''|*[!0-9]*) ah=320 ;; esac
[ "$aw" -lt 1 ] && aw=240
[ "$ah" -lt 1 ] && ah=320

log() { echo "[fit-window] $*"; }

log "started (window=$WINDOW_NAME aspect=${aw}x${ah} menu=${MENU_BAR_PX}px)"

decorated=""

while :; do
    geom=$(xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2; exit}')
    if [ -z "${geom:-}" ]; then
        sleep 1
        continue
    fi
    sw=${geom%x*}
    sh=${geom#*x}

    wid=$(xdotool search --name "$WINDOW_NAME" 2>/dev/null | head -n1)
    if [ -z "${wid:-}" ]; then
        decorated=""
        sleep 1
        continue
    fi

    # Largest box with the game's aspect ratio that fits the CLIENT area.
    #
    # The menu bar is inside the window, so the client is MENU_BAR_PX shorter
    # than the desktop. Sizing the game to the full desktop height would push
    # the bottom MENU_BAR_PX rows of the game below the screen edge, and the WM
    # would clamp the window so they are simply cut off.
    client_h=$(( sh - MENU_BAR_PX ))
    [ "$client_h" -lt 1 ] && client_h=$sh
    fit_h=$client_h
    fit_w=$(( fit_h * aw / ah ))
    if [ "$fit_w" -gt "$sw" ]; then
        fit_w=$sw
        fit_h=$(( fit_w * ah / aw ))
    fi
    win_h=$(( fit_h + MENU_BAR_PX ))
    tx=$(( (sw - fit_w) / 2 ))
    ty=0
    [ "$tx" -lt 0 ] && tx=0

    # Drop the WM title bar once per window: it would otherwise be added on top
    # of the menu bar and push the game past the bottom edge.
    if [ "$decorated" != "$wid" ]; then
        xprop -id "$wid" -f _MOTIF_WM_HINTS 32c \
            -set _MOTIF_WM_HINTS "2,0,0,0,0" >/dev/null 2>&1 || true
        decorated=$wid
    fi

    # Compare against the window's ACTUAL geometry, not against what we last
    # asked for. FreeJ2ME calls setSize() itself whenever its settings are
    # applied (on MIDlet load, and again after the user changes a setting), which
    # silently reverts the fit back to scaleFactor 1. Keying off our own last
    # request made the fitter apply once, get overridden, and never retry — the
    # window ended up at 240x345 again.
    cur=$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)
    cw=$(printf '%s\n' "$cur" | awk -F= '/^WIDTH=/ {print $2}')
    ch=$(printf '%s\n' "$cur" | awk -F= '/^HEIGHT=/ {print $2}')
    cx=$(printf '%s\n' "$cur" | awk -F= '/^X=/ {print $2}')
    cy=$(printf '%s\n' "$cur" | awk -F= '/^Y=/ {print $2}')

    if [ "${cw:-}" = "$fit_w" ] && [ "${ch:-}" = "$win_h" ] \
        && [ "${cx:-}" = "$tx" ] && [ "${cy:-}" = "$ty" ]; then
        sleep 1
        continue
    fi

    if xdotool windowsize "$wid" "$fit_w" "$win_h" 2>/dev/null \
        && xdotool windowmove "$wid" "$tx" "$ty" 2>/dev/null; then
        log "fit $wid to ${fit_w}x${win_h} (game ${fit_w}x${fit_h}) at ${tx},${ty} on ${sw}x${sh}"
    fi

    sleep 1
done
