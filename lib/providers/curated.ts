/**
 * Curated-Spotify music provider.
 *
 * Reads pre-baked track data from `lib/curated/loader.ts` instead of hitting
 * the Spotify Web API for catalog data. Playback still uses Spotify Connect
 * (via `playUri` from `lib/spotify/playback.ts`), so a connected Spotify
 * Premium session is still required — only the track-list fetch is local.
 *
 * Why a separate provider rather than extending `spotifyProvider`:
 *  - Cleaner separation. The live-API Spotify provider is a tangle of
 *    dev-mode workarounds (context+shuffle, skipToNext, dedup retries) that
 *    none of this path needs.
 *  - Different gameplay semantics. Curated provider honors the `index`
 *    parameter (rotation picks a specific track); live provider ignores
 *    it (Spotify shuffle owns order).
 *  - Different metadata source. Curated `getPlaylistMeta` is a sync
 *    lookup, no network.
 *
 * See `CURATED_PLAYLISTS_DESIGN.md` for the full architecture.
 */

import { getCuratedPlaylist } from '../curated/loader';
import type { PlaylistMeta, Song } from '../types';
import type { ProviderClient } from './types';

function trackToSong(
  track: { uri: string; title: string; artist: string; albumImageUrl?: string; durationMs: number },
  fallbackImage: string
): Song {
  return {
    title: track.title,
    artist: track.artist,
    previewUrl: '', // Curated tracks play via Spotify Connect, not preview URL.
    coverUrl: track.albumImageUrl || fallbackImage,
    spotifyUri: track.uri,
    durationMs: track.durationMs,
  };
}

export const curatedSpotifyProvider: ProviderClient = {
  id: 'curated',
  displayName: 'Songnado',

  async getPlaylistMeta(playlistId): Promise<PlaylistMeta> {
    const data = getCuratedPlaylist(playlistId);
    return {
      id: data.id,
      name: data.name,
      imageUrl: data.imageUrl,
      totalTracks: data.tracks.length,
    };
  },

  async getTrackAtIndex(playlistId, index): Promise<Song | null> {
    const data = getCuratedPlaylist(playlistId);
    const track = data.tracks[index];
    if (!track) return null;
    return trackToSong(track, data.imageUrl);
  },

  extractPlaylistId(_input): string {
    // Curated playlists are app-managed and never added by URL paste.
    // Reaching this from Add-Playlist UI would be a routing bug worth surfacing.
    throw new Error('Curated playlists cannot be added by URL — they ship with the app.');
  },
};
