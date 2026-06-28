export type GameMode = 'classic' | 'blitz' | 'elimination' | 'buzz';

export type ProviderId = 'deezer' | 'spotify' | 'curated' | 'curated-deezer';

export interface Song {
  title: string;
  artist: string;
  /**
   * Direct streaming URL for a 30s preview. Populated for Deezer tracks;
   * empty string for Spotify tracks (which play via Spotify Connect using
   * `spotifyUri` + `durationMs` instead).
   *
   * Phase C.3 will collapse this + `spotifyUri` + `durationMs` into a
   * single `PlayableTrackHandle` discriminated union. For now we keep the
   * fields additive so existing Deezer callers don't need to change.
   */
  previewUrl: string;
  coverUrl: string;
  /** Spotify track URI (e.g. `spotify:track:abc`) — set only for Spotify-sourced tracks. */
  spotifyUri?: string;
  /** Total track duration in ms. Used by Spotify random-window playback (C.5). */
  durationMs?: number;
  /**
   * Spotify playlist ID this track came from. Required for the playback
   * call to use `{context_uri, offset:{uri}, position_ms}` — re-establishing
   * playlist context on each play() so the queue stays alive for skipToNext,
   * while still letting us jump to a specific track at a random position.
   */
  spotifyPlaylistId?: string;
  /**
   * Source-of-origin label for Movies / TV / Broadway / Commercials packs —
   * the movie, show, musical, or brand this track is associated with.
   * Surfaces on the reveal screen so the host knows what to credit as a
   * correct guess (e.g. "from Star Wars") in addition to the song title or
   * artist. Empty/undefined for decade and occasion packs.
   *
   * Populated via lib/sources lookup at provider build time; see
   * assets/sources/all.json for the data.
   */
  source?: string;
}

export interface PlaylistMeta {
  id: string;
  name: string;
  imageUrl: string;
  totalTracks: number;
}

/**
 * Soft-lock tier for built-in packs.
 *  - 'free' — visible and playable to anyone, no unlock needed
 *  - 'locked' — visible but grayed; unlockable via engagement (play count,
 *    share), one-time IAP, or Pro subscription
 *
 * User-added playlists (added via URL paste) are always treated as 'free'
 * by default — the user clearly wants to play them.
 */
export type PlaylistTier = 'free' | 'locked';

export interface Playlist extends PlaylistMeta {
  provider: ProviderId;
  isBuiltIn: boolean;
  playedIndices: number[];
  /**
   * Lock tier. Optional for backwards compat — older persisted playlists
   * without this field are treated as 'free' at the consumer (see
   * `isUnlocked` in unlocksStore).
   */
  tier?: PlaylistTier;
}

export interface Team {
  id: string;
  index: number;
  name: string;
  score: number;
  completedPlaylists: string[];
}
