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
import {
  getCurrentlyPlaying,
  pausePlayback,
  playPlaylistContext,
  setShuffle,
  skipToNext,
  type CurrentlyPlayingTrack,
} from '../spotify/playback';
import type { ProviderClient } from './types';

/**
 * Sentinel "totalTracks" we apply to every Spotify playlist when listing
 * the user's library. Spotify's dev-mode restrictions strip the real
 * tracks.total field from /me/playlists AND /playlists/{id} responses
 * for non-extended-quota apps, so we genuinely cannot know the size.
 *
 * Since our Spotify gameplay uses Spotify's own playlist progression
 * (context-play + skip-next) and ignores the chosen index, this value
 * just keeps the rotation logic happy. Setting it to 100 means the
 * picker UI shows "0 / 100 played" until 100 rounds have been played
 * (essentially never in normal usage).
 */
const SPOTIFY_SENTINEL_TOTAL_TRACKS = 100;

// ----------------------------------------------------------------------------
// Spotify Web API response shapes (subset of fields we use)
// ----------------------------------------------------------------------------

interface SpotifyImage {
  url: string;
  height?: number | null;
  width?: number | null;
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
  album: SpotifyAlbum | null;
  /** Always `null` for our app per Spotify's late-2024 restriction. Kept for type fidelity. */
  preview_url: string | null;
  /** True for user-uploaded local files — these have no playable URI and must be skipped. */
  is_local: boolean;
  /**
   * Documented as 'track' | 'episode', but Spotify occasionally omits this
   * field for music tracks. We treat missing as "probably a track" rather
   * than rejecting everything.
   */
  type?: 'track' | 'episode';
}

