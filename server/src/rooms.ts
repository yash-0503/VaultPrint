/**
 * VaultPrint — in-memory room registry (signaling only).
 *
 * A room is keyed by a numeric session code string. At most one sender and one receiver
 * per code. Document bytes never touch this layer.
 */

import { generateSessionCode } from "./sessionCode.js";

/** Maximum attempts to allocate a unique code before failing. */
const PIN_ALLOCATION_MAX_ATTEMPTS = 128;

export type PeerRole = "sender" | "receiver";

export interface RoomRecord {
  /** Socket.io connection id of the mobile sender (creates the room). */
  senderSocketId: string;
  /** Socket.io connection id of the desktop receiver; set when they join with the code. */
  receiverSocketId?: string;
}

/** Ephemeral registry: session code → room metadata. */
const rooms = new Map<string, RoomRecord>();

/**
 * Allocates a unique session code and returns it. Rare collisions are retried.
 */
export function allocatePin(): string {
  for (let i = 0; i < PIN_ALLOCATION_MAX_ATTEMPTS; i++) {
    const pin = generateSessionCode();
    if (!rooms.has(pin)) {
      return pin;
    }
  }
  throw new Error("vaultprint: could not allocate a unique session code");
}

export function createRoom(senderSocketId: string, pin: string): void {
  rooms.set(pin, { senderSocketId });
}

export function getRoom(pin: string): RoomRecord | undefined {
  return rooms.get(pin);
}

export function setReceiver(pin: string, receiverSocketId: string): boolean {
  const room = rooms.get(pin);
  if (!room) {
    return false;
  }
  room.receiverSocketId = receiverSocketId;
  return true;
}

export function removeReceiverIfMatch(pin: string, receiverSocketId: string): void {
  const room = rooms.get(pin);
  if (room && room.receiverSocketId === receiverSocketId) {
    delete room.receiverSocketId;
  }
}

export function deleteRoom(pin: string): void {
  rooms.delete(pin);
}

/**
 * Finds the code (if any) where this socket is registered as sender or receiver.
 */
export function findPinBySocketId(socketId: string): string | undefined {
  for (const [pin, room] of rooms) {
    if (room.senderSocketId === socketId || room.receiverSocketId === socketId) {
      return pin;
    }
  }
  return undefined;
}

export function roleInRoom(pin: string, socketId: string): PeerRole | undefined {
  const room = rooms.get(pin);
  if (!room) {
    return undefined;
  }
  if (room.senderSocketId === socketId) {
    return "sender";
  }
  if (room.receiverSocketId === socketId) {
    return "receiver";
  }
  return undefined;
}
