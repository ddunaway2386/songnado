/**
 * Track-source lookup for the Movies / TV / Broadway / Commercials packs.
 *
 * Each entry maps a Deezer track ID (as a string) to the movie, show,
 * musical, or brand that song is associated with. Surfaces on the reveal
 * screen so the host can credit "Star Wars" or "Stranger Things" as a
 * correct guess in addition to the song title or artist.
 *
 * Data lives in `assets/sources/all.json`; new entries land there via
 * `scripts/extract-sources.mjs` (auto) + `scripts/propose-sources.mjs`
 * (LLM-proposed, curator-confirmed) + `scripts/apply-sources.mjs` (merge).
 *
 * Metro requires a literal `require()` path for static bundle analysis,
 * which is why the JSON is referenced once here rather than dynamically.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sourcesData: Record<string, string> = require('../assets/sources/all.json');

/**
 * Look up the source label for a Deezer track ID. Returns `null` if no
 * entry exists — most decade/occasion-pack tracks won't have one.
 */
export function getSourceForTrack(
  deezerTrackId: string | number | null | undefined
): string | null {
  if (deezerTrackId == null) return null;
  return sourcesData[String(deezerTrackId)] ?? null;
}
