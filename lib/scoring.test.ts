import {
  calculateRoundPoints,
  findEliminationWinner,
  findWinnerIndex,
  isSourceHeavyPack,
  NO_ANSWER_PENALTY_BLITZ,
  NO_ANSWER_PENALTY_BLITZ_STEAL,
  NO_ANSWER_PENALTY_CLASSIC,
  NO_ANSWER_PENALTY_CLASSIC_STEAL,
  noAnswerPenalty,
  noAnswerPenaltyWithSteal,
  PREVIEW_DURATION_S,
  primaryFieldLabel,
  stealPointsPerPart,
  targetScoreBounds,
} from './scoring';
import type { Team } from './types';

function makeTeam(index: number, score: number, completedPlaylists: string[] = []): Team {
  return {
    id: `t${index}`,
    index,
    name: `Team ${index + 1}`,
    score,
    completedPlaylists,
  };
}

describe('calculateRoundPoints — Blitz', () => {
  test('both correct at t=0 is the maximum: 3 × 30 = 90', () => {
    expect(calculateRoundPoints(true, true, 0, 'blitz')).toBe(90);
  });

  test('both correct at t=30 is 0', () => {
    expect(calculateRoundPoints(true, true, 30, 'blitz')).toBe(0);
  });

  test('one correct at t=10 = 1 × 20 = 20', () => {
    expect(calculateRoundPoints(true, false, 10, 'blitz')).toBe(20);
    expect(calculateRoundPoints(false, true, 10, 'blitz')).toBe(20);
  });

  test('both wrong is 0 (no negative penalty for buzzing wrong)', () => {
    expect(calculateRoundPoints(false, false, 0, 'blitz')).toBe(0);
    expect(calculateRoundPoints(false, false, 15, 'blitz')).toBe(0);
  });

  test('timeUsed clamped to [0, 30]', () => {
    expect(calculateRoundPoints(true, true, -5, 'blitz')).toBe(90);
    expect(calculateRoundPoints(true, true, 100, 'blitz')).toBe(0);
  });
});

describe('calculateRoundPoints — Classic (flat)', () => {
  test('both correct = 3 regardless of time', () => {
    expect(calculateRoundPoints(true, true, 0, 'classic')).toBe(3);
    expect(calculateRoundPoints(true, true, 25, 'classic')).toBe(3);
  });

  test('one correct = 1', () => {
    expect(calculateRoundPoints(true, false, 0, 'classic')).toBe(1);
    expect(calculateRoundPoints(false, true, 12, 'classic')).toBe(1);
  });

  test('both wrong = 0', () => {
    expect(calculateRoundPoints(false, false, 5, 'classic')).toBe(0);
  });
});

describe('noAnswerPenalty', () => {
  test('Blitz: -30', () => {
    expect(noAnswerPenalty('blitz')).toBe(NO_ANSWER_PENALTY_BLITZ);
    expect(NO_ANSWER_PENALTY_BLITZ).toBe(-30);
  });
  test('Classic: -2', () => {
    expect(noAnswerPenalty('classic')).toBe(NO_ANSWER_PENALTY_CLASSIC);
    expect(NO_ANSWER_PENALTY_CLASSIC).toBe(-2);
  });
  test('Elimination: 0', () => {
    expect(noAnswerPenalty('elimination')).toBe(0);
  });
});

describe('targetScoreBounds', () => {
  test('Classic uses small range', () => {
    expect(targetScoreBounds('classic')).toEqual({ min: 5, max: 25, step: 1, default: 15 });
  });
  test('Blitz uses big range with step of 50', () => {
    expect(targetScoreBounds('blitz')).toEqual({ min: 100, max: 500, step: 50, default: 300 });
  });
});

describe('findWinnerIndex (Classic / Blitz)', () => {
  test('returns null when no team has reached target', () => {
    expect(findWinnerIndex([makeTeam(0, 5), makeTeam(1, 8)], 10)).toBeNull();
  });
  test('returns index of team at or above target', () => {
    expect(findWinnerIndex([makeTeam(0, 5), makeTeam(1, 12)], 10)).toBe(1);
  });
  test('with multiple at target, returns highest-scoring', () => {
    expect(findWinnerIndex([makeTeam(0, 15), makeTeam(1, 20), makeTeam(2, 12)], 10)).toBe(1);
  });
});

describe('findEliminationWinner', () => {
  test('returns null when no team has cleared all playlists', () => {
    const teams = [makeTeam(0, 0, ['a']), makeTeam(1, 0, ['b'])];
    expect(findEliminationWinner(teams, ['a', 'b', 'c'])).toBeNull();
  });

  test('returns index of team that cleared every selected playlist', () => {
    const teams = [makeTeam(0, 0, ['a', 'b']), makeTeam(1, 0, ['a', 'b', 'c'])];
    expect(findEliminationWinner(teams, ['a', 'b', 'c'])).toBe(1);
  });

  test('returns null with empty selectedPlaylistIds', () => {
    expect(findEliminationWinner([makeTeam(0, 0)], [])).toBeNull();
  });

  test('extra cleared playlists not in selection do not block a win', () => {
    const teams = [makeTeam(0, 0, ['a', 'b', 'c', 'extra'])];
    expect(findEliminationWinner(teams, ['a', 'b', 'c'])).toBe(0);
  });
});

test('PREVIEW_DURATION_S is 30', () => {
  expect(PREVIEW_DURATION_S).toBe(30);
});

