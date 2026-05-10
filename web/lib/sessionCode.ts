/**
 * Client session code format — must match signaling server `SESSION_CODE_LENGTH`.
 * Set `NEXT_PUBLIC_SESSION_CODE_LENGTH` to 6 (default) or 8 at build time.
 */

export const SESSION_CODE_LENGTH: 6 | 8 = ((): 6 | 8 => {
  const raw = process.env.NEXT_PUBLIC_SESSION_CODE_LENGTH?.trim() ?? "6";
  const n = Number(raw);
  if (n === 6 || n === 8) {
    return n;
  }
  return 6;
})();

export function isValidSessionCode(value: string): boolean {
  if (value.length !== SESSION_CODE_LENGTH) {
    return false;
  }
  return new RegExp(`^\\d{${SESSION_CODE_LENGTH}}$`).test(value);
}

export function sessionCodeLengthLabel(): string {
  return `${SESSION_CODE_LENGTH}-digit`;
}
