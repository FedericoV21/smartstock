type Bucket = { count: number; windowStartMs: number };

const WINDOW_MS = 60_000; // 1 minuto
const MAX_MSGS_PER_TENANT_PER_WINDOW = 120;
const buckets = new Map<string, Bucket>();

export function whatsappInboundAllowed(tenantId: string): boolean {
  const now = Date.now();
  const prev = buckets.get(tenantId);
  if (!prev || now - prev.windowStartMs >= WINDOW_MS) {
    buckets.set(tenantId, { count: 1, windowStartMs: now });
    return true;
  }

  if (prev.count >= MAX_MSGS_PER_TENANT_PER_WINDOW) {
    return false;
  }
  prev.count += 1;
  return true;
}
