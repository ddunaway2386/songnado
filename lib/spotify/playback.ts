/**
 * Spotify Connect playback control.
 *
 * Playback runs on the user's Spotify device (their phone, a speaker, etc.) —
 * this app sends commands via the Web API to control it. We never receive
 * audio data; we're effectively a remote control over their Premium account.
 *
 * Two failure modes the UI must handle:
 *  - **No active device:** Spotify returns 404 when the user hasn't opened
 *    their Spotify app since their last system reboot (or it was killed).
 *    Solution: show a one-time "open Spotify briefly, then come back" modal.
 *  - **Not Premium:** 403. We pre-detect this via `getCurrentUser().product`
 *    in `spotifyStore`, but this is defense-in-depth in case the user's
 *    subscription lapses mid-session.
 */

import { Linking } from 'react-native';

import {
  SpotifyApiError,
  spotifyGet,
  spotifyGetMaybe,
  spotifyPost,
  spotifyPut,
} from './api';

// ----------------------------------------------------------------------------
// Wake-needed signal — bridges withDeviceRecovery → spotifyStore without a
// circular import. spotifyStore registers a handler at module-load time;
// the recovery code calls signalWakeNeeded() when dormancy is unrecoverable.
// ----------------------------------------------------------------------------

let onWakeNeeded: (() => void) | null = null;
export function setWakeNeededHandler(handler: () => void): void {
  onWakeNeeded = handler;
}
function signalWakeNeeded(): void {
  try {
    onWakeNeeded?.();
  } catch {
    /* never let UI signalling break the playback flow */
  }
}

// ----------------------------------------------------------------------------
// Currently-playing — used by the "preload" pattern in providers/spotify.ts
// to learn what track Spotify selected for a given playlist+offset.
//
// Necessary because Spotify's Nov 2024 dev-mode restrictions block
// GET /playlists/{id}/tracks for new dev apps, but /me/player/currently-playing
// is unrestricted.
// ----------------------------------------------------------------------------

export interface CurrentlyPlayingTrack {
  uri: string;
  id: string;
  name: string;
  duration_ms: number;
  is_local: boolean;
  type: 'track' | 'episode';
  artists: { id: string; name: string }[];
  album: { name: string; images: { url: string }[] };
}

export interface CurrentlyPlayingResponse {
  is_playing: boolean;
  progress_ms: number | null;
  item: CurrentlyPlayingTrack | null;
  currently_playing_type: 'track' | 'episode' | 'ad' | 'unknown';
}

/**
 * GET /v1/me/player/currently-playing
 * Returns null when Spotify says 204 (nothing playing). Item can also be
 * null inside a 200 response if a non-track (ad, episode) is playing — caller
 * is responsible for that distinction.
 */
export async function getCurrentlyPlaying(): Promise<CurrentlyPlayingResponse | null> {
  return spotifyGetMaybe<CurrentlyPlayingResponse>('/me/player/currently-playing');
}

/**
 * PUT /v1/me/player/play with a playlist context. Starts playing the
 * playlist at the specified track index, optionally at a specific position
 * within that track.
 *
 * This is the building block of the "preload" pattern that replaces the
 * blocked GET /playlists/{id}/tracks endpoint.
 */
