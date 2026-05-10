/**
 * Configurable numeric session codes (room names). Must match web `NEXT_PUBLIC_SESSION_CODE_LENGTH`.
 */

import { randomInt } from "node:crypto";

export type SessionCodeLength = 6 | 8;

function parseSessionCodeLength(): SessionCodeLength {
  const raw = process.env.SESSION_CODE_LENGTH?.trim() ?? "6";
  const n = Number(raw);
  if (n === 6 || n === 8) {
    return n;
  }
  throw new Error(
    `[vaultprint-signaling] SESSION_CODE_LENGTH must be 6 or 8, got: ${JSON.stringify(raw)}`,
  );
}

/** Resolved once at module load (after dotenv in entry). */
export const SESSION_CODE_LENGTH: SessionCodeLength = parseSessionCodeLength();

export function isValidSessionCode(code: string): boolean {
  if (typeof code !== "string" || code.length !== SESSION_CODE_LENGTH) {
    return false;
  }
  return /^\d+$/.test(code);
}

/**
 * Uniform random code in [0, 10^L), zero-padded to L digits (leading zeros allowed).
 */
export function generateSessionCode(): string {
  const max = 10 ** SESSION_CODE_LENGTH;
  const n = randomInt(0, max);
  return String(n).padStart(SESSION_CODE_LENGTH, "0");
}

export function sessionCodeLengthMessage(): string {
  return `${SESSION_CODE_LENGTH}-digit`;
}
