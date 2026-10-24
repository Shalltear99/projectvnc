# Security & Threat Mitigation Architecture (`security.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. Threat Model & Risk Matrix

| Risk Factor | Threat Description | Mitigation Strategy |
| :--- | :--- | :--- |
| **Container Breakout** | User escapes Docker namespace to gain root access on host. | Run containers with `--user 1000:1000`, dropped capabilities (`--cap-drop=ALL`), and active AppArmor/Seccomp profiles. |
| **Outbound Spam/Abuse** | Instance used for outbound DDoS, SMTP spamming, or crypto-mining. | Strictly restrict container egress network traffic via iptables. Block ports 25, 465, 587, and known mining pool IP lists. |
| **Unauthenticated VNC Access** | External scanner directly accesses internal VNC port. | Bind internal VNC ports (`5901+`) exclusively to `127.0.0.1`. Route all external connections through authenticated `wss://` proxy endpoints. |
| **Brute-Force Attacks** | Automated login attempts on dashboard. | Implement rate limiting (5 attempts/min) using Redis-backed API gateway middleware. |

---

## 2. Network Isolation Rules (Iptables Firewall)

```bash
# Drop all direct external connections to internal VNC ranges
iptables -A INPUT -p tcp --dport 5900:6000 -i eth0 -j DROP

# Allow loopback communication between Nginx proxy and Websockify ports
iptables -A INPUT -p tcp --dport 6000:7000 -i lo -j ACCEPT
```