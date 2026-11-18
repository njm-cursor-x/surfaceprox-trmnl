export interface CacheEntry<T = unknown> {
  data?: T;
  fetchedAt?: number;
  error?: string;
  errorAt?: number;
}

export interface CacheRead<T> extends CacheEntry<T> {
  stale: boolean;
}

/**
 * Stale-while-revalidate cache keyed by connector instance. Readers always get the last
 * good data; concurrent refreshes of one key share a single in-flight fetch.
 */
export class ConnectorCache {
  private entries = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<CacheEntry>>();

  read<T>(key: string, maxAgeMs: number, now = Date.now()): CacheRead<T> {
    const entry = (this.entries.get(key) ?? {}) as CacheEntry<T>;
    const stale = entry.fetchedAt === undefined || now - entry.fetchedAt > maxAgeMs;
    return { ...entry, stale };
  }

  refresh<T>(
    key: string,
    fetcher: () => Promise<T>,
    now: () => number = Date.now,
  ): Promise<CacheEntry<T>> {
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<CacheEntry<T>>;
    const run = (async () => {
      const prev = this.entries.get(key) ?? {};
      try {
        const data = await fetcher();
        const next: CacheEntry = { data, fetchedAt: now() };
        this.entries.set(key, next);
        return next;
      } catch (err) {
        const next: CacheEntry = {
          ...prev,
          error: err instanceof Error ? err.message : String(err),
          errorAt: now(),
        };
        this.entries.set(key, next);
        return next;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, run);
    return run as Promise<CacheEntry<T>>;
  }

  set<T>(key: string, data: T, fetchedAt = Date.now()): void {
    this.entries.set(key, { data, fetchedAt });
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }
}