export async function playPlaylistContext(
  playlistId: string,
  offsetIndex: number,
  positionMs = 0,
  deviceId?: string
): Promise<void> {
  const params = deviceParam(deviceId);
  const body = {
    context_uri: `spotify:playlist:${playlistId}`,
    offset: { position: offsetIndex },
    position_ms: Math.max(0, Math.floor(positionMs)),
  };
  try {
    await spotifyPut(`/me/player/play${params}`, body);
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

/**
 * PUT /v1/me/player/play with {context_uri, offset:{uri}, position_ms} —
 * play a specific track within a playlist at a specific position.
 *
 * Why this exists (vs. playUri or seek+resume):
 *   - `playUri(trackUri, {positionMs})` sends `{uris:[uri], position_ms}`,
 *     which Spotify treats as URI-only mode and clears the playlist queue.
 *     skipToNext on the next round then has no queue to advance through
 *     ("every round plays the same song").
 *   - `seek(N)` + `resumePlayback()` on a paused player returns 403
 *     "Restriction violated" — Spotify rejects seek without active playback.
 *   - `resumePlayback({positionMs})` (i.e. /play with just `{position_ms}`)
 *     also returns 403 "Restriction violated" — the API requires
 *     context_uri or uris when position_ms is provided.
 *
 * This shape — context_uri + offset.uri + position_ms — works because it's
 * a complete, valid play command: it tells Spotify exactly which playlist,
 * which track within it, and at what position. The playlist queue stays
 * alive, so the next round's skipToNext advances normally.
 */
export async function playTrackInContext(
  playlistId: string,
  trackUri: string,
  positionMs: number,
  deviceId?: string
): Promise<void> {
  const params = deviceParam(deviceId);
  const body = {
    context_uri: `spotify:playlist:${playlistId}`,
    offset: { uri: trackUri },
    position_ms: Math.max(0, Math.floor(positionMs)),
  };
  try {
    await spotifyPut(`/me/player/play${params}`, body);
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

export class NoActiveDeviceError extends SpotifyApiError {
  constructor() {
    super(
      'No active Spotify device. Open Spotify on your phone, play any song briefly, then come back.',
      404,
      'no_active_device'
    );
    this.name = 'NoActiveDeviceError';
  }
}

export class NotPremiumError extends SpotifyApiError {
  constructor() {
    super('Spotify Premium is required for playback.', 403, 'not_premium');
    this.name = 'NotPremiumError';
  }
}

// ----------------------------------------------------------------------------
// Devices
// ----------------------------------------------------------------------------

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  is_private_session: boolean;
  volume_percent: number | null;
}

interface DevicesResponse {
  devices: SpotifyDevice[];
}

/**
 * GET /v1/me/player/devices — all devices the user has signed into Spotify on.
 * Useful for diagnostics and for the "wake up Spotify" modal flow.
 */
export async function getDevices(): Promise<SpotifyDevice[]> {
  const json = await spotifyGet<DevicesResponse>('/me/player/devices');
  return json.devices;
}

/**
 * PUT /v1/me/player — transfer playback to a specific device.
 *
 * Used as a "wake up" mechanism: if the user's phone goes dormant
 * (iOS suspends Spotify after our app pauses it), calls to play/pause/next
 * start returning 502 Bad Gateway. Transferring playback explicitly to the
 * device forces Spotify's session manager to re-establish the connection.
 *
 * @param deviceId the target device's Spotify ID
 * @param play if true, start playing on transfer; if false, transfer paused
 */
export async function transferPlayback(deviceId: string, play = false): Promise<void> {
  try {
    await spotifyPut('/me/player', { device_ids: [deviceId], play });
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

// ----------------------------------------------------------------------------
// Device-wake recovery — generic wrapper to retry a playback API call after
// re-establishing the Spotify Connect session via transferPlayback.
// ----------------------------------------------------------------------------

function isDormantError(err: unknown): boolean {
  if (!(err instanceof SpotifyApiError)) return false;
  return err.status === 502 || err.status === 404 || err.status === 500;
}

/**
 * Module-level cache of the user's Smartphone device ID. Populated on first
 * lookup (e.g. during the first round's preload), reused for all subsequent
 * playback commands. Cleared on disconnect.
 *
 * Why a cache: without explicitly targeting the phone, Spotify's "active
 * device" can drift to other signed-in devices (notably Web Player sessions
 * left over from browser-based testing). Once playback routes there, the
 * user's phone hears nothing. Every playback call passes this ID explicitly
 * to lock the target.
 */
let cachedSmartphoneId: string | null = null;

/**
 * Find the user's Smartphone device. **Strictly Smartphone-only** — we
 * deliberately do NOT fall back to other device types because falling back
 * to a Web Player or Computer would route audio away from the user's phone.
 * If no smartphone is in the device list, returns null and the caller surfaces
 * a "wake up Spotify on your phone" error.
 */
async function findSmartphone(): Promise<string | null> {
  // Trust the cache if we have it — avoids an API call per operation.
  if (cachedSmartphoneId) return cachedSmartphoneId;
  const devices = await getDevices().catch(() => []);
  const phone = devices.find((d) => d.id && d.type === 'Smartphone');
  if (phone?.id) {
    cachedSmartphoneId = phone.id;
    return phone.id;
  }
  return null;
}

/** Clear the cached device ID. Called on Spotify disconnect. */
export function clearCachedDevice(): void {
  cachedSmartphoneId = null;
}

/**
 * Eagerly populate the smartphone device cache. Called from `spotifyStore`
 * at connect/restore time so the first round's playback doesn't have to
 * wait for an in-flight recovery to discover the device.
 *
 * Returns the device ID if found, null otherwise. Failure is non-fatal —
 * lazy lookup via `withDeviceRecovery` will catch it later.
 */
export async function prefetchSmartphoneDevice(): Promise<string | null> {
  return findSmartphone();
}

/**
 * Resolve an effective device ID for a playback call: caller-provided takes
 * precedence, then the cached smartphone ID. May return undefined if neither
 * is available — caller can decide whether to proceed or error.
 */
function resolveDeviceId(deviceId: string | undefined): string | undefined {
  return deviceId ?? cachedSmartphoneId ?? undefined;
}

function deviceParam(deviceId: string | undefined): string {
  const id = resolveDeviceId(deviceId);
  return id ? `?device_id=${encodeURIComponent(id)}` : '';
}

/**
 * Wrap a Spotify playback API call with automatic device-wake recovery.
 * On 500/502/404 from iOS-induced dormancy: list devices, find the phone,
 * transfer playback to it with `play: true` (the aggressive variant that
 * forces audio resumption + an OS-level wake), wait, then retry once.
 *
 * Use this around any low-level playback call where dormancy is possible:
 * playUri, resumePlayback, skipToNext, pausePlayback, setShuffle, etc.
 */
export async function withDeviceRecovery<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isDormantError(err)) throw err;
    const deviceId = await findSmartphone().catch(() => null);
    if (!deviceId) {
      signalWakeNeeded();
      throw new SpotifyApiError(
        'Spotify needs a wake-up. Open Spotify on your phone, play any song for a few seconds, then come back.',
        503,
        'dormant_no_device'
      );
    }
    try {
      await transferPlayback(deviceId, true);
    } catch {
      signalWakeNeeded();
      throw new SpotifyApiError(
        'Spotify needs a wake-up. Open Spotify on your phone, play any song for a few seconds, then come back.',
        503,
        'dormant_transfer_failed'
      );
    }
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await fn();
    } catch {
      signalWakeNeeded();
      throw new SpotifyApiError(
        'Spotify connection still asleep. Open Spotify, tap play on any song, then return to Songnado.',
        503,
        'dormant_retry_failed'
      );
    }
  }
}

/**
 * Convenience: the device currently flagged as active, or null if none.
 * "Active" means Spotify is currently controlling that device's audio (or did
 * recently — Spotify keeps a session alive for a while after the app closes).
 */
export async function getActiveDevice(): Promise<SpotifyDevice | null> {
  const devices = await getDevices();
  return devices.find((d) => d.is_active) ?? null;
}

/**
 * Lightweight, non-throwing check for whether Spotify currently has an active
 * device. Used by the pre-game wake-up flow: if false, we surface the
 * "Open Spotify" deep-link banner *before* trying any playback command
 * (which would otherwise fail with 502/404 and require auto-recovery).
 *
 * This is the canonical pattern per Spotify's own iOS application-lifecycle
 * guidance: detect disconnection up-front and prompt the user to open Spotify.
 */
export async function hasActiveDevice(): Promise<boolean> {
  try {
    const devices = await getDevices();
    return devices.some((d) => d.is_active && d.id);
  } catch {
    return false;
  }
}

/**
 * Deep-link into the Spotify iOS/Android app via the `spotify://` URI scheme.
 * This is the documented way to ask the OS to bring Spotify to the foreground
 * — once Spotify is foregrounded and the user taps play (or it auto-resumes),
 * a Connect device becomes active and our Web API commands work again.
 *
 * Returns true on successful launch, false if Spotify isn't installed or the
 * URL can't be opened. Caller should handle false with an install prompt.
 */
export async function openSpotifyApp(): Promise<boolean> {
  const url = 'spotify://';
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Playback control
// ----------------------------------------------------------------------------

export interface PlayOptions {
  /** Start playback this many ms into the track. Default 0. */
  positionMs?: number;
  /** Target a specific device. Default = currently active device. */
  deviceId?: string;
}

/**
 * Start playing a single track. Throws `NoActiveDeviceError` if Spotify has
 * no active device — callers should catch and show the wake-up modal.
 *
 * Note: this is fire-and-forget from our side. Spotify's playback runs
 * independently on the user's device; we don't get progress callbacks.
 * The caller is responsible for tracking elapsed time (e.g. via a timer)
 * and calling `pausePlayback()` when the 30s window expires.
 */
export async function playUri(uri: string, opts: PlayOptions = {}): Promise<void> {
  const params = deviceParam(opts.deviceId);
  const body: Record<string, unknown> = { uris: [uri] };
  if (opts.positionMs && opts.positionMs > 0) {
    body.position_ms = Math.floor(opts.positionMs);
  }
  try {
    await spotifyPut(`/me/player/play${params}`, body);
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

/**
 * PUT /v1/me/player/play with no body — resumes the currently-paused
 * track at whatever position it was paused at. Used after a hard stop
 * to implement the pause/resume toggle behavior.
 */
export async function resumePlayback(
  opts: { positionMs?: number; deviceId?: string } = {}
): Promise<void> {
  const params = deviceParam(opts.deviceId);
  const body: Record<string, unknown> | undefined =
    opts.positionMs != null && opts.positionMs >= 0
      ? { position_ms: Math.floor(opts.positionMs) }
      : undefined;
  try {
    await spotifyPut(`/me/player/play${params}`, body);
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

export async function pausePlayback(deviceId?: string): Promise<void> {
  const params = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  try {
    await spotifyPut(`/me/player/pause${params}`);
  } catch (err) {
    // Pause is best-effort. If Spotify says "already paused" (a 403 in some
    // states) we don't want to crash the game loop — swallow non-fatal cases.
    if (err instanceof SpotifyApiError && err.status === 403) {
      return; // Already paused or no active session; treat as success.
    }
    throw translatePlaybackError(err);
  }
}

/**
 * PUT /v1/me/player/seek?position_ms=N — seek to a position within the
 * currently-playing track. Preserves Spotify's playback context (queue),
 * unlike playUri which switches to URI-only mode and clears the queue.
 *
 * **Critical for skipToNext** to work in subsequent rounds: if we use
 * playUri to jump to a random window, Spotify forgets the playlist
 * context and skipToNext has no queue to advance through (which manifests
 * as "every round plays the same song"). Seek leaves the context intact.
 */
export async function seek(positionMs: number, deviceId?: string): Promise<void> {
  const params = new URLSearchParams({
    position_ms: String(Math.max(0, Math.floor(positionMs))),
  });
  const id = resolveDeviceId(deviceId);
  if (id) params.set('device_id', id);
  try {
    await spotifyPut(`/me/player/seek?${params.toString()}`);
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

/**
 * POST /v1/me/player/next — advance to the next track in the current
 * playback context. Used by the shuffle-and-next gameplay pattern that
 * works around Spotify's dev-mode block on /tracks: we let Spotify
 * pick what plays next from the playlist instead of choosing an index.
 *
 * Spotify uses POST for this endpoint (most player controls are PUT but
 * "next" and "previous" are POST). Returns 204 No Content on success.
 */
export async function skipToNext(deviceId?: string): Promise<void> {
  const params = deviceParam(deviceId);
  try {
    await spotifyPost(`/me/player/next${params}`);
  } catch (err) {
    throw translatePlaybackError(err);
  }
}

/**
 * PUT /v1/me/player/shuffle?state=true|false — turn shuffle on/off on the
 * active device. Set true at the start of a Spotify-backed game so each
 * `skipToNext` actually picks a varied track rather than just the literal
 * next track in playlist order.
 */
export async function setShuffle(state: boolean, deviceId?: string): Promise<void> {
  const params = new URLSearchParams({ state: String(state) });
  const id = resolveDeviceId(deviceId);
  if (id) params.set('device_id', id);
  try {
    await spotifyPut(`/me/player/shuffle?${params.toString()}`);
  } catch (err) {
    // Shuffle is nice-to-have; if it fails, gameplay still works.
    if (err instanceof SpotifyApiError && (err.status === 403 || err.status === 404)) {
      return;
    }
    throw translatePlaybackError(err);
  }
}

/**
 * PUT /v1/me/player/repeat?state=track|context|off — set the device's
 * repeat mode.
 *
 * **Critical**: we set this to `'off'` at game start. If the user happens
 * to have repeat-track mode on (very common — easy to enable accidentally
 * in Spotify), `skipToNext` succeeds but stays on the SAME track every
 * time, which manifests in Songnado as "next round plays the same song."
 */
export async function setRepeat(
  state: 'track' | 'context' | 'off',
  deviceId?: string
): Promise<void> {
  const params = new URLSearchParams({ state });
  const id = resolveDeviceId(deviceId);
  if (id) params.set('device_id', id);
  try {
    await spotifyPut(`/me/player/repeat?${params.toString()}`);
  } catch (err) {
    // Repeat-mode is nice-to-have; non-fatal if it fails.
    if (err instanceof SpotifyApiError && (err.status === 403 || err.status === 404)) {
      return;
    }
    throw translatePlaybackError(err);
  }
}

// ----------------------------------------------------------------------------
// Volume control — the centerpiece of our "silence instead of pause" strategy.
//
// Background: iOS deprioritizes / suspends backgrounded apps when they stop
// outputting audio. Calling pausePlayback() therefore causes Spotify to be
// suspended within seconds, breaking subsequent Web API commands with 502/500.
//
// Workaround: keep Spotify *playing* between rounds, just at volume 0. Audio
// frames are still produced by Spotify and consumed by iOS's audio system, so
// iOS keeps the app responsive. When the next round starts, we restore the
// volume and seek to the next round's random position.
// ----------------------------------------------------------------------------

/** Last captured volume so we can restore after silencing. */
let lastUserVolume = 75;

/**
 * PUT /v1/me/player/volume?volume_percent=N
 * Sets the Spotify Connect device's playback volume (0-100). This is a
 * software volume separate from the iPhone's hardware volume — changing it
 * affects only Spotify's output level on that device session.
 */
export async function setVolume(percent: number, deviceId?: string): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.floor(percent)));
  const params = new URLSearchParams({ volume_percent: String(clamped) });
  const id = resolveDeviceId(deviceId);
  if (id) params.set('device_id', id);
  try {
    await spotifyPut(`/me/player/volume?${params.toString()}`);
  } catch (err) {
    if (err instanceof SpotifyApiError && (err.status === 403 || err.status === 404)) {
      return; // volume changes are non-fatal
    }
    throw translatePlaybackError(err);
  }
}

/**
 * Capture the user's current Spotify volume and silence the device.
 * Use anywhere we would have called pausePlayback() between rounds.
 *
 * Audio continues playing (at volume 0) so iOS keeps Spotify alive.
 * The captured volume is restored via `restoreVolume()` when the next
 * round begins.
 */
export async function silenceAndRemember(): Promise<void> {
  try {
    const devices = await getDevices();
    const active = devices.find((d) => d.is_active);
    // Only update lastUserVolume if we got a non-zero reading; if the user
    // already silenced (we did it on a prior call), keep the older value.
    if (active?.volume_percent != null && active.volume_percent > 0) {
      lastUserVolume = active.volume_percent;
    }
  } catch {
    // Use last-known value as fallback.
  }
  await setVolume(0).catch(() => {});
}

/**
 * Restore the volume captured by the most recent `silenceAndRemember()`.
 * Use when the next round begins audible playback.
 */
export async function restoreVolume(): Promise<void> {
  await setVolume(lastUserVolume).catch(() => {});
}

/**
 * Map a generic `SpotifyApiError` to the more specific playback error types
 * so UI can branch (show wake-up modal vs Premium-required modal vs generic).
 */
function translatePlaybackError(err: unknown): Error {
  if (!(err instanceof SpotifyApiError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  // Diagnostic: print the raw status + reason so we can see what Spotify is
  // actually saying (vs. our error-bucket guess). Temporary; remove after
  // the not-premium-misreport mystery is fully resolved.
  console.log('[spotify-err]', {
    status: err.status,
    reason: err.reason,
    message: err.message,
  });
  if (err.status === 404) return new NoActiveDeviceError();
  if (err.status === 403) {
    // Only PREMIUM_REQUIRED is actually a Premium issue. Spotify uses 403
    // for many PLAYER_COMMAND_FAILED reasons (NO_PREV_TRACK, NOT_PAUSED,
    // DEVICE_NOT_CONTROLLABLE, UNKNOWN, ...) — bucketing all of those as
    // NotPremiumError caused the bug where the user's Premium account
    // was misdiagnosed as Free on every play attempt. Pass non-Premium
    // 403s through as-is so the UI shows the actual Spotify message and
    // we can debug what's really going wrong.
    if (err.reason === 'PREMIUM_REQUIRED') return new NotPremiumError();
  }
  return err;
}

// ----------------------------------------------------------------------------
// Random-window math (for the gameplay upgrade)
// ----------------------------------------------------------------------------

const PREVIEW_WINDOW_MS = 30_000;
/** Buffer to avoid starting playback so close to the end that we run out. */
const END_SAFETY_MS = 1_000;

/**
 * Pick a random `positionMs` so a 30-second window fits entirely within the
 * track. Returns 0 for tracks shorter than 30s (start from the beginning).
 *
 * This is the gameplay upgrade Spotify enables over Deezer's fixed 0-30s
 * preview: chorus is much more likely to surface than the intro.
 */
export function pickRandomStartMs(durationMs: number): number {
  const maxStart = durationMs - PREVIEW_WINDOW_MS - END_SAFETY_MS;
  if (maxStart <= 0) return 0;
  return Math.floor(Math.random() * maxStart);
}
