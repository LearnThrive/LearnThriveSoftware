export function classifyConnectionStatus(connection: RTCPeerConnectionState, ice: RTCIceConnectionState): string {
  if (connection === 'connected') return 'Connected';
  if (connection === 'failed' || ice === 'failed') return 'Connection failed';
  if (connection === 'disconnected' || ice === 'disconnected') return 'Reconnecting…';
  return 'Connecting…';
}

/** One headline status across every current peer connection (up to 3 in a full classroom),
 * worst-of ordering so a single struggling connection isn't hidden behind healthier ones. */
export function aggregateConnectionStatus(peers: { connection: RTCPeerConnectionState; ice: RTCIceConnectionState }[]): string {
  if (peers.length === 0) return 'Waiting…';
  const statuses = peers.map((peer) => classifyConnectionStatus(peer.connection, peer.ice));
  if (statuses.includes('Connection failed')) return 'Connection failed';
  if (statuses.includes('Reconnecting…')) return 'Reconnecting…';
  if (statuses.includes('Connecting…')) return 'Connecting…';
  return 'Connected';
}
