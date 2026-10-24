# Quality Assurance & Testing Plan (`testing.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. Unit & Integration Testing

### 1.1 Container Lifecycle Verification
* **Test Case:** `TC-01: Container Lifecycle`
* **Procedure:** Execute automated integration script calling Backend API to create, query status, stop, and destroy a worker instance.
* **Expected Result:** Container completes full lifecycle within < 5 seconds without dangling resource leaks.

---

## 2. Performance & Load Testing

### 2.1 Stream Latency & Concurrent Load
* **Tool:** `k6` / `Autocannon` WebSocket load test script.
* **Target:** 50 active concurrent WebSocket VNC connections on a single worker node.
* **Acceptance Criteria:** Average frame delivery latency remains below **120ms** with zero dropped WebSocket frames.

---

## 3. Mobile Usability Verification

* **Test Case:** `TC-02: Mobile Touch Responsiveness`
* **Procedure:** Access embedded `vnc_lite.html` page on iOS Safari and Android Chrome devices.
* **Expected Result:** Touch taps correctly register as mouse clicks, and virtual gamepad buttons trigger keypress events without viewport zooming artifacts.