# Development Tasks & Implementation Roadmap (`tasks.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## Milestone 1: Core Worker Container & VNC Stack
- [ ] **Task 1.1:** Create baseline `Dockerfile` with Ubuntu 22.04, TigerVNC, Openbox, and noVNC.
- [ ] **Task 1.2:** Configure `supervisord.conf` to manage headless display services automatically.
- [ ] **Task 1.3:** Test standalone `vnc_lite.html` execution in browser.

## Milestone 2: Backend Orchestration & API
- [ ] **Task 2.1:** Implement Dockerode / Docker Engine API bindings in Node.js backend.
- [ ] **Task 2.2:** Build container provisioning queue with dynamic port assignment.
- [ ] **Task 2.3:** Add Janitor daemon task (`agent-daemon.js`) to reclaim expired instances.

## Milestone 3: Frontend Dashboard & Integration
- [ ] **Task 3.1:** Build responsive Next.js dashboard UI with instance control buttons.
- [ ] **Task 3.2:** Embed VNC iframe using secure tokenized connection parameters.
- [ ] **Task 3.3:** Develop mobile virtual controller overlay component.

## Milestone 4: Production Hardening
- [ ] **Task 4.1:** Apply iptables firewall rules and cgroup limits.
- [ ] **Task 4.2:** Integrate Payment Gateway webhook callbacks for automated provisioning.