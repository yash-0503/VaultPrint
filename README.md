# VaultPrint

**Zero-storage, peer-to-peer confidential printing for public shops.**

A customer sends a PDF or image from their phone; the print shop opens a link on their PC, enters a short session code, previews the document in the browser, and prints. **Your file never touches our servers.**

---

## Use case

| Who | Device | Route |
|-----|--------|-------|
| Customer (sender) | Phone | `/` |
| Print shop (receiver) | Desktop | `/receive` |

Typical flow: Xerox / photocopy shop, library printer, campus print kiosk — anywhere you need to print a sensitive document without emailing it, using a USB stick, or uploading to a third-party cloud.

---

## How it works (in one picture)

```
 Phone (sender)                    Signaling server              Shop PC (receiver)
      │                           (no file bytes)                      │
      │  ① create room → PIN        │                                  │
      │ ─────────────────────────►  │                                  │
      │                             │  ② join with PIN                 │
      │                             │ ◄──────────────────────────────  │
      │  ③ WebRTC offer/answer/ICE relayed only                        │
      │ ◄──────────────────────────────────────────────────────────►  │
      │  ④ encrypted P2P data channel — PDF/image chunks               │
      │ ═══════════════════════════════════════════════════════════►  │
      │                             │                          preview & print
```

**Signaling** helps two browsers find each other and negotiate encryption. **Transfer** happens directly between devices over WebRTC. The server only sees socket IDs, session codes, and SDP/ICE metadata — never document content.

---

## Core principles

1. **Zero storage** — No database, no S3, no disk writes for documents. Rooms live in memory and die when a peer disconnects.
2. **Peer-to-peer transfer** — File bytes travel over an encrypted `RTCDataChannel`, not through the signaling server.
3. **Ephemeral sessions** — A numeric code binds one sender to one receiver for a short window (~60s, extendable). Closing the shop tab destroys the room; the code cannot be reused.
4. **Client-side only preview** — PDF/DOCX/image rendering happens in the browser from an in-memory `ArrayBuffer`. Nothing is saved to disk by the app.
5. **Defense in depth** — Rate limits on signaling, strict production CORS, configurable STUN/TURN for real-world NAT.

---

## Why you can trust it

| Claim | Why it's true |
|-------|----------------|
| Server never sees your PDF | Data channels are browser-to-browser. Signaling relays only JSON SDP/ICE messages. |
| No persistent storage | `rooms.ts` is a `Map` in RAM. No upload API exists. |
| Session ends cleanly | Receiver disconnect deletes the room. After print, the receiver wipes preview buffers and closes the peer connection. |
| You can verify | Open DevTools → Network: no document POST. Inspect `server/src/index.ts`: no body parser for files. |

**Caveats (honest limits):** The shop PC holds the document in RAM while the tab is open. A compromised browser or malicious shop operator could still capture the screen. VaultPrint removes the *cloud middleman*, not the need to trust the person at the counter. Use TURN in production so connections work behind strict NAT; TURN relays encrypted WebRTC traffic but still does not decrypt document bytes for VaultPrint's app layer.

---

## Folder structure

```
XeroxConfidentiality/
├── README.md                 # This file
├── study.readme              # Deep technical walkthrough (concepts, functions, flows)
├── .github/workflows/ci.yml  # Lint, build, typecheck on push
│
├── server/                   # Signaling service (Node + Express + Socket.io)
│   ├── src/
│   │   ├── index.ts          # Socket events, WebRTC signal relay, health check
│   │   ├── rooms.ts          # In-memory PIN rooms (sender + receiver socket IDs)
│   │   ├── sessionCode.ts    # 6/8-digit code generation & validation
│   │   └── rateLimit.ts      # Per-IP limits on join / create-room
│   ├── .env.example
│   └── package.json
│
└── web/                      # Next.js 14 app (sender + receiver UI)
    ├── app/
    │   ├── page.tsx          # Sender (mobile)
    │   ├── receive/page.tsx  # Receiver (desktop)
    │   ├── layout.tsx
    │   └── globals.css       # Print CSS (only document region on paper)
    ├── components/
    │   ├── SenderClient.tsx      # WebRTC sender, file queue, timer
    │   ├── ReceiverClient.tsx    # WebRTC receiver, batch ingest, print
    │   ├── DocumentPreview.tsx   # Per-file preview (all PDF pages)
    │   ├── FileDropzone.tsx      # Multi-file picker / drop
    │   ├── ImageCropToA4Modal.tsx
    │   └── OtpInput.tsx          # Session code entry
    ├── lib/
    │   ├── protocol.ts       # Data-channel message types & chunk size
    │   ├── ice.ts            # STUN/TURN RTCConfiguration
    │   ├── iceStatus.ts      # Detect direct vs TURN path
    │   ├── renderDocument.ts # PDF / image / DOCX preview rendering
    │   ├── mime.ts           # Magic-byte & extension MIME sniffing
    │   ├── config.ts         # Signaling URL, app origin
    │   └── sessionCode.ts    # Client code length (must match server)
    ├── public/pdf.worker.min.mjs
    └── .env.local.example
```

---

## Quick start (local)

**Terminal 1 — signaling**

```bash
cd server
cp .env.example .env
npm install
npm run dev
# → http://localhost:4000
```

**Terminal 2 — web**

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
# → http://localhost:3000
```

1. Open `http://localhost:3000` on your phone (or a second browser tab).
2. Open `http://localhost:3000/receive` on your desktop.
3. Drop a PDF (or multiple files), share the code, connect, preview, print.

---

## Environment variables

| Service | Variable | Purpose |
|---------|----------|---------|
| Server | `PORT` | HTTP + Socket.io port (default `4000`) |
| Server | `SESSION_CODE_LENGTH` | `6` or `8` |
| Server | `CORS_ORIGINS` | Allowed web origins (required in production) |
| Web | `NEXT_PUBLIC_SIGNALING_URL` | Signaling server URL |
| Web | `NEXT_PUBLIC_SESSION_CODE_LENGTH` | Must match server |
| Web | `NEXT_PUBLIC_TURN_*` | TURN credentials for production NAT traversal |

See `server/.env.example` and `web/.env.local.example` for full lists.

---

## Deployment (two services)

| Service | Suggested host | Root directory |
|---------|----------------|----------------|
| Signaling | Render, Fly.io, Railway | `server` |
| Web | Vercel | `web` |

Set `CORS_ORIGINS` on the server to your Vercel URL. Set `NEXT_PUBLIC_SIGNALING_URL` on Vercel to your signaling HTTPS URL.

---

## Supported formats

- **PDF** — multi-page preview and print
- **Images** (PNG, JPEG, WebP, GIF) — crop/rotate to A4 PDF on sender, then send
- **DOCX** — in-browser preview via docx-preview
- **Batch** — multiple files per session, sent sequentially over one data channel

---

## License

Private / confidential — Xerox confidentiality context. Adjust as needed for your org.
