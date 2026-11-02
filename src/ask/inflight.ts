/** One in-flight /api/ask request per access cookie (TH-32 §4.1 cost guard). Process-local by design. */
const inflight = new Set<string>();

export function acquire(key: string): boolean {
  if (inflight.has(key)) return false;
  inflight.add(key);
  return true;
}

export function release(key: string): void {
  inflight.delete(key);
}

export function inflightCount(): number {
  return inflight.size;
}
