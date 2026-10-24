# Autonomous Agent Architecture & Lifecycle Specifications (`agents.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. Executive Summary & Agent Taxonomy

The **CloudJava VNC Engine** leverages an event-driven, multi-agent architecture designed to automate container provisioning, system resource enforcement, VNC session proxying, and proactive security isolation. 

### Agent Ecosystem Overview
```
                          [ Event Bus / Redis PubSub ]
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
[ Provisioning Agent ]       [ Telemetry Agent ]           [ Security & Janitor Agent ]
       │                               │                               │
       ├─► Docker Socket               ├─► cgroups Metrics             ├─► Network Bridge Firewall
       └─► Port Allocator              └─► WebSocket Heartbeats        └─► Expired Pod Reaper
```

---

## 2. Core Agent Specifications

### 2.1 Container Provisioning Agent (`ProvisionerAgent`)
* **Role:** Listens for payment settlement events and dynamically instantiates, configures, and binds isolated Docker VNC containers.
* **Execution Trigger:** Pub/Sub Event `ORDER_PAID`, API Directive `INSTANCE_REBUILD`.
* **Tasks & Responsibilities:**
  1. Reserve an unallocated internal WebSocket port (range `6000-7000`) and VNC port (`5900-6000`).
  2. Inject unique user environment credentials (`VNC_PASSWORD`, `JAVA_ENV_VERSION`).
  3. Spin up container using predefined cgroup limits (vCPU, Memory, Swap, Disk Quota).
  4. Register routing path dynamically with the **Proxy Routing Table**.
* **Failure Recovery:** Reverts port binding and emits `PROVISIONING_FAILED` if container creation exceeds 5,000ms.

---

### 2.2 Telemetry & Resource Monitor Agent (`MetricsAgent`)
* **Role:** Real-time observer running on worker nodes to monitor resource utilization and stream connection states.
* **Execution Interval:** Continuous daemon loop (Polling interval: `2000ms`).
* **Tasks & Responsibilities:**
  1. Inspect cgroup stats (`cpu.stat`, `memory.current`) per container ID.
  2. Detect inactive WebSocket streams (zero read/write frames for > 15 minutes).
  3. Emit low-memory warnings or throttle CPU if a user script violates soft limits.
  4. Stream real-time performance data to the user dashboard over WebSocket.

---

### 2.3 Security Guard & Janitor Agent (`JanitorAgent`)
* **Role:** Automated system cleaner and security enforcement officer.
* **Execution Trigger:** Cron schedule (Every 60s) & system alerts.
* **Tasks & Responsibilities:**
  1. **Session Reaping:** Immediately terminate and purge container storage when subscription validity drops below `0`.
  2. **Abuse Mitigation:** Monitor outbound traffic for unauthorized protocols (e.g., SMTP spamming, crypto-mining pools, excessive outbound UDP packets) and immediately lock network interfaces.
  3. **Orphan Cleanup:** Scan for zombie `Xvfb`/`TigerVNC` lock files (`/tmp/.X11-unix/`) or dangling Docker volumes and perform safe garbage collection.

---

## 3. Agent Communication & Workflow Protocols

### 3.1 Provisioning Workflow Sequence

```sequence
User -> API: Purchase Package
API -> EventBus: Publish "ORDER_PAID" (userID, planID)
EventBus -> ProvisionerAgent: Consume "ORDER_PAID"
ProvisionerAgent -> Docker Daemon: Create Container (Port Mapping, CPU/RAM Limit)
Docker Daemon --> ProvisionerAgent: Container Started (ID: c_9912)
ProvisionerAgent -> Nginx Router: Update Dynamic Upstream Proxy Path
ProvisionerAgent -> EventBus: Publish "INSTANCE_READY" (instanceURL, credentials)
API -> User: Render WebVNC Embed Page
```

---

## 4. Agent Error Handling & Health Check Matrix

| Agent Name | Critical Fail Condition | Detection Mechanism | Automated Recovery Action |
| :--- | :--- | :--- | :--- |
| **ProvisionerAgent** | Port collision / Docker Socket timeout | Timeout > 5s | Rollback container allocation, assign new port offset, retry once. |
| **MetricsAgent** | OOM (Out Of Memory) event inside container | Kernel cgroup OOM event listener | Send notification to user UI, automatically soft-restart JVM process. |
| **JanitorAgent** | Unauthorized crypto-mining execution | CPU utilization spiked at 100% across all cores for > 5 min without active GUI input | Suspend container network bridge, freeze container process, flag for admin review. |

---

## 5. Deployment Script for Agent Runtime (`agent-daemon.js`)

Below is the lightweight Node.js daemon skeleton for executing the `JanitorAgent` cleanup loop.

```javascript
/**
 * JanitorAgent - Worker Node Cleanup & Monitoring Daemon
 */
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const POLL_INTERVAL_MS = 60000;

async function runJanitorLoop() {
  console.log('[JanitorAgent] Starting container audit...');
  
  try {
    const containers = await docker.listContainers({ all: false });

    for (const containerInfo of containers) {
      const expiresAt = containerInfo.Labels['cloudjava.expires_at'];
      const instanceId = containerInfo.Labels['cloudjava.instance_id'];

      if (expiresAt && Date.now() > parseInt(expiresAt, 10)) {
        console.warn(`[JanitorAgent] Instance ${instanceId} has expired. Reaping...`);
        
        const container = docker.getContainer(containerInfo.Id);
        await container.stop({ t: 10 });
        await container.remove({ force: true });
        
        console.log(`[JanitorAgent] Successfully purged instance ${instanceId}.`);
      }
    }
  } catch (err) {
    console.error('[JanitorAgent] Error during janitor execution:', err);
  }
}

// Start agent loop
setInterval(runJanitorLoop, POLL_INTERVAL_MS);
```