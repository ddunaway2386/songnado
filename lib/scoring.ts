import type { GameMode, Team } from './types';

export const PREVIEW_DURATION_S = 30;
export const NO_ANSWER_PENALTY_BLITZ = -30;
export const NO_ANSWER_PENALTY_CLASSIC = -2;

export interface TargetScoreBounds {
  min: number;
  max: number;
  step: number;
  default: number;
}

export function targetScoreBounds(mode: GameMode): TargetScoreBounds {
  if (mode === 'blitz') return { min: 100, max: 500, step: 50, default: 300 };
  return { min: 5, max: 25, step: 1, default: 15 };
}

/**
 * Packs where the primary trivia challenge is the SOURCE (movie / TV
 * show / musical name), not the song title. Composer / cast artists
 * are usually obscure (Hans Zimmer, John Williams, Ramin Djawadi,
 * Lin-Manuel Miranda, cast recordings) so we weight the source higher.
 *
 * Source-heavy scoring: source = 2, artist = +1, both = 3.
 * (Standard packs: song = 1, artist = 1, both = 3.)
 */
const SOURCE_HEAVY_PACK_IDS = new Set<string>([
  'songnado-movie-soundtracks',
  'songnado-classic-tv-themes',
  'songnado-modern-tv-themes',
  'songnado-broadway',
]);

export function isSourceHeavyPack(playlistId: string | null | undefined): boolean {
  return playlistId != null && SOURCE_HEAVY_PACK_IDS.has(playlistId);
}

/**
 * Human-facing label for the primary-field toggle. For source-heavy
 * packs it's the source name (Movie / Show / Musical), for standard
 * packs it's 'Song'.
 */
export function primaryFieldLabel(playlistId: string | null | undefined): string {
  if (!playlistId) return 'Song';
  if (playlistId.includes('tv-themes')) return 'Show';
  if (playlistId.includes('broadway')) return 'Musical';
  if (playlistId.includes('soundtracks')) return 'Movie';
  return 'Song';
}

/**
 * Round-points calculator for Classic / Blitz.
 *
 * Scoring rules by scenario:
 *
 *   Standard pack, own turn:
 *     song ✓ artist ✓ = 3;  either alone = 1;  neither = 0.
 *
 *   Source-heavy pack (movies-soundtracks/tv-themes/broadway), own turn:
 *     source ✓ artist ✓ = 3;  source alone = 2;  artist alone = 1;  neither = 0.
 *
 *   Steal (any pack): another team catches it after the active team ran
 *     out of time on an alternating-turn round.
 *     both ✓ = 2;  either alone = 1;  neither = 0.
 *
 * Blitz mode multiplies base × (30 − timeUsed) after rule selection.
 * The 'song' param carries song-or-source correctness depending on
 * pack type; caller knows which.
 */
export function calculateRoundPoints(
  songCorrect: boolean,
  artistCorrect: boolean,
  timeUsed: number,
  mode: GameMode,
  options?: { isSteal?: boolean; playlistId?: string | null }
): number {
  const isSteal = options?.isSteal === true;
  const sourceHeavy = isSourceHeavyPack(options?.playlistId);

  let base: number;
  if (isSteal) {
    // Steal is always flat 2 for both, 1 for one, 0 for none — cap the
    // stealer's payoff below the active team's normal ceiling.
    if (songCorrect && artistCorrect) base = 2;
    else if (songCorrect || artistCorrect) base = 1;
    else base = 0;
  } else if (sourceHeavy) {
    // Source-heavy: source-slot = 2, artist-slot = 1, additive.
    base = (songCorrect ? 2 : 0) + (artistCorrect ? 1 : 0);
  } else {
    // Standard: 3 for both, 1 for one, 0 for none.
    if (songCorrect && artistCorrect) base = 3;
    else if (songCorrect || artistCorrect) base = 1;
    else base = 0;
  }

  if (mode !== 'blitz') return base;

  const capped = Math.max(0, Math.min(PREVIEW_DURATION_S, timeUsed));
  const raw = base * (PREVIEW_DURATION_S - capped);
  return raw === 0 ? 0 : raw;
}

export function noAnswerPenalty(mode: GameMode): number {
  if (mode === 'blitz') return NO_ANSWER_PENALTY_BLITZ;
  if (mode === 'classic') return NO_ANSWER_PENALTY_CLASSIC;
  return 0; // Elimination has no point-based penalty
}

/**
 * Reduced no-answer penalty for rounds where a steal window was
 * available. Rationale: other teams had a chance to score, so
 * penalizing the active team as harshly as a full-round bust
 * doesn't fit the mechanic.
 */
export const NO_ANSWER_PENALTY_BLITZ_STEAL = -20;
export const NO_ANSWER_PENALTY_CLASSIC_STEAL = -1;

export function noAnswerPenaltyWithSteal(mode: GameMode): number {
  if (mode === 'blitz') return NO_ANSWER_PENALTY_BLITZ_STEAL;
  if (mode === 'classic') return NO_ANSWER_PENALTY_CLASSIC_STEAL;
  return 0;
}

/**
 * Points a stealing team earns per correct part (song / artist).
 * Flat — steal doesn't scale with time-remaining like Blitz's normal
 * scoring does. Steal is bonus content, not the main scoring loop.
 * Multiple teams can each be awarded the same part.
 */
export function stealPointsPerPart(mode: GameMode): number {
  return mode === 'blitz' ? 10 : 1;
}

export function findWinnerIndex(teams: Team[], targetScore: number): number | null {
  if (targetScore <= 0 || teams.length === 0) return null;
  let bestIndex: number | null = null;
  let bestScore = -Infinity;
  for (const team of teams) {
    if (team.score >= targetScore && team.score > bestScore) {
      bestScore = team.score;
      bestIndex = team.index;
    }
  }
  return bestIndex;
}

/** Elimination winner: first team to have cleared every selected playlist. */
export function findEliminationWinner(
  teams: Team[],
  selectedPlaylistIds: string[]
): number | null {
  if (selectedPlaylistIds.length === 0) return null;
  const required = new Set(selectedPlaylistIds);
  for (const team of teams) {
    const cleared = new Set(team.completedPlaylists);
    let hasAll = true;
    for (const id of required) {
      if (!cleared.has(id)) {
        hasAll = false;
        break;
      }
    }
    if (hasAll) return team.index;
  }
  return null;
}
