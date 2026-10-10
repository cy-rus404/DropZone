# DropZone 🌀

> *Drop it. Send it. Done.*

A cross-platform local network file transfer app — like AirDrop, but for everyone.

---

## Features

- **Floating notch UI** — Always-visible pill at the top of your screen
- **Drag & drop anything** — Files, images, videos, folders, any size
- **Automatic device discovery** — No IP addresses, no setup. Devices on your local network appear instantly
- **AirDrop-style prompts** — Receiver gets an Accept / Decline popup
- **You choose where to save** — File picker appears on accept
- **Two-way transfers** — Both devices can send and receive
- **Smooth animations** — Glassmorphism UI with Framer Motion throughout
- **Cross-platform** — Windows, macOS, Linux

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm v9 or later

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run dev
```

This starts both the React dev server and Electron simultaneously.

### Build for production

```bash
npm run build
```

Outputs a distributable for your current platform in the `dist/` folder.

---

## How It Works

### Architecture

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
│              IncomingPrompt                  │
└─────────────────────────────────────────────┘
```

### Device Discovery
Uses **mDNS/Bonjour** (`bonjour-service`) to advertise each running DropZone instance on the local network. No configuration needed — devices appear automatically as long as they're on the same WiFi/LAN.

### File Transfer Protocol
Raw **TCP** with a custom binary framing protocol:
```
[4 bytes: header length] [N bytes: JSON header] [file bytes]
```
The JSON header carries metadata (filename, size, sender info). File bytes stream directly after acceptance.

### Transfer Flow
1. Sender drags file onto notch → DevicePicker appears
2. Sender clicks a peer → TCP connection opened, transfer-request sent
3. Receiver sees IncomingPrompt (Accept / Decline)
4. If accepted → Save dialog opens → file streams to disk with progress
5. Both sides see animated progress bars → completion toast notification

---

## Project Structure

```
dropzone/
├── main.js               # Electron main process
├── preload.js            # Secure IPC bridge
├── package.json
├── public/
│   └── index.html
└── src/
    ├── index.js          # React entry point
    ├── App.js            # Root state manager
    ├── components/
    │   ├── DropNotch.js      # Floating drag-drop pill
    │   ├── DevicePicker.js   # Peer selection panel
    │   ├── IncomingPrompt.js # Accept/Decline card
    │   └── TransferStatus.js # Progress bars
    ├── services/
    │   ├── discoveryService.js  # mDNS peer discovery
    │   └── transferService.js   # TCP file transfer
    └── styles/
        ├── global.css
        ├── DropNotch.css
        ├── DevicePicker.css
        ├── IncomingPrompt.css
        └── TransferStatus.css
```

---

## Notes

- Both devices **must have DropZone running** for discovery and transfer to work
- Devices must be on the **same local network** (same WiFi router or LAN switch)
- Port **54321 TCP** must not be blocked by a firewall between devices
- File size is unlimited — transfers stream directly without loading into memory

---

## License

MIT
