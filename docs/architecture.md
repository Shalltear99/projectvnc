# Architecture & Infrastructure Specifications (`architecture.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. System Topology & Data Flow

```
                                [ End User Browser ]
                                         │
                                         │ HTTPS / WSS (Port 443)
                                         ▼
                             [ Edge Proxy / Nginx ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     [ Web Dashboard Client ]                         [ WebSocket Proxy Stream ]
     (Next.js React Frontend)                         (websockify / noVNC Stream)
                 │                                               │
                 ▼                                               ▼
      [ Backend Control API ]                         [ Isolated Worker Container ]
     (Node.js / Express Service)                       ├── TigerVNC Server
                 │                                     ├── Openbox WM
                 ├─► [ PostgreSQL DB ]                 └── OpenJDK JRE Instance
                 └─► [ Redis Event Queue ]
```

---

## 2. Component Layer Breakdown

### 2.1 Edge & Network Layer
* **Reverse Proxy:** Nginx edge router handling SSL/TLS termination, HTTP request routing, and dynamic WebSocket upgrading.
* **Stream Multiplexing:** Maps incoming request URIs (`wss://vnc.domain.com/vnc-stream/{container_id}`) directly to specific internal container ports.

### 2.2 Control Plane & API
* **Dashboard Engine:** Serves user dashboard, auth handlers, and instance management UI.
* **Orchestration API:** Interacts with Redis pub/sub queues and Docker daemon sockets to initiate container lifecycles (Start, Stop, Restart, Destroy).
* **Data Persistence:** 
  * **PostgreSQL:** User credentials, subscription dates, transaction logs, and node mappings.
  * **Redis:** Session tokens, live container metrics, and pub/sub message queue for async tasks.

### 2.3 Compute Worker Layer
* **Container Isolation:** Each user runs within an unprivileged Docker container constrained by cgroups and seccomp profiles.
* **Graphical Stack:**
  * **X Server:** `Xvfb` / `TigerVNC` headless virtual frame buffer.
  * **Window Manager:** `Openbox` for lightweight window layout without panel bloat.
  * **Display Forwarding:** `websockify` converting TCP RFB VNC frames into WebSocket messages.