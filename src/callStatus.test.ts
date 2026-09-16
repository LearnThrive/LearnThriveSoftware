import { describe, expect, it } from 'vitest';
import { classifyConnectionStatus } from './callStatus';

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
