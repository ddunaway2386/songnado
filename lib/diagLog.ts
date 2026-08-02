/**
 * Module-global diagnostic log for debugging the OTA hydration hang.
 *
 * OTA-delivered bundles run JS and render our pre-hydration spinner, but
 * store hydration never completes — and nothing throws, so Sentry stays
 * silent. This log turns the spinner screen into a live readout of what
 * the stores actually did. TEMPORARY — remove after the hang is fixed.
 *
 * Deliberately dependency-free and dead simple: a plain array plus a
 * counter. The UI polls it on an interval rather than subscribing, so
 * there is no way for this to trigger a React render loop (an earlier
 * useSyncExternalStore version returned a fresh array each call and
 * crashed the app outright).
 */

const entries: string[] = [];
const t0 = Date.now();

export function diag(msg: string): void {
  try {
    entries.push(`+${((Date.now() - t0) / 1000).toFixed(2)}s ${msg}`);
    if (entries.length > 200) entries.shift();
  } catch {
    // Never let diagnostics break the app.
  }
}

/** Snapshot for rendering. Callers copy defensively themselves. */
export function getDiagEntries(): string[] {
  return entries;
}

diag('diagLog module loaded');
