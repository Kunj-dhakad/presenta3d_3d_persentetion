import "server-only";

/**
 * In-process sliding-window rate limiter. Sufficient for a single-instance
 * deployment; for horizontally scaled deployments swap this for a Redis-backed
 * limiter with the same interface (see README "Scaling").
 */
type Bucket = number[];
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (!b.length || now - b[b.length - 1] > windowMs * 2) buckets.delete(k);
    lastSweep = now;
  }
  const bucket = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (bucket.length >= limit) {
    buckets.set(key, bucket);
    return { ok: false, retryAfterMs: windowMs - (now - bucket[0]) };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.length };
}

export function resetRateLimits() {
  buckets.clear();
}
