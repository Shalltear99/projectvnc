#!/bin/sh
# CloudJava VNC worker entrypoint.
# Binds the injected VNC password, prepares the X auth cookie, then hands the
# process tree to supervisord. Fails fast: a container that starts without a
# password would expose an unauthenticated desktop.
set -eu

VNC_PASSWORD="${VNC_PASSWORD:-}"
if [ -z "$VNC_PASSWORD" ]; then
    echo "[entrypoint] FATAL: VNC_PASSWORD is not set; refusing to start an unauthenticated desktop" >&2
    exit 64
fi
if [ "${#VNC_PASSWORD}" -lt 6 ]; then
    echo "[entrypoint] FATAL: VNC_PASSWORD must be at least 6 characters" >&2
    exit 64
fi

VNC_HOME="${HOME:-/home/cloudjava}"
mkdir -p "$VNC_HOME/.vnc" "$VNC_HOME/var/run" "$VNC_HOME/var/log" /tmp/.X11-unix
chmod 0700 "$VNC_HOME/.vnc"

# RFB password file (obfuscated, not encrypted — never the raw secret)
printf '%s\n' "$VNC_PASSWORD" | vncpasswd -f > "$VNC_HOME/.vnc/passwd"
chmod 0600 "$VNC_HOME/.vnc/passwd"

# X auth cookie so openbox/xdotool/java can reach the display
if [ ! -s "$VNC_HOME/.Xauthority" ]; then
    xauth -f "$VNC_HOME/.Xauthority" add ":1" . "$(mcookie)" >/dev/null 2>&1 || true
fi
chmod 0600 "$VNC_HOME/.Xauthority" 2>/dev/null || true
export XAUTHORITY="$VNC_HOME/.Xauthority"

# Select the JDK requested by the control plane (8 | 11 | 17 | 21)
case "${JAVA_ENV_VERSION:-17}" in
    8)  export JAVA_HOME=/usr/lib/jvm/java-8-openjdk-amd64 ;;
    11) export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64 ;;
    17) export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ;;
    21) export JAVA_HOME=/opt/java/21 ;;
    *)  echo "[entrypoint] FATAL: unsupported JAVA_ENV_VERSION '${JAVA_ENV_VERSION}'" >&2; exit 64 ;;
esac
if [ ! -x "$JAVA_HOME/bin/java" ]; then
    echo "[entrypoint] FATAL: JAVA_HOME $JAVA_HOME is not a usable JRE" >&2
    exit 64
fi
export PATH="$JAVA_HOME/bin:$PATH"

# Seed the game volume on first boot.
#
# /opt/game is a per-instance named volume, so every new instance starts with it
# empty even though the image ships a game library in /opt/games-defaults. Only
# copy when empty: re-seeding on every restart would silently overwrite whatever
# the user put there.
if [ -d /opt/games-defaults ] && [ -z "$(ls -A /opt/game 2>/dev/null)" ]; then
    cp -a /opt/games-defaults/. /opt/game/ 2>/dev/null \
        && echo "[entrypoint] seeded /opt/game from bundled defaults"
fi

# Stale lock files from a previous incarnation of this container
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

echo "[entrypoint] display=:1 ${SCREEN_W}x${SCREEN_H}x${SCREEN_DEPTH} java=$(java -version 2>&1 | head -n1) ws=:${WS_PORT}"

exec /usr/bin/supervisord -c /etc/supervisor/cloudjava.conf -n
