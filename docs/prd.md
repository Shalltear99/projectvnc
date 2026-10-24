# Product Requirement Document (PRD)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. Document Overview
* **Product Name:** CloudJava VNC
* **Version:** 1.0.0
* **Status:** Draft
* **Target Release:** Q1 2027
* **Author:** Lead Product Architect

---

## 2. Product Summary & Objectives
CloudJava VNC is a web-based Remote Desktop Platform designed to run lightweight Java applications and retro Java games inside isolated server environments (Docker/LXC). Users can access full Java GUI runtime environments directly from any modern web browser without installing local VNC clients or Java runtimes.

### Key Objectives:
* Provide 1-click instantiation of isolated Java VNC environments.
* Deliver low-latency HTML5-based remote rendering using **noVNC** and **Websockify**.
* Enable automated billing, container lifecycle management, and resource controls.
* Support cross-device accessibility (Desktop, Tablet, Mobile) with custom virtual gamepad overlays.

---

## 3. Target Audience & Use Cases
1. **Java Mobile/Retro Game Enthusiasts:** Playing classic J2ME or Java PC games on modern browsers.
2. **24/7 Java Game Botting:** Running automated Java tasks/bots in persistent cloud instances.
3. **Low-spec Hardware Users:** Executing resource-heavy Java apps via cloud stream.

---

## 4. Functional Requirements

### 4.1 User Management & Authentication
* **FR-1.1:** Sign up/Login via Email/Password, OAuth 2.0 (Google, Discord).
* **FR-1.2:** Account Security: Rate limiting, password encryption (bcrypt/argon2), session tokens.
* **FR-1.3:** User Dashboard for monitoring active instances, CPU/RAM usage, and billing.

### 4.2 WebVNC Client Experience
* **FR-2.1:** **Embedded Canvas Display:** Integrated noVNC HTML5 canvas stripped of native control bars for an immersive iframe experience.
* **FR-2.2:** **Auto-Connect & Auto-Scale:** Direct connection using secure WebSocket (`wss://`) with automatic viewport scaling.
* **FR-2.3:** **Input Handling:** Full keyboard, mouse mapping, touchscreen gesture translation, and on-screen virtual keypad for mobile devices.
* **FR-2.4:** **Clipboard Sync:** Bi-directional text pasting between host OS and remote desktop.

### 4.3 Instance & Container Management
* **FR-3.1:** Automated provisioning of Docker containers upon successful payment callback.
* **FR-3.2:** Instance operations: **Start**, **Stop**, **Restart**, and **Reset System**.
* **FR-3.3:** Pre-configured environments:
  * OpenJDK 8, OpenJDK 11, OpenJDK 17, OpenJDK 21.
  * MicroVM/Desktop Environments (XFCE / Openbox / Kiosk Mode).
  * Pre-loaded J2ME Emulators (MicroEmu, KEmulator) & Java Game Launchers.

### 4.4 Billing & Monetization
* **FR-4.1:** Integration with Indonesian Payment Gateways (Midtrans / Xendit / Tripay).
* **FR-4.2:** Subscription plans (Daily, Weekly, Monthly).
* **FR-4.3:** Automated suspension and cleanup of expired containers.

---

## 5. Non-Functional Requirements

### 5.1 Performance & Reliability
* **Latency:** End-to-end VNC input-to-render latency under 100ms in regional network zones.
* **Uptime:** 99.5% uptime target for worker nodes.
* **Resource Limits:** Strict CPU, Memory, and Disk I/O capping per container using Docker cgroups.

### 5.2 Security & Isolation
* **Security:** No root privilege escalation inside containers.
* **Network Isolation:** Docker network bridging with strict firewall rules blocking outbound abuse (SMTP, mining pools).
* **Encrypted Stream:** All VNC traffic passed over WebSocket Secure (`wss://`) via Nginx Reverse Proxy.

---

## 6. Architecture Overview
```
[ User Browser / Mobile ]
        │
        │ HTTPS / WSS (Port 443)
        ▼
[ Nginx Reverse Proxy / SSL Termination ]
        │
        ├──► Dashboard API (Node.js/Go)
        │
        └──► Websockify Proxy (Port 6080)
                    │
                    │ TCP VNC Stream (Port 5901)
                    ▼
          [ Docker Container ]
          ├── TigerVNC Server (x11vnc)
          ├── Openbox / XFCE
          └── OpenJDK / Game App
```

---

## 7. Metrics & Success KPIs
* **P95 Latency:** < 120ms frame delivery.
* **Provisioning Time:** New VNC instance created and ready in < 5 seconds.
* **Concurrent Streams:** Support up to 50 active VNC streams per worker node (depending on RAM/vCPU).