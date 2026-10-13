# DropZone 🌀

> **Drop it. Send it. Done.**  
> AirDrop-style local network file transfers for everyone — Windows, macOS, Linux.

---

## Download

| Platform | Link |
|----------|------|
| 🪟 **Windows** (installer) | [DropZone Setup 1.0.0.exe](https://github.com/cy-rus404/DropZone/releases/latest) |
| 🪟 **Windows** (portable)  | [DropZone 1.0.0.exe](https://github.com/cy-rus404/DropZone/releases/latest) |
| 🍎 **macOS** (DMG)         | [DropZone-1.0.0.dmg](https://github.com/cy-rus404/DropZone/releases/latest) |

> Both devices must be on the same WiFi or LAN network.

> **macOS users:** The app is not code-signed. After dragging DropZone to Applications, right-click the app → **Open** → click **Open** in the dialog. You only need to do this once.

---

## What it does

DropZone sits as a small floating pill at the top of your screen. Drag a file onto it, pick a device, and it transfers instantly — no cloud, no cables, no accounts.

**Features:**

- **Always-on floating notch** — tiny pill sits at the top of your screen, out of the way until you need it
- **Drag & drop anything** — files, images, videos, any size, no limits
- **Automatic device discovery** — devices on your network appear instantly, no IP addresses needed
- **AirDrop-style prompts** — receiver gets an Accept / Decline popup with file details
- **PIN protection** — receiver can require a PIN; when a sender connects, receiver taps "Share PIN" and it fills automatically on the sender's side
- **Default save folder** — skip the save dialog every time, files land directly in your chosen folder
- **Ping** — tap the 🔔 next to any device to send a quick attention ping
- **Glassmorphism UI** — frosted glass aesthetic with smooth Framer Motion animations

---

## How to use

1. Open DropZone on both devices
2. Wait a moment — devices discover each other automatically
3. Drag a file onto the pill on the sending device
4. Click the receiver's device name
5. Receiver clicks **Accept** → file transfers

That's it.

---

## PIN protection

Enable in **Settings ⚙️ → Require PIN from senders**.

When a sender tries to connect, you (the receiver) get a popup asking if you want to share your PIN. Tap **Share PIN** — it fills in automatically on the sender's machine. The sender never has to type anything manually.

---

## Requirements

- Both devices on the same WiFi/LAN
- Port **54321 TCP** open between devices (added automatically on Windows via firewall rules)
- Windows 10 or later (for the installer build)
- macOS 10.13 or later (for the DMG build)

---

## Build from source

```bash
# Clone
git clone https://github.com/cy-rus404/DropZone.git
cd DropZone

# Install dependencies
npm install

# Run in development
npm run dev

# Build Windows installer
npm run build:win
```

Output lands in `dist/`.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                 Electron Main                │
│  ┌─────────────────┐  ┌──────────────────┐  │
│  │ DiscoveryService│  │  TransferService  │  │
│  │  (mDNS/Bonjour) │  │   (TCP server)   │  │
│  └────────┬────────┘  └────────┬─────────┘  │
│           │ peers-updated      │ events      │
│           └──────────┬─────────┘            │
│                      │ IPC                  │
└──────────────────────┼──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│              React Renderer (UI)             │
│  DropNotch → DevicePicker → TransferStatus  │
│  IncomingPrompt   PinSharePrompt             │
└─────────────────────────────────────────────┘
```

**Discovery** — mDNS/Bonjour via `bonjour-service`. Devices advertise themselves on the LAN; no configuration needed.

**Transfer protocol** — raw TCP with binary framing:
```
[4 bytes: header length] [N bytes: JSON header] [file bytes]
```

**PIN flow:**
1. Receiver enables PIN in Settings
2. Sender connects → receiver gets "Share PIN?" popup
3. Receiver taps Share PIN → PIN sent directly over the existing TCP connection
4. Normal Accept/Decline prompt appears on receiver

---

## License

MIT
