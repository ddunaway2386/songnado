/**
 * Module-global diagnostic log for debugging the OTA hydration hang.
 *
 * OTA-delivered bundles run JS and render our pre-hydration spinner, but
 * store hydration never completes — and nothing throws, so Sentry stays
 * silent. This log turns the spinner screen into a live readout of what
 * the stores actually did. TEMPORARY — remove after the hang is fixed.
 */

type Listener = () => void;

const entries: string[] = [];
const listeners = new Set<Listener>();
const t0 = Date.now();

export function diag(msg: string): void {
  entries.push(`+${((Date.now() - t0) / 1000).toFixed(2)}s ${msg}`);
  listeners.forEach((l) => l());
}

export function getDiagEntries(): string[] {
  return entries.slice();
}

export function subscribeDiag(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

diag('diagLog module loaded');
