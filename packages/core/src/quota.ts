import type { QuotaLimits } from "@slate/sdk";

const WINDOWS = [
  ["perMinute", 60_000],
  ["perHour", 3_600_000],
  ["perDay", 86_400_000],
] as const;

export interface Acquire {
  ok: boolean;
  /** Epoch ms when a call is next allowed (equals `now` when ok). */
  retryAt: number;
}

/** Sliding-window call budget plus exponential backoff after rate-limit responses. */
export class QuotaTracker {
  private calls: number[] = [];
  private backoffUntil = 0;
  private failures = 0;

  constructor(
    private readonly limits: QuotaLimits = {},
    private readonly maxBackoffMs = 3_600_000,
  ) {}

  check(now: number): Acquire {
    if (now < this.backoffUntil) return { ok: false, retryAt: this.backoffUntil };
    let retryAt = now;
    for (const [key, span] of WINDOWS) {
      const limit = this.limits[key];
      if (limit === undefined) continue;
      const inWindow = this.calls.filter((t) => t > now - span);
      if (inWindow.length >= limit)
        retryAt = Math.max(retryAt, inWindow[inWindow.length - limit]! + span);
    }
    return { ok: retryAt === now, retryAt };
  }

  tryAcquire(now: number): Acquire {
    const result = this.check(now);
    if (result.ok) {
      this.calls.push(now);
      this.calls = this.calls.filter((t) => t > now - 86_400_000);
    }
    return result;
  }

  /** Call after a 429/503. Honors Retry-After when given, else doubles from 30s. */
  rateLimited(now: number, retryAfterMs?: number): number {
    this.failures++;
    const exp = Math.min(this.maxBackoffMs, 30_000 * 2 ** (this.failures - 1));
    this.backoffUntil = now + Math.max(retryAfterMs ?? 0, exp);
    return this.backoffUntil;
  }

  succeeded(): void {
    this.failures = 0;
  }

  usage(now: number): Record<string, number> {
    return Object.fromEntries(
      WINDOWS.map(([key, span]) => [key, this.calls.filter((t) => t > now - span).length]),
    );
  }
}
