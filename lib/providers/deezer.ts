import type { PlaylistMeta, Song } from '../types';
import type { ProviderClient } from './types';

const BASE = 'https://api.deezer.com';

interface DeezerApiError {
  type: string;
  message: string;
  code: number;
}

interface DeezerPlaylistResponse {
  id?: number;
  title?: string;
  picture_big?: string;
  nb_tracks?: number;
  error?: DeezerApiError;
}

interface DeezerTrack {
  title: string;
  title_short: string;
  preview: string | null;
  artist: { name: string };
  album: { cover_big: string; cover_medium?: string };
}

interface DeezerTracksResponse {
  data?: DeezerTrack[];
  total?: number;
  error?: DeezerApiError;
}

export class DeezerError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'DeezerError';
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new DeezerError(`HTTP ${res.status} for ${path}`, res.status);
  }
  const json = (await res.json()) as T & { error?: DeezerApiError };
  if (json.error) {
    throw new DeezerError(json.error.message, json.error.code);
  }
  return json;
}

function extractPlaylistId(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/playlist\/(\d+)/);
  if (match) return match[1];
  throw new DeezerError(`Could not extract a Deezer playlist ID from "${input}"`);
}

async function getPlaylistMeta(playlistId: string): Promise<PlaylistMeta> {
  const json = await request<DeezerPlaylistResponse>(`/playlist/${playlistId}?limit=1`);
  if (!json.id || !json.title || json.nb_tracks == null) {
    throw new DeezerError('Playlist response missing expected fields');
  }
  return {
    id: String(json.id),
    name: json.title,
    imageUrl: json.picture_big ?? '',
    totalTracks: json.nb_tracks,
  };
}

async function getTrackAtIndex(
  playlistId: string,
  index: number
): Promise<Song | null> {
  const json = await request<DeezerTracksResponse>(
    `/playlist/${playlistId}/tracks?index=${index}&limit=1`
  );
  const track = json.data?.[0];
  if (!track || !track.preview) return null;
  return {
    title: track.title_short || track.title,
    artist: track.artist.name,
    previewUrl: track.preview,
    coverUrl: track.album.cover_big,
  };
}

export const deezerProvider: ProviderClient = {
  id: 'deezer',
  displayName: 'Deezer',
  getPlaylistMeta,
  getTrackAtIndex,
  extractPlaylistId,
};
