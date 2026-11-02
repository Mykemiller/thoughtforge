/**
 * Access gate helpers (TH-32 §6). Web Crypto only, so the same code runs in the
 * Edge middleware, the Node route handlers and the test runner.
 */
export const ACCESS_COOKIE = "tf_access";
export const ACCESS_COOKIE_MAX_AGE = 90 * 24 * 60 * 60; // 90 days, seconds

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when the presented cookie value is the SHA-256 hex of the configured key. */
export async function cookieMatchesKey(cookieValue: string | undefined, key: string): Promise<boolean> {
  if (!cookieValue || !key) return false;
  const expected = await sha256Hex(key);
  return timingSafeEqualHex(cookieValue.toLowerCase(), expected);
}

/** True when the presented plaintext key is the configured key (compared via hashes). */
export async function queryKeyMatches(presented: string | null, key: string): Promise<boolean> {
  if (!presented || !key) return false;
  return timingSafeEqualHex(await sha256Hex(presented), await sha256Hex(key));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Paths the gate protects. Everything else stays public (TF-DEC-05). */
export function isGatedPath(pathname: string): boolean {
  return pathname === "/ask" || pathname.startsWith("/ask/") || pathname === "/api/ask" || pathname.startsWith("/api/ask/");
}
