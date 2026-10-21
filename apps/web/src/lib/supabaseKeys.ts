/**
 * Supabase issues two kinds of project key, and the site must work with either (plan20):
 *
 *   legacy JWT keys   `anon` and `service_role`, three dot-separated parts starting "eyJ". Sent as the `apikey` header AND as the
 *                     bearer token, as the dashboard's examples show.
 *   new keys          `sb_publishable_...` and `sb_secret_...`. Not JWTs. Sent as the `apikey` header only: the gateway turns
 *                     them into the right role itself, and a non-JWT string is not a valid bearer token.
 *
 * A signed-in person's own access token (a JWT) is always the bearer for a call made on their behalf. Nothing here logs or returns
 * a key anywhere but the header object.
 */
export function isJwtKey(key: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
}

/** Headers for a call to Supabase: the project key, and a bearer only when there is a JWT to send. */
export function supabaseKeyHeaders(key: string, bearer?: string): Record<string, string> {
  const token = bearer ?? (isJwtKey(key) ? key : undefined);
  return { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
