import { hasTurnConfigured } from "@/lib/ice";

export type IcePathLabel =
  | "direct"
  | "stun"
  | "turn"
  | "unknown"
  | "not-connected";

const LABELS: Record<IcePathLabel, string> = {
  direct: "Direct peer link",
  stun: "STUN reflexive",
  turn: "TURN relay",
  unknown: "Path unknown",
  "not-connected": "Not connected",
};

export function icePathDisplay(label: IcePathLabel): string {
  return LABELS[label];
}

/** Inspect the active ICE candidate pair after the data channel is up. */
export async function detectIcePath(
  pc: RTCPeerConnection | null,
): Promise<IcePathLabel> {
  if (!pc || pc.connectionState !== "connected") {
    return "not-connected";
  }

  try {
    const stats = await pc.getStats();
    let nominatedPair: RTCStats | undefined;

    stats.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        "nominated" in report &&
        report.nominated === true &&
        "state" in report &&
        report.state === "succeeded"
      ) {
        nominatedPair = report;
      }
    });

    if (!nominatedPair || !("localCandidateId" in nominatedPair)) {
      return "unknown";
    }

    const localId = nominatedPair.localCandidateId as string;
    let localType: string | undefined;

    stats.forEach((report) => {
      if (report.type === "local-candidate" && report.id === localId && "candidateType" in report) {
        localType = report.candidateType as string;
      }
    });

    if (localType === "relay") {
      return "turn";
    }
    if (localType === "srflx" || localType === "prflx") {
      return "stun";
    }
    if (localType === "host") {
      return "direct";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function turnConfigHint(): string | null {
  if (hasTurnConfigured()) {
    return null;
  }
  return "TURN not configured — strict networks may fail to connect.";
}
