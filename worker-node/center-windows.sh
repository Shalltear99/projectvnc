#!/bin/sh
# Keep the single application window centred on the virtual desktop.
#
# Two problems this solves:
#   1. There is no window manager rule that can centre a window whose size is
#      decided by the application at runtime.
#   2. When a phone connects, the client asks for a different desktop size
#      (e.g. 520x1125). The X server resizes, but the application keeps the
#      coordinates it had on the old geometry and ends up hanging off the right
#      edge — there is nothing to re-place it.
#
# So: poll the root geometry, and whenever it changes (or the window size
# changes), recompute the centred position and move the window only if the
# target actually differs. Moving on every tick would fight the client.
set -u

export DISPLAY="${DISPLAY:-:1}"
export XAUTHORITY="${XAUTHORITY:-/home/cloudjava/.Xauthority}"

MIN_SIZE=120          # ignore Openbox helper windows (1x1) and popups
last_key=""

log() { echo "[center-windows] $*"; }

log "started"

while :; do
    geom=$(xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2; exit}')
    if [ -z "${geom:-}" ]; then
        sleep 1
        continue
    fi
    sw=${geom%x*}
    sh=${geom#*x}

    # xwininfo prints e.g.
    #   0x2000af (has no name): ()  720x460+0+0  +0+0
    #   0x4000b8 "GameDemo": ("GameDemo" "GameDemo")  1x1+1+1  +1+1
    # The id and the geometry are NOT adjacent — the window name sits between
    # them — so a single combined regex matches nothing at all and the loop
    # silently never centres anything. Extract the id and the size separately.
    #
    # Pick the LARGEST mapped window: a class name matches the real frame, its
    # children, and 1x1 helpers, so size is the only reliable discriminator.
    best_id=""
    best_area=0
    best_w=0
    best_h=0

    for line in $(xwininfo -root -children 2>/dev/null \
        | sed -n 's/^ *\(0x[0-9a-fA-F]*\).*[^0-9]\([0-9]\{1,\}\)x\([0-9]\{1,\}\)[+-][0-9-]*[+-][0-9-]*.*/\1:\2:\3/p'); do
        wid=${line%%:*}
        rest=${line#*:}
        w=${rest%%:*}
        h=${rest#*:}
        case "$w" in ''|*[!0-9]*) continue ;; esac
        case "$h" in ''|*[!0-9]*) continue ;; esac
        [ "$w" -lt "$MIN_SIZE" ] && continue
        [ "$h" -lt "$MIN_SIZE" ] && continue
        area=$((w * h))
        if [ "$area" -gt "$best_area" ]; then
            best_area=$area
            best_id=$wid
            best_w=$w
            best_h=$h
        fi
    done

    if [ -n "$best_id" ]; then
        tx=$(( (sw - best_w) / 2 ))
        ty=$(( (sh - best_h) / 2 ))
        [ "$tx" -lt 0 ] && tx=0
        [ "$ty" -lt 0 ] && ty=0
        key="${best_id}:${best_w}x${best_h}@${sw}x${sh}"
        if [ "$key" != "$last_key" ]; then
            if xdotool windowmove "$best_id" "$tx" "$ty" 2>/dev/null; then
                log "moved $best_id (${best_w}x${best_h}) to ${tx},${ty} on ${sw}x${sh}"
                last_key="$key"
            fi
        fi
    fi

    sleep 1
done
