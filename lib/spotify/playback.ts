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

import { SpotifyApiError, spotifyGet, spotifyPut } from './api';

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
 * Convenience: the device currently flagged as active, or null if none.
 * "Active" means Spotify is currently controlling that device's audio (or did
 * recently — Spotify keeps a session alive for a while after the app closes).
 */
export async function getActiveDevice(): Promise<SpotifyDevice | null> {
  const devices = await getDevices();
  return devices.find((d) => d.is_active) ?? null;
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
  const params = opts.deviceId ? `?device_id=${encodeURIComponent(opts.deviceId)}` : '';
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
 * Map a generic `SpotifyApiError` to the more specific playback error types
 * so UI can branch (show wake-up modal vs Premium-required modal vs generic).
 */
function translatePlaybackError(err: unknown): Error {
  if (!(err instanceof SpotifyApiError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  if (err.status === 404) return new NoActiveDeviceError();
  if (err.status === 403) {
    // 403 from playback endpoints almost always means non-Premium. There are
    // other 403 reasons (rate limit, restricted device) but they're rare
    // enough that this default works in practice.
    return new NotPremiumError();
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
