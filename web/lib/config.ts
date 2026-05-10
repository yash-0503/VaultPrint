/**
 * Central place for public runtime configuration (Next.js `NEXT_PUBLIC_*`).
 */

export function getSignalingUrl(): string {
  const url =
    typeof process.env.NEXT_PUBLIC_SIGNALING_URL === "string"
      ? process.env.NEXT_PUBLIC_SIGNALING_URL.trim()
      : "";
  if (!url) {
    console.warn(
      "[VaultPrint] NEXT_PUBLIC_SIGNALING_URL is not set; defaulting to http://localhost:4000",
    );
    return "http://localhost:4000";
  }
  return url.replace(/\/$/, "");
}

/** Origin used in share links when you want an explicit production domain; else browser origin. */
export function getPublicAppOrigin(): string | undefined {
  const o = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  return o && o.length > 0 ? o.replace(/\/$/, "") : undefined;
}
