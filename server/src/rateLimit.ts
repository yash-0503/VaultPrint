/**
 * Simple in-memory sliding-window rate limits per client IP (signaling abuse).
 * Not suitable for multi-instance without a shared store.
 */

import type { Socket } from "socket.io";

/** Timestamps of recent events (ms). */
const joinTimestamps = new Map<string, number[]>();
const createTimestamps = new Map<string, number[]>();

const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_PER_WINDOW = 20;
const CREATE_WINDOW_MS = 3_600_000;
const CREATE_MAX_PER_WINDOW = 30;

function pruneAndCount(timestamps: number[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  const fresh = timestamps.filter((t) => t > cutoff);
  timestamps.length = 0;
  timestamps.push(...fresh);
  return fresh.length;
}

export function getClientIp(socket: Socket): string {
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return socket.handshake.address ?? "unknown";
}

export function allowReceiverJoin(ip: string): boolean {
  const now = Date.now();
  let arr = joinTimestamps.get(ip);
  if (!arr) {
    arr = [];
    joinTimestamps.set(ip, arr);
  }
  const count = pruneAndCount(arr, now, JOIN_WINDOW_MS);
  if (count >= JOIN_MAX_PER_WINDOW) {
    return false;
  }
  arr.push(now);
  return true;
}

export function allowSenderCreateRoom(ip: string): boolean {
  const now = Date.now();
  let arr = createTimestamps.get(ip);
  if (!arr) {
    arr = [];
    createTimestamps.set(ip, arr);
  }
  const count = pruneAndCount(arr, now, CREATE_WINDOW_MS);
  if (count >= CREATE_MAX_PER_WINDOW) {
    return false;
  }
  arr.push(now);
  return true;
}
