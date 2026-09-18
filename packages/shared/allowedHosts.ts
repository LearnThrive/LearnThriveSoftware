/**
 * Ephemeral dev-tunnel domains that assign an unpredictable subdomain per session, so they
 * can't be pinned to one exact hostname the way a named domain can: Cloudflare Quick Tunnels
 * and Tailscale Serve/Funnel. Scoped to exactly these known suffixes — never a bare wildcard —
 * so this stays far narrower than allowing any host, while removing the need to copy a new
 * generated hostname into .env every time a tunnel session restarts.
 */
export const DEV_TUNNEL_HOST_SUFFIXES = ['.trycloudflare.com', '.ts.net'];

export function isDevTunnelHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return DEV_TUNNEL_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}
