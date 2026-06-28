/**
 * Rolling-average round-trip latency tracker.
 *
 * Each client periodically sends a PING with its current clock; host
 * echoes via PONG. The client measures the round-trip time and feeds
 * it here. We keep the last N samples and report the median (robust
 * to occasional jitter spikes).
 *
 * The buzz-race compensator on the host side only uses ~50ms ping
 * resolution, so a rolling median over 5 samples is plenty.
 */

export class PingTracker {
  private samples: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  /** Record a single round-trip in milliseconds. */
  record(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    this.samples.push(rttMs);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
  }

  /**
   * Median of the current window in ms, or null if no samples yet.
   * Median (not mean) so one stalled TCP packet doesn't poison the value.
   */
  median(): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /** Average of the current window in ms, or null if no samples yet. */
  mean(): number | null {
    if (this.samples.length === 0) return null;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }

  sampleCount(): number {
    return this.samples.length;
  }
}

/**
 * One-way trip estimate used by the buzz-race compensator. We assume
 * symmetric round-trip (uplink == downlink). For LAN Wi-Fi this holds
 * within ~5ms in practice — well within human reaction-time variance.
 */
export function oneWayEstimateMs(rttMs: number): number {
  return rttMs / 2;
}
