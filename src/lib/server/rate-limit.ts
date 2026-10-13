// In-memory limiter for failed Basic-auth attempts. Resets on restart; sufficient for a single-user app.
// Only failures count, so normal use (autosave, reloads) never triggers it.
export function createFailureLimiter(maxFailures = 10, windowMs = 60_000, maxTracked = 10_000) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  function prune(now: number) {
    for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key);
    // Bound memory even if many distinct addresses fail within one window.
    while (buckets.size >= maxTracked) buckets.delete(buckets.keys().next().value!);
  }
  return {
    blocked(key: string, now = Date.now()): boolean {
      const bucket = buckets.get(key);
      return !!bucket && now < bucket.resetAt && bucket.count >= maxFailures;
    },
    fail(key: string, now = Date.now()) {
      const bucket = buckets.get(key);
      if (bucket && now < bucket.resetAt) {
        bucket.count++;
        return;
      }
      if (buckets.size >= maxTracked) prune(now);
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    },
    succeed(key: string) {
      buckets.delete(key);
    }
  };
}
