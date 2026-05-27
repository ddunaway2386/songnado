export type GameMode = 'classic' | 'blitz' | 'elimination';

export type ProviderId = 'deezer' | 'spotify';

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
}

export interface PlaylistMeta {
  id: string;
  name: string;
  imageUrl: string;
  totalTracks: number;
}

export interface Playlist extends PlaylistMeta {
  provider: ProviderId;
  isBuiltIn: boolean;
  playedIndices: number[];
}

export interface Team {
  id: string;
  index: number;
  name: string;
  score: number;
  completedPlaylists: string[];
}
