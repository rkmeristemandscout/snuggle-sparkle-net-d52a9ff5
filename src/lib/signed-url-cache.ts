/**
 * Short-lived in-memory cache for storage signed URLs.
 *
 * Keeps latency low for repeat downloads/previews within a session while
 * preserving security: entries are pruned before the underlying signed
 * URL expires, so a stale URL is never handed back to the browser.
 */

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();

// Retire a cache entry this many ms before its actual signed-URL expiry,
// so a URL never leaves this cache with less than SAFETY_MARGIN_MS of life.
const SAFETY_MARGIN_MS = 15_000;

export async function getCachedSignedUrl(
  key: string,
  expiresInSeconds: number,
  fetcher: () => Promise<string>,
): Promise<string> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt - SAFETY_MARGIN_MS > now) {
    return hit.url;
  }
  const url = await fetcher();
  cache.set(key, { url, expiresAt: now + expiresInSeconds * 1000 });
  return url;
}

export function invalidateSignedUrl(key: string) {
  cache.delete(key);
}

export function clearSignedUrlCache() {
  cache.clear();
}
