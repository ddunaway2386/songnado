import type { PlaylistMeta, ProviderId, Song } from '../types';

/**
 * A music-source provider — Deezer, Spotify, Apple Music, etc.
 *
 * Each provider exposes a uniform API so the rest of the app can deal with
 * playlists abstractly without caring where the music comes from. A `Playlist`
 * in the store carries a `provider` field; operations on that playlist are
 * routed through the matching `ProviderClient` via `getProvider(id)`.
 */
export interface ProviderClient {
  readonly id: ProviderId;
  /** Human-readable name shown in the UI (e.g. "Deezer", "Spotify"). */
  readonly displayName: string;

  /** Fetch a playlist's metadata: name, cover image, total track count. */
  getPlaylistMeta(playlistId: string): Promise<PlaylistMeta>;

  /**
   * Fetch a single track at the given index inside the playlist.
   * Returns `null` if the track has no playable preview — callers should
   * pick a different index and retry.
   */
  getTrackAtIndex(playlistId: string, index: number): Promise<Song | null>;

  /**
   * Parse a playlist URL or raw ID into a canonical provider-side ID.
   * Throws if the input doesn't match this provider's expected format.
   */
  extractPlaylistId(input: string): string;
}
