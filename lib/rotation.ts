export interface RotationPick {
  index: number;
  nextPlayed: number[];
  didReset: boolean;
}

export function selectNextIndex(
  playedIndices: readonly number[],
  totalTracks: number,
  rng: () => number = Math.random
): RotationPick | null {
  if (totalTracks <= 0) return null;

  const played = new Set(playedIndices);
  let didReset = false;
  let remaining: number[] = [];
  for (let i = 0; i < totalTracks; i++) if (!played.has(i)) remaining.push(i);

  if (remaining.length === 0) {
    didReset = true;
    played.clear();
    remaining = Array.from({ length: totalTracks }, (_, i) => i);
  }

  const pick = remaining[Math.floor(rng() * remaining.length)];
  const nextPlayed = didReset ? [pick] : [...playedIndices, pick];

  return { index: pick, nextPlayed, didReset };
}
