// Lightweight per-IP rate limiting (abuse / cost protection).
//
// NOTE: this is in-memory, so on serverless it is "best effort" — each function
// instance has its own counters. It blunts the obvious abuse (one client hammering
// an endpoint) but is NOT a hard guarantee. The real hard ceiling must be a Google
// Cloud billing/quota cap. For distributed limits, swap this for Vercel KV / Upstash.

type Cfg = { max: number; windowMs: number };

// How many calls per key, per window, for each endpoint.
// The key is the PROFILE id when the client sends one (x-mk-profile header),
// falling back to IP. Profile-keying matters at booths: every tablet shares
// one venue IP, so IP limits would let one child lock out the next.
const LIMITS: Record<string, Cfg> = {
  stylize: { max: 15, windowMs: 60_000 }, // clay image: 15 / minute
  animate: { max: 4, windowMs: 600_000 }, // video (expensive!): 4 / 10 minutes
  "animate-status": { max: 150, windowMs: 60_000 }, // polling is frequent — keep loose
  track: { max: 300, windowMs: 60_000 }, // analytics events
  save: { max: 30, windowMs: 60_000 }, // profile / monster saves
};

const hits: Record<string, Map<string, number[]>> = {};

// Returns true if allowed, false if the IP is over the limit for this endpoint.
export function checkLimit(name: string, ip: string): boolean {
  const cfg = LIMITS[name];
  if (!cfg) return true;
  const now = Date.now();
  const bucket = (hits[name] ??= new Map());
  const recent = (bucket.get(ip) ?? []).filter((t) => now - t < cfg.windowMs);
  if (recent.length >= cfg.max) {
    bucket.set(ip, recent);
    return false;
  }
  recent.push(now);
  bucket.set(ip, recent);
  return true;
}

// Best-effort client IP from the proxy header, with a fallback.
export function clientIp(xff: string | string[] | undefined, fallback?: string): string {
  const raw = Array.isArray(xff) ? xff[0] : xff;
  return raw?.split(",")[0].trim() || fallback || "unknown";
}

// Rate-limit key: profile id if the client sent one, else IP.
export function limitKey(
  profileHeader: string | string[] | undefined,
  xff: string | string[] | undefined,
  fallback?: string
): string {
  const p = Array.isArray(profileHeader) ? profileHeader[0] : profileHeader;
  return (p && p.trim()) || clientIp(xff, fallback);
}
