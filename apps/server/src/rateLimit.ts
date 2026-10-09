/** Classic token bucket. `take` returns false when the caller is over its rate. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(
    capacity: number,
    refillPerSecond: number,
    now: () => number = performance.now.bind(performance),
  ) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Milliseconds until `take(cost)` would succeed: 0 if it would now. */
  wait(cost = 1): number {
    this.refill();
    return this.tokens >= cost ? 0 : ((cost - this.tokens) / this.refillPerSecond) * 1000;
  }

  private refill(): void {
    const now = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refillPerSecond,
    );
    this.last = now;
  }
}

/**
 * Counts misbehavior (rate-limited or invalid messages). Strikes leak away over time, so an
 * occasional burst is forgiven but sustained flooding crosses the limit quickly.
 */
export class StrikeCounter {
  private strikes = 0;
  private last: number;
  private readonly limit: number;
  private readonly leakPerSecond: number;
  private readonly now: () => number;

  constructor(
    limit: number,
    leakPerSecond: number,
    now: () => number = performance.now.bind(performance),
  ) {
    this.limit = limit;
    this.leakPerSecond = leakPerSecond;
    this.now = now;
    this.last = now();
  }

  /** Record one strike. Returns true once the limit is exceeded. */
  add(): boolean {
    const now = this.now();
    this.strikes = Math.max(0, this.strikes - ((now - this.last) / 1000) * this.leakPerSecond);
    this.last = now;
    this.strikes += 1;
    return this.strikes > this.limit;
  }
}
