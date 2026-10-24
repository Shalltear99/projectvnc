# UI/UX & Design System Specifications (`design.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. User Interface Layout

### 1.1 Embedded Remote Desktop Viewer
To match the seamless experience of platforms like `belivnc.com`, the VNC canvas must occupy the maximum available viewport area, hiding standard remote desktop chrome.

```
+-----------------------------------------------------------------------+
|  CloudJava VNC Header (Status: Connected | Ping: 24ms) [ Fullscreen ] |
+-----------------------------------------------------------------------+
|                                                                       |
|                                                                       |
|                         VNC Canvas Viewport                           |
|                    (Rendered inside <iframe>)                         |
|                                                                       |
|                                                                       |
+-----------------------------------------------------------------------+
|  Mobile Gamepad Overlay (Shown on Mobile/Tablet Touchscreens)         |
|  [ D-Pad ]                                           [ A ]  [ B ]     |
+-----------------------------------------------------------------------+
```

---

## 2. Design Tokens & Styling (Tailwind CSS Basis)

### 2.1 Color Palette
* **Primary / Accent:** Indigo/Violet (`#6366F1` / `#4F46E5`)
* **Background Dark:** Slate 900 (`#0F172A`)
* **Card / Surface Dark:** Slate 800 (`#1E293B`)
* **Status Success:** Emerald 500 (`#10B981`)
* **Status Error:** Rose 500 (`#F43F5E`)

### 2.2 Typography
* **Primary Font:** Inter / System Sans-serif (Clean UI rendering).
* **Monospace Font:** JetBrains Mono or Fira Code (For connection logs and container IP display).

---

## 3. Mobile Virtual Gamepad

* **Overlay Elements:** Translucent floating D-Pad (Left) and Action buttons (Right) using HTML5 Touch Events mapped to keydown/keyup events sent to the noVNC key input handler.