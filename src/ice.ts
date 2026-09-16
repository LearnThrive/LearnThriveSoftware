/** VITE_ configuration is browser-visible; TURN credentials should be short-lived. */
export function getIceConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const urls = import.meta.env.VITE_TURN_URL?.split(',').map((url: string) => url.trim()).filter(Boolean);
  if (urls?.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
    iceServers.push({ urls, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
  }
  return { iceServers };
}