describe('calculateRoundPoints — source-heavy pack (Classic)', () => {
  const opts = { playlistId: 'songnado-broadway' };
  test('source ✓ artist ✓ = 3', () => {
    expect(calculateRoundPoints(true, true, 5, 'classic', opts)).toBe(3);
  });
  test('source alone = 2', () => {
    expect(calculateRoundPoints(true, false, 5, 'classic', opts)).toBe(2);
  });
  test('artist alone = 1', () => {
    expect(calculateRoundPoints(false, true, 5, 'classic', opts)).toBe(1);
  });
  test('neither = 0', () => {
    expect(calculateRoundPoints(false, false, 5, 'classic', opts)).toBe(0);
  });
});

describe('calculateRoundPoints — source-heavy pack (Blitz)', () => {
  const opts = { playlistId: 'songnado-movie-soundtracks' };
  test('source ✓ artist ✓ at t=0 = 3 × 30 = 90', () => {
    expect(calculateRoundPoints(true, true, 0, 'blitz', opts)).toBe(90);
  });
  test('source alone at t=10 = 2 × 20 = 40', () => {
    expect(calculateRoundPoints(true, false, 10, 'blitz', opts)).toBe(40);
  });
  test('artist alone at t=10 = 1 × 20 = 20', () => {
    expect(calculateRoundPoints(false, true, 10, 'blitz', opts)).toBe(20);
  });
});

describe('calculateRoundPoints — steal (any pack)', () => {
  test('standard pack: both = 2 (was 3 for own turn)', () => {
    expect(
      calculateRoundPoints(true, true, 5, 'classic', { isSteal: true })
    ).toBe(2);
  });
  test('standard pack: one = 1', () => {
    expect(
      calculateRoundPoints(true, false, 5, 'classic', { isSteal: true })
    ).toBe(1);
    expect(
      calculateRoundPoints(false, true, 5, 'classic', { isSteal: true })
    ).toBe(1);
  });
  test('source-heavy pack steal still capped at 1/2 (per user rule)', () => {
    const opts = { isSteal: true, playlistId: 'songnado-broadway' };
    expect(calculateRoundPoints(true, true, 5, 'classic', opts)).toBe(2);
    expect(calculateRoundPoints(true, false, 5, 'classic', opts)).toBe(1);
    expect(calculateRoundPoints(false, true, 5, 'classic', opts)).toBe(1);
  });
  test('Blitz steal scales with time', () => {
    expect(
      calculateRoundPoints(true, true, 10, 'blitz', { isSteal: true })
    ).toBe(40); // 2 × 20
  });
});

describe('isSourceHeavyPack', () => {
  test('true for movie soundtracks, TV themes, broadway', () => {
    expect(isSourceHeavyPack('songnado-movie-soundtracks')).toBe(true);
    expect(isSourceHeavyPack('songnado-classic-tv-themes')).toBe(true);
    expect(isSourceHeavyPack('songnado-modern-tv-themes')).toBe(true);
    expect(isSourceHeavyPack('songnado-broadway')).toBe(true);
  });
  test('false for movie songs, wedding, decades, and unknown IDs', () => {
    expect(isSourceHeavyPack('songnado-movie-songs')).toBe(false);
    expect(isSourceHeavyPack('songnado-wedding')).toBe(false);
    expect(isSourceHeavyPack('13700823521')).toBe(false); // 70s live-Deezer id
    expect(isSourceHeavyPack(null)).toBe(false);
    expect(isSourceHeavyPack(undefined)).toBe(false);
  });
});

describe('primaryFieldLabel', () => {
  test('Show for TV, Musical for Broadway, Movie for soundtracks, Song otherwise', () => {
    expect(primaryFieldLabel('songnado-classic-tv-themes')).toBe('Show');
    expect(primaryFieldLabel('songnado-modern-tv-themes')).toBe('Show');
    expect(primaryFieldLabel('songnado-broadway')).toBe('Musical');
    expect(primaryFieldLabel('songnado-movie-soundtracks')).toBe('Movie');
    expect(primaryFieldLabel('songnado-movie-songs')).toBe('Song');
    expect(primaryFieldLabel('songnado-wedding')).toBe('Song');
    expect(primaryFieldLabel(null)).toBe('Song');
  });
});

describe('stealPointsPerPart', () => {
  test('Classic = 1 per part', () => {
    expect(stealPointsPerPart('classic')).toBe(1);
  });
  test('Blitz = 10 per part (flat, no time scaling)', () => {
    expect(stealPointsPerPart('blitz')).toBe(10);
  });
  test('Elimination = 1 (n/a but returns default classic value)', () => {
    expect(stealPointsPerPart('elimination')).toBe(1);
  });
});

describe('noAnswerPenaltyWithSteal', () => {
  test('Classic reduced -2 -> -1', () => {
    expect(noAnswerPenaltyWithSteal('classic')).toBe(NO_ANSWER_PENALTY_CLASSIC_STEAL);
    expect(NO_ANSWER_PENALTY_CLASSIC_STEAL).toBe(-1);
  });
  test('Blitz reduced -30 -> -20', () => {
    expect(noAnswerPenaltyWithSteal('blitz')).toBe(NO_ANSWER_PENALTY_BLITZ_STEAL);
    expect(NO_ANSWER_PENALTY_BLITZ_STEAL).toBe(-20);
  });
  test('Elimination: 0', () => {
    expect(noAnswerPenaltyWithSteal('elimination')).toBe(0);
  });
});
