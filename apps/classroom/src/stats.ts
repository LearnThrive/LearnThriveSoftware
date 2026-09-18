export interface CallStats {
  rtt: number | null;
  jitter: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
  packetsSent: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  inboundBitrateKbps: number | null;
  outboundBitrateKbps: number | null;
  frameRate: number | null;
  resolution: string | null;
  framesEncoded: number | null;
  framesDecoded: number | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  // The selected pair's transport protocol only (udp/tcp) — deliberately not the local/remote
  // IP:port themselves, to keep the existing "no raw local IP addresses beyond candidate type"
  // privacy stance intact even as this exposes a bit more of the selected pair than before.
  selectedCandidateProtocol: string | null;
}

export interface StatsSample { timestamp: number; bytesSent: number | null; bytesReceived: number | null }

const EMPTY_STATS: CallStats = {
  rtt: null, jitter: null, packetsLost: null, packetsReceived: null, packetsSent: null,
  bytesSent: null, bytesReceived: null,
  inboundBitrateKbps: null, outboundBitrateKbps: null, frameRate: null, resolution: null,
  framesEncoded: null, framesDecoded: null, localCandidateType: null, remoteCandidateType: null,
  selectedCandidateProtocol: null,
};

/** Browsers disagree on which optional stats fields exist, so every read is feature-detected. */
export function parseStats(report: RTCStatsReport, previous: StatsSample | null): { stats: CallStats; sample: StatsSample } {
  const stats: CallStats = { ...EMPTY_STATS };
  let bytesSent: number | null = null;
  let bytesReceived: number | null = null;
  let timestamp = 0;
  let selectedPairId: string | null = null;

  report.forEach((entry: Record<string, unknown>) => {
    if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') selectedPairId = entry.selectedCandidatePairId;
  });

  report.forEach((entry: Record<string, unknown>) => {
    if (typeof entry.timestamp === 'number') timestamp = Math.max(timestamp, entry.timestamp);

    if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && (entry.id === selectedPairId || entry.selected === true || entry.nominated === true)) {
      if (typeof entry.currentRoundTripTime === 'number') stats.rtt = Math.round(entry.currentRoundTripTime * 1000);
      const local = typeof entry.localCandidateId === 'string' ? (report.get(entry.localCandidateId) as Record<string, unknown> | undefined) : undefined;
      const remote = typeof entry.remoteCandidateId === 'string' ? (report.get(entry.remoteCandidateId) as Record<string, unknown> | undefined) : undefined;
      if (typeof local?.candidateType === 'string') stats.localCandidateType = local.candidateType;
      if (typeof remote?.candidateType === 'string') stats.remoteCandidateType = remote.candidateType;
      if (typeof local?.protocol === 'string') stats.selectedCandidateProtocol = local.protocol;
    }

    if (entry.type === 'inbound-rtp' && !entry.isRemote) {
      if (typeof entry.jitter === 'number') stats.jitter = Math.round(entry.jitter * 1000);
      if (typeof entry.packetsLost === 'number') stats.packetsLost = (stats.packetsLost ?? 0) + entry.packetsLost;
      if (typeof entry.packetsReceived === 'number') stats.packetsReceived = (stats.packetsReceived ?? 0) + entry.packetsReceived;
      if (typeof entry.bytesReceived === 'number') bytesReceived = (bytesReceived ?? 0) + entry.bytesReceived;
      if (entry.kind === 'video') {
        if (typeof entry.framesPerSecond === 'number') stats.frameRate = Math.round(entry.framesPerSecond);
        if (typeof entry.frameWidth === 'number' && typeof entry.frameHeight === 'number') stats.resolution = `${entry.frameWidth}×${entry.frameHeight}`;
        if (typeof entry.framesDecoded === 'number') stats.framesDecoded = (stats.framesDecoded ?? 0) + entry.framesDecoded;
      }
    }

    if (entry.type === 'outbound-rtp' && !entry.isRemote) {
      if (typeof entry.bytesSent === 'number') bytesSent = (bytesSent ?? 0) + entry.bytesSent;
      if (typeof entry.packetsSent === 'number') stats.packetsSent = (stats.packetsSent ?? 0) + entry.packetsSent;
      if (entry.kind === 'video' && typeof entry.framesEncoded === 'number') {
        stats.framesEncoded = (stats.framesEncoded ?? 0) + entry.framesEncoded;
      }
    }
  });

  if (previous && timestamp > previous.timestamp) {
    const elapsedSeconds = (timestamp - previous.timestamp) / 1000;
    if (elapsedSeconds > 0) {
      if (bytesReceived != null && previous.bytesReceived != null) {
        stats.inboundBitrateKbps = Math.max(0, Math.round(((bytesReceived - previous.bytesReceived) * 8) / elapsedSeconds / 1000));
      }
      if (bytesSent != null && previous.bytesSent != null) {
        stats.outboundBitrateKbps = Math.max(0, Math.round(((bytesSent - previous.bytesSent) * 8) / elapsedSeconds / 1000));
      }
    }
  }

  stats.bytesSent = bytesSent;
  stats.bytesReceived = bytesReceived;
  return { stats, sample: { timestamp, bytesSent, bytesReceived } };
}

export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

/** Conservative, deliberately coarse thresholds — not a scientific measurement. */
export function classifyQuality(stats: CallStats): ConnectionQuality {
  const lossRatio = stats.packetsLost != null && stats.packetsReceived != null && stats.packetsLost + stats.packetsReceived > 0
    ? stats.packetsLost / (stats.packetsLost + stats.packetsReceived) : null;
  if (stats.rtt == null && lossRatio == null) return 'unknown';
  const rtt = stats.rtt ?? 0;
  const loss = lossRatio ?? 0;
  if (rtt > 400 || loss > 0.08) return 'poor';
  if (rtt > 200 || loss > 0.03) return 'fair';
  if (rtt > 100 || loss > 0.01) return 'good';
  return 'excellent';
}

export function qualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case 'excellent': return 'Excellent';
    case 'good': return 'Good';
    case 'fair': return 'Fair';
    case 'poor': return 'Poor';
    default: return 'Checking…';
  }
}
