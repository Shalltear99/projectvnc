#!/bin/sh
# Launch whatever the instance was provisioned for.
# Order: explicit launcher -> J2ME jar -> keep an empty kiosk desktop.
set -u

export DISPLAY="${DISPLAY:-:1}"
export XAUTHORITY="${XAUTHORITY:-/home/cloudjava/.Xauthority}"

# Wait (max 20s) for the X server to accept connections
i=0
while [ $i -lt 40 ]; do
    if xdpyinfo >/dev/null 2>&1; then break; fi
    i=$((i + 1)); sleep 0.5
done

# Paint the root window in the product's slate-900 so an idle desktop is the
# design colour instead of a black void (which reads as "stream broken").
if command -v xsetroot >/dev/null 2>&1; then
    xsetroot -solid "#0F172A" 2>/dev/null || true
fi

# Bind-mounted files often arrive without the exec bit (host copy, config map,
# git checkout on a noexec mount). Presence, not permission, decides whether the
# instance has a launcher.
if [ -f /opt/game/start.sh ]; then
    if [ -x /opt/game/start.sh ]; then
        exec /opt/game/start.sh
    fi
    exec /bin/sh /opt/game/start.sh
fi

# /opt/game may be a read-only bind mount owned by an arbitrary host uid, so
# never assume write access there; FreeJ2ME's own state dir lives in $HOME.
JAR="$(ls /opt/game/*.jar 2>/dev/null | head -n1 || true)"
if [ -n "$JAR" ]; then
    if [ -f /opt/emulator/freej2me.jar ]; then
        # -noverify
        #   The Ksatria jar (and the stock original it was built from) carries
        #   v52 classes with no StackMapTable, so a strict JVM dies with
        #   VerifyError inside the MIDlet constructor before anything paints.
        #   Verified: without this the window stays blank white.
        #
        # -Dfile.encoding BEFORE -jar
        #   FreeJ2ME self-restarts when the platform encoding is not
        #   ISO_8859_1, and that restart re-execs java WITHOUT the jar argument
        #   ("java -jar -Dfile.encoding=... freej2me.jar" — the -D lands after
        #   -jar, so it is an app arg, not a JVM flag). Result: a blank emulator
        #   shell and no game. Setting the encoding up front prevents the
        #   restart entirely.
        exec java -noverify -Dfile.encoding=ISO_8859_1 \
            -jar /opt/emulator/freej2me.jar "$JAR"
    fi
    exec java -jar "$JAR"
fi

# Nothing to run: show the idle screen rather than a blank rectangle. A user
# cannot distinguish "connected and idle" from "connected but broken", and
# support cannot either.
echo "[run-game] no launcher or jar found; starting the idle screen"
if [ -f /usr/local/share/cloudjava/InfoApp.class ]; then
    exec java -cp /usr/local/share/cloudjava InfoApp
fi

# Last resort: keep the session alive so the desktop stays reachable.
while :; do sleep 30; done