/**
 * Unified audio-player hook for the game loop.
 *
 * The game screen doesn't care whether a track comes from Deezer (30s
 * preview MP3 over the wire) or Spotify (full track via Spotify Connect on
 * the user's device). It just wants: `play(song)`, `pause()`, and a status
 * with `playing`/`currentTime`/`didJustFinish`/`isLoaded`/`isBuffering`.
 *
 * This hook branches on the `Song` shape:
 *  - `previewUrl` set → Deezer path. Uses `expo-audio` directly; status
 *    comes from `useAudioPlayerStatus`. `didJustFinish` fires naturally
 *    when the 30s preview ends.
 *  - `spotifyUri` set → Spotify path. Calls `playUri()` on the Spotify
 *    Connect endpoint, schedules a local `setTimeout` to pause at +30s,
 *    and ticks `currentTime` via an interval. `didJustFinish` fires when
 *    the timer elapses.
 *
 * If both fields are unset (shouldn't happen), `play()` throws.
 *
 * Phase C.3 milestone: this replaces the direct `useAudioPlayer` usage in
 * `app/game.tsx`. Callers swap one hook for another, signature compatible.
 */

import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PREVIEW_DURATION_S } from '@/lib/scoring';
import {
  NoActiveDeviceError,
  NotPremiumError,
  pausePlayback,
  pickRandomStartMs,
  playUri,
} from '@/lib/spotify/playback';
import type { Song } from '@/lib/types';

const PREVIEW_DURATION_MS = PREVIEW_DURATION_S * 1000;
const SPOTIFY_TICK_MS = 250;

export type PlayerErrorReason =
  | 'no_active_device'
  | 'not_premium'
  | 'network'
  | 'unknown';

export interface PlayerError {
  reason: PlayerErrorReason;
  message: string;
}

export interface PlayerStatus {
  playing: boolean;
  isLoaded: boolean;
  isBuffering: boolean;
  /** Seconds elapsed in the current 30s window, capped at 30. */
  currentTime: number;
  /** True for one frame when the 30s window ends naturally. */
  didJustFinish: boolean;
  /** Set when playback fails in a way the UI should react to. */
  error: PlayerError | null;
}

export interface PlayerControls {
  /** Load + start a song. Resolves once playback has begun (or errored). */
  play: (song: Song) => Promise<void>;
  /** Stop playback. Safe to call multiple times. */
  pause: () => Promise<void>;
  /** Dismiss the current error without retrying. */
  clearError: () => void;
}