interface SpotifyPlaylistResponse {
  id: string | null;
  name: string | null;
  // Spotify can omit or null these for collaborative / imported / region-restricted
  // playlists. We treat anything malformed as "skip" rather than crashing.
  images: SpotifyImage[] | null;
  tracks: { total: number } | null;
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

function trackToSong(track: SpotifyTrack | null | undefined): Song | null {
  if (!track) {
    console.warn('[spotify] skip: null track');
    return null;
  }
  if (track.is_local) {
    console.warn('[spotify] skip: local file', track.name);
    return null;
  }
  if (!track.uri) {
    console.warn('[spotify] skip: missing uri', track.name);
    return null;
  }
  if (track.type && track.type !== 'track') {
    console.warn('[spotify] skip: type=', track.type, track.name);
    return null;
  }
  console.warn(`[spotify] OK: ${track.name} (${track.uri})`);
  return {
    title: track.name,
    artist: formatArtists(track.artists),
    previewUrl: '', // Spotify-sourced — playback via spotifyUri, not a preview URL
    coverUrl: pickImage(track.album?.images),
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

  if (!json.id) {
    throw new SpotifyApiError('Playlist response missing ID', 0);
  }
  return {
    id: json.id,
    name: json.name ?? 'Untitled playlist',
    imageUrl: pickImage(json.images ?? undefined),
    totalTracks: json.tracks?.total ?? 0,
  };
}

/**
 * Brief delay between starting playback / skipping and reading currently-playing.
 * Spotify needs a moment to register the new track in its player state.
 * Empirically 400-700ms is reliable; we use 700 for safety margin.
 *
 * Tradeoff: this delay extends the audible "blip" of playback during preload.
 * Shorter risks reading the previous track's data; longer = more audible blip.
 */
const PRELOAD_REGISTRATION_DELAY_MS = 700;

/**
 * Module-level state: which Spotify playlist is the "active context" on the
 * user's device. Used to decide whether the next round needs a full context
 * change (PUT /me/player/play with new context_uri) or just a skip-next
 * (POST /me/player/next within the existing context).
 *
 * Reset to null when the user disconnects Spotify or starts a new game.
 */
let activeContext: string | null = null;

/** Called by spotifyStore on disconnect to clear context state. */
export function resetSpotifyContext(): void {
  activeContext = null;
}

function currentlyPlayingTrackToSong(track: CurrentlyPlayingTrack): Song | null {
  if (track.is_local) return null;
  if (!track.uri) return null;
  if (track.type && track.type !== 'track') return null;
  return {
    title: track.name,
    artist: formatArtists(track.artists),
    previewUrl: '',
    coverUrl: pickImage(track.album?.images),
    spotifyUri: track.uri,
    durationMs: track.duration_ms,
  };
}

/**
 * Fetch the next playable track from a Spotify playlist.
 *
 * **Architecture note (Path A pivot, May 27 2026)**: Spotify's Nov 2024
 * dev-mode policy strips track metadata from `/playlists/{id}` and blocks
 * `/playlists/{id}/tracks` entirely. We can't enumerate or index into a
 * playlist via the API. Instead, we use Spotify's own player to advance:
 *
 *  - **First call for a given playlist** (`activeContext` mismatch):
 *    Start playing the playlist as a context with shuffle on. Spotify picks
 *    the track. We read currently-playing to learn what it picked.
 *  - **Subsequent calls in the same playlist** (`activeContext` matches):
 *    Skip to the next track via `POST /me/player/next`. Spotify picks the
 *    next track (shuffled). We read currently-playing again.
 *
 * The `index` parameter is honored as a no-op here because the rotation
 * store still tracks it for consistency with Deezer's interface, but it
 * has no semantic meaning in this provider — Spotify owns the order.
 *
 * Each call leaves the track *paused* on the user's device. The actual
 * round-start play (with random-window seek) happens later, via
 * `playUri(song.spotifyUri, {positionMs: random})` from `usePlayer`.
 *
 * Requires an active Spotify device. Throws `NoActiveDeviceError` if not.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getTrackAtIndex(playlistId: string, _index: number): Promise<Song | null> {
  if (activeContext === playlistId) {
    // Same playlist as last round → just advance.
    await skipToNext();
  } else {
    // New playlist context. Set shuffle so progression isn't sequential,
    // then start playback. Shuffle failure is non-fatal — gameplay still
    // works without it, just less varied.
    await setShuffle(true).catch(() => {});
    await playPlaylistContext(playlistId, 0, 0);
    activeContext = playlistId;
  }

  // Give Spotify time to register the new track in its player state.
  await new Promise((r) => setTimeout(r, PRELOAD_REGISTRATION_DELAY_MS));

  // Pause so the user doesn't keep hearing the track during round setup.
  // Best-effort — if it fails (device dormant, race condition), the read
  // below still works because Spotify keeps the player state for a while.
  await pausePlayback().catch(() => {});

  const current = await getCurrentlyPlaying();
  if (!current?.item) {
    // Either 204 (no active session) or the player state didn't refresh.
    // Caller retries up to 10 times via the rotation loop.
    return null;
  }
  return currentlyPlayingTrackToSong(current.item);
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
 * Fetch the current user's saved playlists. Returns up to 50 in one call.
 *
 * **Sentinel totalTracks**: Spotify's dev-mode strips `tracks.total` from
 * playlist responses for non-extended-quota apps, so we can't know the
 * real track count. We use a sentinel value (`SPOTIFY_SENTINEL_TOTAL_TRACKS`)
 * to keep the rotation store's index logic happy; the Spotify provider
 * ignores the index anyway since it uses Spotify's own playlist progression.
 *
 * Skips malformed entries silently rather than crashing on one bad item.
 */
export async function listUserPlaylists(): Promise<PlaylistMeta[]> {
  const json = await spotifyGet<SpotifyUserPlaylistsResponse>(
    '/me/playlists?limit=50&fields=' +
      encodeURIComponent('items(id,name,images),total,next')
  );

  const metas: PlaylistMeta[] = [];
  for (const p of json.items ?? []) {
    if (!p || !p.id) continue;
    metas.push({
      id: p.id,
      name: p.name ?? 'Untitled playlist',
      imageUrl: pickImage(p.images ?? undefined),
      totalTracks: SPOTIFY_SENTINEL_TOTAL_TRACKS,
    });
  }
  return metas;
}
