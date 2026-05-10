/**
 * WebRTC ICE config for browser peers.
 * - Always include STUN.
 * - Add TURN via NEXT_PUBLIC_TURN_* for restrictive NAT/firewall environments.
 */

function splitCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildIceServers(): RTCIceServer[] {
  const stunUrls = splitCsv(process.env.NEXT_PUBLIC_STUN_URLS);
  const turnUrls = splitCsv(process.env.NEXT_PUBLIC_TURN_URLS);
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim() ?? "";
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim() ?? "";

  const servers: RTCIceServer[] = [];

  if (stunUrls.length > 0) {
    servers.push({ urls: stunUrls });
  } else {
    // Safe default for dev and basic public networks.
    servers.push({ urls: ["stun:stun.l.google.com:19302"] });
  }

  if (turnUrls.length > 0) {
    if (!turnUsername || !turnCredential) {
      console.warn(
        "[VaultPrint] NEXT_PUBLIC_TURN_URLS set without TURN username/credential; TURN will be skipped.",
      );
    } else {
      servers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      });
    }
  }

  return servers;
}

export const DEFAULT_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: buildIceServers(),
  // Optional: set NEXT_PUBLIC_ICE_TRANSPORT_POLICY=relay to force TURN-only behavior.
  iceTransportPolicy:
    process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
};
