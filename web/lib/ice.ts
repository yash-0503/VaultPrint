/**
 * Default STUN servers for NAT traversal — sufficient for many LAN / publicInternet pairs.
 * For strict enterprise NAT, add TURN here (credentials via env/secure channel; not hardcoded).
 */
export const DEFAULT_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
