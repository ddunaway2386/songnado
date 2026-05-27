/**
 * Spotify music provider.
 *
 * Implements `ProviderClient` so the rest of the app can read Spotify
 * playlists the same way it reads Deezer ones. Playback is NOT this
 * module's concern — that's the unified `Player` interface (Phase C.3/C.5).
 *
 * All endpoints require an authenticated session (see `lib/spotify/auth.ts`
 * + `stores/spotifyStore.ts`). Calling these without a connection throws
 * `SpotifyApiError`s with HTTP 401.
 */

import type { PlaylistMeta, Song } from '../types';
import { SpotifyApiError, spotifyGet } from '../spotify/api';
import type { ProviderClient } from './types';

// ----------------------------------------------------------------------------
// Spotify Web API response shapes (subset of fields we use)
// ----------------------------------------------------------------------------

interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

interface SpotifyArtist {
  id: string;
  name: string;
}

interface SpotifyAlbum {
  name: string;
  images: SpotifyImage[];
}

interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  /** Always `null` for our app per Spotify's late-2024 restriction. Kept for type fidelity. */
  preview_url: string | null;
  /** True for user-uploaded local files — these have no playable URI and must be skipped. */
  is_local: boolean;
  /** Usually "track"; episodes (podcasts) show up in some playlists and we must skip them. */
  type: 'track' | 'episode';
}

interface SpotifyPlaylistResponse {
  id: string;
  name: string;
  images: SpotifyImage[];
  tracks: { total: number };
}

interface SpotifyPlaylistTracksResponse {
  items: { track: SpotifyTrack | null }[];
  total: number;
  offset: number;
  limit: number;
}

interface SpotifyUserPlaylistsResponse {
  items: SpotifyPlaylistResponse[];
  total: number;
  next: string | null;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Spotify IDs are base62, typically 22 chars. We're lenient on length —
 * Spotify hasn't published a hard limit and historical IDs have varied.
 */
const SPOTIFY_ID_PATTERN = /^[a-zA-Z0-9]+$/;

function pickImage(images: SpotifyImage[] | undefined): string {
  if (!images || images.length === 0) return '';
  // Spotify returns images largest-first. images[0] is highest resolution.
  return images[0].url;
}

function formatArtists(artists: SpotifyArtist[]): string {
  if (!artists || artists.length === 0) return 'Unknown artist';
  return artists.map((a) => a.name).join(', ');
}

function trackToSong(track: SpotifyTrack): Song | null {
  // Skip non-playable items: local files (no URI), episodes (podcasts), and
  // anything that lost its track data (Spotify nulls these for removed/region-locked tracks).
  if (track.is_local || track.type !== 'track' || !track.uri) {
    return null;
  }
  return {
    title: track.name,
    artist: formatArtists(track.artists),
    previewUrl: '', // Spotify-sourced — playback via spotifyUri, not a preview URL
    coverUrl: pickImage(track.album.images),
    spotifyUri: track.uri,
    durationMs: track.duration_ms,
  };
}

// ----------------------------------------------------------------------------
// ProviderClient implementation
// ----------------------------------------------------------------------------

function extractPlaylistId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new SpotifyApiError('Empty input — paste a Spotify playlist link or ID', 0);
  }

  // Bare ID: alphanumeric only, no slashes/colons
  if (SPOTIFY_ID_PATTERN.test(trimmed) && !trimmed.includes('/') && !trimmed.includes(':')) {
    return trimmed;
  }

  // URI format: spotify:playlist:XYZ
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];

  // URL formats:
  //   https://open.spotify.com/playlist/XYZ
  //   https://open.spotify.com/playlist/XYZ?si=...
  //   https://open.spotify.com/intl-es/playlist/XYZ  (localized variants)
  const urlMatch = trimmed.match(/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  throw new SpotifyApiError(
    `Could not extract a Spotify playlist ID from "${input}"`,
    0
  );
}

async function getPlaylistMeta(playlistId: string): Promise<PlaylistMeta> {
  // Request only the fields we need — saves bandwidth and dodges any field
  // changes Spotify might make to other parts of the playlist response.
  const fields = 'id,name,images,tracks(total)';
  const json = await spotifyGet<SpotifyPlaylistResponse>(
    `/playlists/${encodeURIComponent(playlistId)}?fields=${encodeURIComponent(fields)}`
  );

  return {
    id: json.id,
    name: json.name,
    imageUrl: pickImage(json.images),
    totalTracks: json.tracks.total,
  };
}

async function getTrackAtIndex(
  playlistId: string,
  index: number
): Promise<Song | null> {
  const fields =
    'items(track(id,name,uri,duration_ms,is_local,type,artists(id,name),album(name,images)))';
  const json = await spotifyGet<SpotifyPlaylistTracksResponse>(
    `/playlists/${encodeURIComponent(playlistId)}/tracks` +
      `?offset=${index}&limit=1&fields=${encodeURIComponent(fields)}`
  );

  const item = json.items?.[0];
  if (!item || !item.track) return null; // out of range, or track removed
  return trackToSong(item.track);
}

export const spotifyProvider: ProviderClient = {
  id: 'spotify',
  displayName: 'Spotify',
  getPlaylistMeta,
  getTrackAtIndex,
  extractPlaylistId,
};

// ----------------------------------------------------------------------------
// Extra: the user's own library (not part of ProviderClient — Deezer has
// no equivalent since it's unauthenticated).
// ----------------------------------------------------------------------------

/**
 * Fetch the current user's saved playlists. Returns up to 50 in one call;
 * pagination support is a follow-up (Spotify caps to 50/request, and the
 * total comes back in `.total` so we can detect when to paginate).
 *
 * Used by the setup screen to populate "Your Spotify Playlists" once the
 * user connects (Phase C.4).
 */
export async function listUserPlaylists(): Promise<PlaylistMeta[]> {
  const json = await spotifyGet<SpotifyUserPlaylistsResponse>(
    '/me/playlists?limit=50'
  );

  return json.items.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: pickImage(p.images),
    totalTracks: p.tracks.total,
  }));
}
