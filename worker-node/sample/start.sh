#!/bin/sh
# Example /opt/game/start.sh — compiled on first boot, then executed.
#
# Compilation happens in a WRITABLE directory owned by the container user, NOT
# in /opt/game. A bind mount carries the host's uid/gid, which almost never
# matches the container's 1000:1000, so writing next to the source fails with
# "Permission denied" and the instance silently shows an empty desktop.
set -eu
export DISPLAY="${DISPLAY:-:1}"
export XAUTHORITY="${XAUTHORITY:-/home/cloudjava/.Xauthority}"

SRC_DIR="/opt/game"
BUILD_DIR="${HOME:-/home/cloudjava}/build"
mkdir -p "$BUILD_DIR"

if [ ! -f "$BUILD_DIR/GameDemo.class" ] || [ "$SRC_DIR/GameDemo.java" -nt "$BUILD_DIR/GameDemo.class" ]; then
    echo "[start.sh] compiling GameDemo for release 8 into $BUILD_DIR"
    javac --release 8 -d "$BUILD_DIR" "$SRC_DIR/GameDemo.java"
fi

exec java -cp "$BUILD_DIR:$SRC_DIR" GameDemo
