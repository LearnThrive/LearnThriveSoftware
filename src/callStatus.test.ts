import { describe, expect, it } from 'vitest';
import { aggregateConnectionStatus, classifyConnectionStatus } from './callStatus';

describe('classifyConnectionStatus', () => {
  it('reports connected only once the peer connection itself is connected', () => {
    expect(classifyConnectionStatus('connected', 'connected')).toBe('Connected');
  });
  it('treats a failed connection or ICE state as a failure even if the other is healthier', () => {
    expect(classifyConnectionStatus('failed', 'connected')).toBe('Connection failed');
    expect(classifyConnectionStatus('connecting', 'failed')).toBe('Connection failed');
  });
  it('reports reconnecting for a disconnected (not yet failed) state', () => {
    expect(classifyConnectionStatus('disconnected', 'disconnected')).toBe('Reconnecting…');
    expect(classifyConnectionStatus('new', 'disconnected')).toBe('Reconnecting…');
  });
  it('falls back to connecting for any other in-progress state', () => {
    expect(classifyConnectionStatus('new', 'new')).toBe('Connecting…');
    expect(classifyConnectionStatus('connecting', 'checking')).toBe('Connecting…');
  });
});

describe('aggregateConnectionStatus', () => {
  it('reports Waiting when there are no other peers yet', () => {
    expect(aggregateConnectionStatus([])).toBe('Waiting…');
  });
  it('reports Connected only once every peer is connected', () => {
    expect(aggregateConnectionStatus([
      { connection: 'connected', ice: 'connected' },
      { connection: 'connected', ice: 'connected' },
    ])).toBe('Connected');
  });
  it('surfaces a failure even if the other peers are healthy', () => {
    expect(aggregateConnectionStatus([
      { connection: 'connected', ice: 'connected' },
      { connection: 'failed', ice: 'connected' },
    ])).toBe('Connection failed');
  });
  it('prefers reconnecting over connecting when neither has failed', () => {
    expect(aggregateConnectionStatus([
      { connection: 'connecting', ice: 'checking' },
      { connection: 'disconnected', ice: 'disconnected' },
    ])).toBe('Reconnecting…');
  });
});
