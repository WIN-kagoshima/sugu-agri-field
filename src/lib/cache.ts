/**
 * Minimal TTL cache used by adapters.
 *
 * Intentionally tiny: Map-based, no LRU. Adapters can swap to a real
 * Cloud Memorystore-backed cache later without changing the call sites.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly store = new Map<K, Entry<V>>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async getOrSet(key: K, factory: () => Promise<V>, ttlMs?: number): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