export function usePlayer(): [PlayerStatus, PlayerControls] {
  // --- Deezer (expo-audio) ---
  const deezerPlayer = useAudioPlayer(null);
  const deezerStatus = useAudioPlayerStatus(deezerPlayer);

  // --- Spotify (remote, local timer) ---
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);
  const [spotifyStartedAt, setSpotifyStartedAt] = useState<number | null>(null);
  // Tick state isn't read — its update via setInterval is what triggers the
  // re-renders needed to refresh the wall-clock-derived `currentTime` below.
  const [, setSpotifyTick] = useState(0);
  const [spotifyJustFinished, setSpotifyJustFinished] = useState(false);
  const spotifyPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spotifyTickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Shared ---
  const [activeProvider, setActiveProvider] = useState<'deezer' | 'spotify' | null>(
    null
  );
  const [error, setError] = useState<PlayerError | null>(null);

  // Cleanup all timers + intervals on unmount.
  useEffect(() => {
    return () => {
      if (spotifyPauseTimerRef.current) clearTimeout(spotifyPauseTimerRef.current);
      if (spotifyTickIntervalRef.current) clearInterval(spotifyTickIntervalRef.current);
    };
  }, []);

  // Reset the one-shot `didJustFinish` flag the frame after it fires.
  useEffect(() => {
    if (spotifyJustFinished) {
      const id = setTimeout(() => setSpotifyJustFinished(false), 0);
      return () => clearTimeout(id);
    }
  }, [spotifyJustFinished]);

  const stopSpotifyTimers = useCallback(() => {
    if (spotifyPauseTimerRef.current) {
      clearTimeout(spotifyPauseTimerRef.current);
      spotifyPauseTimerRef.current = null;
    }
    if (spotifyTickIntervalRef.current) {
      clearInterval(spotifyTickIntervalRef.current);
      spotifyTickIntervalRef.current = null;
    }
  }, []);

  const play = useCallback(
    async (song: Song) => {
      setError(null);
      setSpotifyJustFinished(false);

      // --- Spotify path ---
      if (song.spotifyUri) {
        // If Deezer was active, kill its audio first.
        if (activeProvider === 'deezer') {
          deezerPlayer.pause();
        }
        setActiveProvider('spotify');

        const startMs = pickRandomStartMs(song.durationMs ?? PREVIEW_DURATION_MS);
        try {
          await playUri(song.spotifyUri, { positionMs: startMs });
        } catch (err) {
          stopSpotifyTimers();
          setSpotifyPlaying(false);
          setSpotifyStartedAt(null);
          setError(playerErrorFromException(err));
          return;
        }

        // Start the local "is playing" state + 30s pause timer + tick interval.
        const now = Date.now();
        setSpotifyStartedAt(now);
        setSpotifyPlaying(true);
        setSpotifyTick(0);

        stopSpotifyTimers();
        spotifyPauseTimerRef.current = setTimeout(() => {
          // Natural end of the 30s window.
          spotifyPauseTimerRef.current = null;
          void pausePlayback().catch(() => {
            /* swallow — already done playing for game purposes */
          });
          setSpotifyPlaying(false);
          setSpotifyJustFinished(true);
          if (spotifyTickIntervalRef.current) {
            clearInterval(spotifyTickIntervalRef.current);
            spotifyTickIntervalRef.current = null;
          }
        }, PREVIEW_DURATION_MS);

        spotifyTickIntervalRef.current = setInterval(() => {
          setSpotifyTick((t) => t + 1);
        }, SPOTIFY_TICK_MS);
        return;
      }

      // --- Deezer path ---
      if (song.previewUrl) {
        // If Spotify was active, stop its playback + cleanup timers.
        if (activeProvider === 'spotify') {
          stopSpotifyTimers();
          setSpotifyPlaying(false);
          setSpotifyStartedAt(null);
          void pausePlayback().catch(() => {});
        }
        setActiveProvider('deezer');

        deezerPlayer.replace(song.previewUrl);
        deezerPlayer.seekTo(0);
        deezerPlayer.play();
        return;
      }

      // Neither field set — track is malformed.
      setError({
        reason: 'unknown',
        message: 'Track has no playable source (missing previewUrl and spotifyUri).',
      });
    },
    [activeProvider, deezerPlayer, stopSpotifyTimers]
  );

  const pause = useCallback(async () => {
    if (activeProvider === 'deezer') {
      deezerPlayer.pause();
      return;
    }
    if (activeProvider === 'spotify') {
      stopSpotifyTimers();
      setSpotifyPlaying(false);
      try {
        await pausePlayback();
      } catch (err) {
        setError(playerErrorFromException(err));
      }
    }
  }, [activeProvider, deezerPlayer, stopSpotifyTimers]);

  const clearError = useCallback(() => setError(null), []);

  // Compose the unified status from whichever provider is active.
  const status: PlayerStatus = (() => {
    if (activeProvider === 'spotify') {
      const elapsed = spotifyStartedAt
        ? Math.min(
            PREVIEW_DURATION_S,
            Math.floor((Date.now() - spotifyStartedAt) / 1000)
          )
        : 0;
      return {
        playing: spotifyPlaying,
        isLoaded: spotifyStartedAt !== null,
        isBuffering: false, // we can't observe Spotify's buffer state from here
        currentTime: elapsed,
        didJustFinish: spotifyJustFinished,
        error,
      };
    }
    // Default to Deezer status (handles both 'deezer' active and the
    // initial-mount state when nothing has played yet).
    return {
      playing: deezerStatus.playing ?? false,
      isLoaded: deezerStatus.isLoaded ?? false,
      isBuffering: deezerStatus.isBuffering ?? false,
      currentTime: Math.min(
        PREVIEW_DURATION_S,
        Math.floor(deezerStatus.currentTime ?? 0)
      ),
      didJustFinish: deezerStatus.didJustFinish ?? false,
      error,
    };
  })();

  return [status, { play, pause, clearError }];
}

function playerErrorFromException(err: unknown): PlayerError {
  if (err instanceof NoActiveDeviceError) {
    return { reason: 'no_active_device', message: err.message };
  }
  if (err instanceof NotPremiumError) {
    return { reason: 'not_premium', message: err.message };
  }
  if (err instanceof Error) {
    return { reason: 'unknown', message: err.message };
  }
  return { reason: 'unknown', message: 'Playback failed for an unknown reason.' };
}
