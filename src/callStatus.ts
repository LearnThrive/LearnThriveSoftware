export function classifyConnectionStatus(connection: RTCPeerConnectionState, ice: RTCIceConnectionState): string {
  if (connection === 'connected') return 'Connected';
  if (connection === 'failed' || ice === 'failed') return 'Connection failed';
  if (connection === 'disconnected' || ice === 'disconnected') return 'Reconnecting…';
  return 'Connecting…';
}
