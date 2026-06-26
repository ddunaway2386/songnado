/**
 * Curated-Deezer music provider.
 *
 * The catalog and source data come from `lib/curated/deezer-loader.ts` (a
 * bundled JSON file per pack). Each round we still fetch a fresh preview URL
 * from Deezer's track API because Deezer's preview URLs carry time-limited
 * CDN tokens that expire after a few hours — the same reason the HTML
 * preview-review players fetch fresh URLs on click.
 *
 * Why this path exists separate from `deezerProvider`:
 *  - Faster curator iteration. Adding/removing tracks is a JSON edit instead
 *    of a Deezer-UI click. (Deezer Developer registration has been closed
 *    since June 2026, so we have no API write access for playlist edits.)
 *  - Bundled `source` field means every track shows a "from X" badge without
 *    a runtime join against `assets/sources/all.json`.
 */

import { getCuratedDeezerPlaylist } from '../curated/deezer-loader';
import type { PlaylistMeta, Song } from '../types';
import type { ProviderClient } from './types';

const DEEZER_BASE = 'https://api.deezer.com';

interface DeezerTrackResponse {
  preview?: string | null;
  album?: { cover_big?: string };
  error?: { type: string; message: string; code: number };
}

async function fetchFreshPreview(deezerId: string): Promise<{
  previewUrl: string;
  coverUrl: string;
} | null> {
  try {
    const res = await fetch(`${DEEZER_BASE}/track/${deezerId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as DeezerTrackResponse;
    if (data.error || !data.preview) return null;
    return {
      previewUrl: data.preview,
      coverUrl: data.album?.cover_big ?? '',
    };
  } catch {
    return null;
  }
}

export const curatedDeezerProvider: ProviderClient = {
  id: 'curated-deezer',
  displayName: 'Songnado',

  async getPlaylistMeta(playlistId: string): Promise<PlaylistMeta> {
    const data = getCuratedDeezerPlaylist(playlistId);
    return {
      id: data.id,
      name: data.name,
      imageUrl: data.imageUrl,
      totalTracks: data.tracks.length,
    };
  },

  async getTrackAtIndex(playlistId: string, index: number): Promise<Song | null> {
    const data = getCuratedDeezerPlaylist(playlistId);
    const track = data.tracks[index];
    if (!track) return null;
    const fresh = await fetchFreshPreview(track.deezerId);
    if (!fresh) return null;
    return {
      title: track.title,
      artist: track.artist,
      previewUrl: fresh.previewUrl,
      coverUrl: fresh.coverUrl || data.imageUrl,
      ...(track.source ? { source: track.source } : {}),
    };
  },

  extractPlaylistId(_input: string): string {
    throw new Error(
      'Curated-Deezer playlists cannot be added by URL — they ship with the app.'
    );
  },
};
