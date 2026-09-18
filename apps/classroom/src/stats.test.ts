import { describe, expect, it } from 'vitest';
import { classifyQuality, parseStats, type CallStats } from './stats';

function report(entries: Array<[string, Record<string, unknown>]>): RTCStatsReport {
  return new Map(entries) as unknown as RTCStatsReport;
}

const BASE_STATS: CallStats = {
  rtt: null, jitter: null, packetsLost: null, packetsReceived: null, packetsSent: null,
  bytesSent: null, bytesReceived: null,
  inboundBitrateKbps: null, outboundBitrateKbps: null, frameRate: null, resolution: null,
  framesEncoded: null, framesDecoded: null, localCandidateType: null, remoteCandidateType: null,
  selectedCandidateProtocol: null,
};

function makeReport(timestamp: number, bytesReceived: number, bytesSent: number) {
  return report([
    ['pair1', {
      type: 'candidate-pair', timestamp, state: 'succeeded', selected: true,
      currentRoundTripTime: 0.05, localCandidateId: 'local1', remoteCandidateId: 'remote1',
    }],
    ['local1', { type: 'local-candidate', candidateType: 'srflx' }],
    ['remote1', { type: 'remote-candidate', candidateType: 'relay' }],
    ['inbound1', {
      type: 'inbound-rtp', kind: 'video', isRemote: false, timestamp,
      jitter: 0.01, packetsLost: 2, packetsReceived: 998, bytesReceived,
      framesPerSecond: 30, frameWidth: 1280, frameHeight: 720, framesDecoded: 900,
    }],
    ['outbound1', { type: 'outbound-rtp', kind: 'video', isRemote: false, timestamp, bytesSent, packetsSent: 500, framesEncoded: 895 }],
  ]);
}

describe('parseStats', () => {
  it('reads RTT, candidate types, jitter, and frame info from a stats report', () => {
    const { stats } = parseStats(makeReport(1000, 100_000, 50_000), null);
    expect(stats.rtt).toBe(50);
    expect(stats.localCandidateType).toBe('srflx');
    expect(stats.remoteCandidateType).toBe('relay');
    expect(stats.jitter).toBe(10);
    expect(stats.packetsLost).toBe(2);
    expect(stats.packetsReceived).toBe(998);
    expect(stats.frameRate).toBe(30);
    expect(stats.resolution).toBe('1280×720');
    expect(stats.framesDecoded).toBe(900);
    expect(stats.framesEncoded).toBe(895);
    expect(stats.packetsSent).toBe(500);
    expect(stats.inboundBitrateKbps).toBeNull();
  });

  it('computes bitrate from the delta against a previous sample', () => {
    const first = parseStats(makeReport(1000, 100_000, 50_000), null);
    const second = parseStats(makeReport(3000, 350_000, 150_000), first.sample);
    expect(second.stats.inboundBitrateKbps).toBe(1000);
    expect(second.stats.outboundBitrateKbps).toBe(400);
  });

  it('never produces a negative bitrate if a counter resets', () => {
    const first = parseStats(makeReport(1000, 100_000, 50_000), null);
    const second = parseStats(makeReport(2000, 10_000, 5_000), first.sample);
    expect(second.stats.inboundBitrateKbps).toBe(0);
    expect(second.stats.outboundBitrateKbps).toBe(0);
  });

  it('degrades gracefully when a report is missing fields, as browsers vary', () => {
    const sparse = report([['inbound1', { type: 'inbound-rtp', kind: 'audio', isRemote: false }]]);
    expect(() => parseStats(sparse, null)).not.toThrow();
    const { stats } = parseStats(sparse, null);
    expect(stats).toEqual(BASE_STATS);
  });

  it('ignores an empty report rather than throwing', () => {
    expect(() => parseStats(report([]), null)).not.toThrow();
  });
});

describe('classifyQuality', () => {
  it('is unknown with no RTT or loss data at all', () => {
    expect(classifyQuality(BASE_STATS)).toBe('unknown');
  });
  it('is excellent for a low-latency, lossless connection', () => {
    expect(classifyQuality({ ...BASE_STATS, rtt: 40, packetsLost: 0, packetsReceived: 1000 })).toBe('excellent');
  });
  it('degrades through good, fair, and poor as RTT rises', () => {
    expect(classifyQuality({ ...BASE_STATS, rtt: 150 })).toBe('good');
    expect(classifyQuality({ ...BASE_STATS, rtt: 250 })).toBe('fair');
    expect(classifyQuality({ ...BASE_STATS, rtt: 500 })).toBe('poor');
  });
  it('is poor on heavy packet loss even with a good RTT', () => {
    expect(classifyQuality({ ...BASE_STATS, rtt: 30, packetsLost: 100, packetsReceived: 900 })).toBe('poor');
  });
});
