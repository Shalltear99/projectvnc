#!/usr/bin/env bash
# Worker egress firewall (docs/security.md §1 outbound abuse, §2 isolation).
#
# Containers may reach the internet for game downloads, but must not be usable
# as a spam relay, a miner, or a DDoS source. Rules are applied to the worker
# bridge only — never to the host's own traffic.
#
# Apply once per host after Docker creates the bridge:
#   sudo ./iptables-worker-egress.sh cloudjava-worker-br
set -euo pipefail

BRIDGE="${1:-docker0}"
CHAIN="CLOUDJAVA_EGRESS"

if [ "$(id -u)" -ne 0 ]; then
    echo "must run as root" >&2
    exit 1
fi

echo "[egress] applying rules to bridge ${BRIDGE}"

# Idempotent: rebuild our chain from scratch
iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"

# ── SMTP: block submission and relay ports outright ──────────────────────────
for port in 25 465 587 2525; do
    iptables -A "$CHAIN" -p tcp --dport "$port" -j REJECT --reject-with tcp-reset
done

# ── Known mining pools ───────────────────────────────────────────────────────
# Placeholder list: keep it in a file so it can be updated without editing the
# script. Empty file = no pool blocking (still covered by the CPU-abuse agent).
POOL_FILE="/etc/cloudjava/mining-pools.txt"
if [ -f "$POOL_FILE" ]; then
    while read -r ip; do
        [ -z "$ip" ] && continue
        case "$ip" in \#*) continue ;; esac
        iptables -A "$CHAIN" -d "$ip" -j REJECT
    done < "$POOL_FILE"
fi

# ── Abuse-prone services ─────────────────────────────────────────────────────
# IRC (botnet C2), SMB/NetBIOS (worm propagation), Telnet
for port in 6667 6660:6669 445 139 23; do
    iptables -A "$CHAIN" -p tcp --dport "$port" -j REJECT
done

# ── Rate-limit DNS amplification and raw UDP floods ──────────────────────────
iptables -A "$CHAIN" -p udp --dport 53 -m limit --limit 20/second --limit-burst 40 -j ACCEPT
iptables -A "$CHAIN" -p udp --dport 53 -j DROP
iptables -A "$CHAIN" -p udp -m limit --limit 200/second --limit-burst 400 -j ACCEPT
iptables -A "$CHAIN" -p udp -j DROP

# ── Allow everything else (game assets, updates) ─────────────────────────────
iptables -A "$CHAIN" -j RETURN

# Hook the chain into FORWARD for traffic sourced from the worker bridge
iptables -C FORWARD -i "$BRIDGE" -j "$CHAIN" 2>/dev/null || \
    iptables -I FORWARD 1 -i "$BRIDGE" -j "$CHAIN"

# ── Never expose RFB to the internet (docs/security.md §2) ───────────────────
iptables -C INPUT -p tcp --dport 5900:6000 -j DROP 2>/dev/null || {
    iptables -A INPUT -p tcp --dport 5900:6000 -j DROP
    echo "[egress] RFB range 5900-6000 closed to inbound"
}

echo "[egress] done. Verify with: iptables -L $CHAIN -n -v"
