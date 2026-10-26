/**
 * Apple Music provider — built-in packs played through MusicKit.
 *
 * Everything a round needs is already in the bundled pack, so this never
 * touches the network: the player hands `appleId` to MusicKit, which streams
 * from the host's own subscription. See lib/appleMusic.ts and
 * lib/curated/apple-loader.ts.
 */
import { getCuratedApplePlaylist } from '../curated/apple-loader';
import type { PlaylistMeta, Song } from '../types';
import type { ProviderClient } from './types';

export const curatedAppleProvider: ProviderClient = {
  id: 'curated-apple',
  displayName: 'Apple Music',

  async getPlaylistMeta(playlistId: string): Promise<PlaylistMeta> {
    const data = getCuratedApplePlaylist(playlistId);
    return { id: data.id, name: data.name, imageUrl: '', totalTracks: data.tracks.length };
  },

  async getTrackAtIndex(playlistId: string, index: number): Promise<Song | null> {
    const track = getCuratedApplePlaylist(playlistId).tracks[index];
    if (!track) return null;
    return {
      title: track.title,
      artist: track.artist,
      previewUrl: '',
      coverUrl: track.artworkUrl,
      appleId: track.appleId,
      durationMs: track.durationMs,
      ...(track.source ? { source: track.source } : {}),
    };
  },

  extractPlaylistId(_input: string): string {
    throw new Error('Apple Music packs ship with the app and cannot be added by URL.');
  },
};
