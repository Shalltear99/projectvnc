# syntax=docker/dockerfile:1.7
###############################################################################
# CloudJava VNC — Worker Node Image
# Headless Ubuntu 22.04 + TigerVNC + Openbox + OpenJDK (8/11/17/21) + websockify
#
# Hard rules (docs/onboarding.md §3.2, docs/security.md):
#   * runs as non-root uid/gid 1000:1000
#   * VNC (5901) binds to 127.0.0.1 only — never published
#   * only websockify (6080) is exposed; the host maps it into 6000-7000
#   * every process is supervised so a crashed JVM cannot orphan the display
###############################################################################
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NOVNC_VERSION=1.5.0
ARG FREEJ2ME_VERSION=1.52
ARG INSTALL_FREEJ2ME=true
ARG TEMURIN_21_URL="https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse"

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=Asia/Jakarta \
    DISPLAY=:1 \
    SCREEN_W=1280 \
    SCREEN_H=720 \
    SCREEN_DEPTH=24 \
    VNC_PORT=5901 \
    WS_PORT=6080 \
    JAVA_ENV_VERSION=17 \
    GAME_WINDOW_NAME=FreeJ2ME-Plus \
    GAME_ASPECT=240x320 \
    HOME=/home/cloudjava

# Full JREs, NOT -headless: the headless packages ship no libawt_xawt.so, so
# every Swing/AWT application dies with HeadlessException and the desktop stays
# an empty grey void with no error anyone would notice. The X client libraries
# below are the AWT natives (drawing, keyboard/mouse, multi-monitor).
RUN apt-get update && apt-get install -y --no-install-recommends \
        tigervnc-standalone-server tigervnc-common tigervnc-tools \
        openbox \
        x11-utils x11-xserver-utils xauth xdotool \
        openjdk-8-jre openjdk-11-jre openjdk-17-jre \
        openjdk-17-jdk-headless \
        libxext6 libxrender1 libxtst6 libxi6 libxinerama1 \
        supervisor \
        python3 python3-pip python3-numpy \
        curl ca-certificates unzip procps psmisc net-tools \
        fontconfig libfreetype6 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# websockify: TCP RFB -> WebSocket bridge. Pinned; jammy has no distro package.
RUN pip3 install --no-cache-dir "websockify==0.12.0"

# OpenJDK 21 (not in jammy repos) — Temurin JRE tarball
RUN mkdir -p /opt/java \
    && curl -fsSL --retry 3 -o /tmp/jre21.tar.gz "$TEMURIN_21_URL" \
    && tar -xzf /tmp/jre21.tar.gz -C /opt/java \
    && rm -f /tmp/jre21.tar.gz \
    && ln -sfn "$(find /opt/java -maxdepth 1 -type d -name 'jdk-21*' | head -n1)" /opt/java/21

# noVNC static client (websockify --web) — for direct worker-side debugging
RUN curl -fsSL --retry 3 -o /tmp/novnc.zip \
        "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.zip" \
    && unzip -qo /tmp/novnc.zip -d /tmp \
    && mkdir -p /usr/share/novnc \
    && cp -r "/tmp/noVNC-${NOVNC_VERSION}/core" "/tmp/noVNC-${NOVNC_VERSION}/vendor" \
              "/tmp/noVNC-${NOVNC_VERSION}/vnc_lite.html" /usr/share/novnc/ \
    && rm -rf /tmp/novnc.zip "/tmp/noVNC-${NOVNC_VERSION}"

# Optional J2ME emulator (docs/prd.md FR-3.3). FreeJ2ME-Plus is the maintained
# open-source MIDP runtime; MicroEmu/KEmulator are not redistributable.
RUN if [ "$INSTALL_FREEJ2ME" = "true" ]; then \
        curl -fsSL --retry 3 -o /tmp/fj.zip \
          "https://github.com/TASEmulators/freej2me-plus/releases/download/${FREEJ2ME_VERSION}/freej2me-v${FREEJ2ME_VERSION}.zip" \
        && mkdir -p /opt/emulator \
        && unzip -qo /tmp/fj.zip -d /opt/emulator \
        && rm -f /tmp/fj.zip ; \
    fi

# Non-root runtime user — uid/gid 1000 as mandated by the spec
RUN groupadd -g 1000 cloudjava \
    && useradd -m -u 1000 -g 1000 -s /bin/bash cloudjava \
    && mkdir -p /home/cloudjava/.vnc /home/cloudjava/var/{run,log} /opt/game /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown -R 1000:1000 /home/cloudjava /opt/game /opt/emulator /opt/java 2>/dev/null || true

# Idle screen, compiled once here so the runtime needs no JDK toolchain for it.
COPY --chown=1000:1000 info-app/InfoApp.java /usr/local/share/cloudjava/src/InfoApp.java
RUN javac --release 8 -d /usr/local/share/cloudjava /usr/local/share/cloudjava/src/InfoApp.java \
    && rm -rf /usr/local/share/cloudjava/src

COPY --chown=1000:1000 supervisord.conf /etc/supervisor/cloudjava.conf
COPY --chown=1000:1000 entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=1000:1000 run-game.sh   /usr/local/bin/run-game.sh
COPY --chown=1000:1000 center-windows.sh /usr/local/bin/center-windows.sh
COPY --chown=1000:1000 fit-window.sh /usr/local/bin/fit-window.sh
# Bundled game library. /opt/game is a per-instance volume, so it cannot be
# populated at build time; defaults live here and the entrypoint seeds the
# volume on first boot.
COPY --chown=1000:1000 games/ /opt/games-defaults/

COPY --chown=1000:1000 openbox-rc.xml /etc/xdg/openbox/rc.xml
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/run-game.sh \
        /usr/local/bin/center-windows.sh /usr/local/bin/fit-window.sh

USER 1000:1000
WORKDIR /home/cloudjava

EXPOSE 6080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD pgrep -f '^/usr/bin/Xtigervnc' >/dev/null \
        && curl -fsS -o /dev/null "http://127.0.0.1:${WS_PORT}/vnc_lite.html" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
