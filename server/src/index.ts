/**
 * VaultPrint Signaling Server
 * ---------------------------
 * Express + Socket.io. Responsibilities:
 * - Issue a random numeric session code and bind the sender to a Socket.io room named by it.
 * - Let the receiver join the same room after entering the code; then emit `peer-ready`.
 * - Relay WebRTC signaling (offer / answer / ICE) between the two peers — SDP payloads are
 *   opaque to this server (still do not log SDP in production logs).
 *
 * This process must never see PDF/image bytes; data channels are P2P only.
 */

import "dotenv/config";

import http from "node:http";

import cors from "cors";
import express, { type Request, type Response } from "express";
import { type Socket, Server as SocketIOServer } from "socket.io";

import {
  allocatePin,
  createRoom,
  deleteRoom,
  findPinBySocketId,
  getRoom,
  roleInRoom,
  setReceiver,
} from "./rooms.js";
import {
  allowReceiverJoin,
  allowSenderCreateRoom,
  getClientIp,
} from "./rateLimit.js";
import {
  isValidSessionCode,
  sessionCodeLengthMessage,
} from "./sessionCode.js";

if (process.env.NODE_ENV === "production") {
  const corsOrigins = process.env.CORS_ORIGINS?.trim();
  if (!corsOrigins || corsOrigins === "*") {
    // eslint-disable-next-line no-console -- fatal misconfiguration
    console.error(
      "[vaultprint-signaling] Refusing to start: NODE_ENV=production requires CORS_ORIGINS to be a comma-separated list of allowed origins (not empty, not *).",
    );
    process.exit(1);
  }
}

/** Allowed CORS origins for REST + Socket.io handshake. */
function parseCorsOrigins(raw: string | undefined): string[] | boolean {
  if (!raw || raw.trim() === "*") {
    return true;
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const PORT = Number(process.env.PORT) || 4000;
const CORS_ORIGIN = parseCorsOrigins(process.env.CORS_ORIGINS);

const app = express();

// Minimal middleware: health checks only on this service.
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "HEAD", "OPTIONS"],
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    service: "vaultprint-signaling",
    ok: true,
  });
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).type("text/plain").send("VaultPrint signaling — POST not used; use Socket.io.\n");
});

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
  socket.on("sender:create-room", () => {
    const ip = getClientIp(socket);
    if (!allowSenderCreateRoom(ip)) {
      socket.emit("error", {
        code: "RATE_LIMITED",
        message: "Too many sessions started from this network. Try again later.",
      });
      return;
    }

    const existingPin = findPinBySocketId(socket.id);
    if (existingPin) {
      const room = getRoom(existingPin);
      if (room?.senderSocketId === socket.id) {
        socket.emit("error", {
          code: "ALREADY_HOSTING",
          message: "This connection already created a room. Reconnect to start over.",
        });
        return;
      }
    }

    const pin = allocatePin();
    createRoom(socket.id, pin);
    void socket.join(pin);

    socket.emit("room-created", { pin });
  });

  socket.on("receiver:join", (payload: { pin?: string }) => {
    const ip = getClientIp(socket);
    if (!allowReceiverJoin(ip)) {
      socket.emit("error", {
        code: "RATE_LIMITED",
        message: "Too many join attempts from this network. Wait a minute and try again.",
      });
      return;
    }

    const pin = typeof payload?.pin === "string" ? payload.pin.trim() : "";
    if (!isValidSessionCode(pin)) {
      socket.emit("error", {
        code: "INVALID_PIN",
        message: `Session code must be exactly ${sessionCodeLengthMessage()} numeric characters.`,
      });
      return;
    }

    const room = getRoom(pin);
    if (!room) {
      socket.emit("error", {
        code: "ROOM_NOT_FOUND",
        message: "No active session for this code.",
      });
      return;
    }

    if (room.receiverSocketId && room.receiverSocketId !== socket.id) {
      socket.emit("error", {
        code: "ROOM_FULL",
        message: "Another device already joined as receiver.",
      });
      return;
    }

    const ok = setReceiver(pin, socket.id);
    if (!ok) {
      socket.emit("error", {
        code: "ROOM_NOT_FOUND",
        message: "Session ended or invalid code.",
      });
      return;
    }

    void socket.join(pin);

    io.to(pin).emit("peer-ready", { pin });
  });

  socket.on(
    "signal:offer",
    (payload: { pin?: string; sdp?: unknown; type?: unknown }) => {
      relaySignal(socket, "signal:offer", payload);
    },
  );

  socket.on(
    "signal:answer",
    (payload: { pin?: string; sdp?: unknown; type?: unknown }) => {
      relaySignal(socket, "signal:answer", payload);
    },
  );

  socket.on(
    "signal:ice-candidate",
    (payload: { pin?: string; candidate?: unknown }) => {
      relaySignal(socket, "signal:ice-candidate", payload);
    },
  );

  socket.on("disconnect", (_reason) => {
    const pin = findPinBySocketId(socket.id);
    if (!pin) {
      return;
    }

    const room = getRoom(pin);
    if (!room) {
      return;
    }

    if (room.senderSocketId === socket.id) {
      deleteRoom(pin);
      socket.to(pin).emit("room-closed", {
        reason: "sender-disconnected",
        pin,
      });
      return;
    }

    if (room.receiverSocketId === socket.id) {
      const senderId = room.senderSocketId;
      deleteRoom(pin);
      io.to(senderId).emit("room-closed", {
        reason: "receiver-ended-session",
        pin,
      });
    }
  });
});

function relaySignal(
  socket: Socket,
  eventName: "signal:offer" | "signal:answer" | "signal:ice-candidate",
  payload: { pin?: string; [key: string]: unknown },
): void {
  const pin = typeof payload.pin === "string" ? payload.pin.trim() : "";
  if (!isValidSessionCode(pin)) {
    socket.emit("error", {
      code: "INVALID_PIN",
      message: `Signaling payload must include a valid ${sessionCodeLengthMessage()} session code.`,
    });
    return;
  }

  const role = roleInRoom(pin, socket.id);
  if (!role) {
    socket.emit("error", {
      code: "NOT_IN_ROOM",
      message: "Join a room before signaling.",
    });
    return;
  }

  const room = getRoom(pin);
  if (!room) {
    socket.emit("error", {
      code: "ROOM_NOT_FOUND",
      message: "Room no longer exists.",
    });
    return;
  }

  const targetId =
    role === "sender" ? room.receiverSocketId : room.senderSocketId;

  if (!targetId) {
    socket.emit("error", {
      code: "PEER_NOT_READY",
      message: "The other peer is not connected yet.",
    });
    return;
  }

  io.to(targetId).emit(eventName, {
    ...payload,
    from: role,
  });
}

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console -- bootstrap log for operators
  console.log(`[vaultprint-signaling] listening on port ${PORT}`);
});
