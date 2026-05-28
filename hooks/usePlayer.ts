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
  withDeviceRecovery,
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
  /**
   * Soft pause. For Spotify: silences (volume → 0) while keeping the
   * Connect session alive — preferred for between-rounds gameplay so the
   * next round doesn't need a wake-up. For Deezer: real pause.
   * Used by the 30s auto-timer and team-award handlers.
   */
  pause: () => Promise<void>;
  /**
   * Hard stop. For Spotify: restore volume + actual pausePlayback so the
   * user's device returns to a normal state (visible in Control Center,
   * lock screen, etc.). Use when the user explicitly taps Stop. May
   * trigger recovery on the next round if iOS suspends Spotify, but
   * that's the trade-off for honoring explicit user intent.
   */
  stop: () => Promise<void>;
  /** Dismiss the current error without retrying. */
  clearError: () => void;
}

export function usePlayer(): [PlayerStatus, PlayerControls] {
  // --- Deezer (expo-audio) ---
  const deezerPlayer = useAudioPlayer(null);
  const deezerStatus = useAudioPlayerStatus(deezerPlayer);

  // --- Spotify (remote, local timer) ---
  // We track "play time" rather than wall-clock so that pauses don't
  // consume the round's 30s budget. `spotifyPlayMs` is the accumulated
  // playing time before the current (active) play segment; when playing,
  // current play time = spotifyPlayMs + (now - spotifyPlayingSince).
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);
  const [spotifyPlayMs, setSpotifyPlayMs] = useState(0);
  const [spotifyPlayingSince, setSpotifyPlayingSince] = useState<number | null>(null);
  // Tick state isn't read — its update via setInterval is what triggers
  // re-renders for the wall-clock-derived `currentTime` display.
  const [, setSpotifyTick] = useState(0);
  const [spotifyJustFinished, setSpotifyJustFinished] = useState(false);
  // True while the user has explicitly stopped (real pause, not silence).
  // Used by play() to decide between resume vs fresh-random-window.
  const [spotifyHardPausedUri, setSpotifyHardPausedUri] = useState<string | null>(
    null
  );
  // True while a play() call is in flight. Drives status.isBuffering so the
  // UI shows feedback ("Buffering") even before the playUri/resume call
  // returns — without this the user thinks the first Play tap did nothing.
  const [spotifyBuffering, setSpotifyBuffering] = useState(false);
  // URI of whatever song is currently/last playing on the Spotify path —
  // needed so stop() can mark it for resume.
  const [spotifyCurrentUri, setSpotifyCurrentUri] = useState<string | null>(null);
  // The random positionMs we chose for the current round's "fresh" play.
  // Resume calculates the right seek position as: roundStartMs + accumulated
  // play time. This decouples our seek logic from Spotify's actual position
  // (which advances during the silenced gap between rounds / pauses).
  const spotifyRoundStartMsRef = useRef(0);
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

        // Decide: resume from where the user stopped, or fresh random window?
        const isResume = spotifyHardPausedUri === song.spotifyUri;
        let startedPlayMs = spotifyPlayMs;
        setSpotifyBuffering(true);
        try {
          await withDeviceRecovery(async () => {
            const positionMs = isResume
              ? spotifyRoundStartMsRef.current + spotifyPlayMs
              : pickRandomStartMs(song.durationMs ?? PREVIEW_DURATION_MS);
            await playUri(song.spotifyUri!, { positionMs });
            if (!isResume) {
              spotifyRoundStartMsRef.current = positionMs;
            }
          });
          if (!isResume) {
            startedPlayMs = 0;
            setSpotifyPlayMs(0);
          }
        } catch (err) {
          stopSpotifyTimers();
          setSpotifyBuffering(false);
          setSpotifyPlaying(false);
          setSpotifyPlayingSince(null);
          setError(playerErrorFromException(err));
          return;
        }
        setSpotifyBuffering(false);

        const now = Date.now();
        setSpotifyPlayingSince(now);
        setSpotifyPlaying(true);
        setSpotifyHardPausedUri(null); // clear pause-state once resumed
        setSpotifyCurrentUri(song.spotifyUri);
        setSpotifyTick(0);

        stopSpotifyTimers();
        // Schedule the auto-pause to fire after the *remaining* round
        // time (30s minus already-accumulated play time). Critical for
        // pause/resume to not lose previously-played seconds.
        const remainingMs = Math.max(100, PREVIEW_DURATION_MS - startedPlayMs);
        spotifyPauseTimerRef.current = setTimeout(() => {
          spotifyPauseTimerRef.current = null;
          // 30s auto-end: DO NOT actually pause Spotify here — pausing
          // causes iOS to suspend the Spotify app, which then breaks the
          // next round's skipToNext call. Instead, just update app state
          // (timer freezes, Stop disables) and let audio continue playing
          // through the award screen. The next round's preload will use
          // skipToNext while Spotify is still alive.
          // Accumulate the final play segment into spotifyPlayMs.
          setSpotifyPlayMs((prev) => prev + (Date.now() - now));
          setSpotifyPlayingSince(null);
          setSpotifyPlaying(false);
          setSpotifyJustFinished(true);
          if (spotifyTickIntervalRef.current) {
            clearInterval(spotifyTickIntervalRef.current);
            spotifyTickIntervalRef.current = null;
          }
        }, remainingMs);

        spotifyTickIntervalRef.current = setInterval(() => {
          setSpotifyTick((t) => t + 1);
        }, SPOTIFY_TICK_MS);
        return;
      }

      // --- Deezer path ---
      if (song.previewUrl) {
        // If Spotify was active, pause it + cleanup timers.
        if (activeProvider === 'spotify') {
          stopSpotifyTimers();
          setSpotifyPlaying(false);
          setSpotifyPlayingSince(null);
          setSpotifyPlayMs(0);
          setSpotifyHardPausedUri(null);
          void withDeviceRecovery(() => pausePlayback()).catch(() => {});
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
    // Include spotifyHardPausedUri and spotifyPlayMs so the callback sees
    // their current values (otherwise resume detection uses stale closures
    // and falls through to fresh-random-window even when the user just stopped).
    [
      activeProvider,
      deezerPlayer,
      spotifyHardPausedUri,
      spotifyPlayMs,
      stopSpotifyTimers,
    ]
  );

  /**
   * Accumulate the in-flight play segment into spotifyPlayMs and stop
   * the timers. Shared between pause() and stop().
   */
  const stopSpotifyAndAccumulate = useCallback(() => {
    stopSpotifyTimers();
    if (spotifyPlayingSince != null) {
      const elapsed = Date.now() - spotifyPlayingSince;
      setSpotifyPlayMs((prev) => prev + elapsed);
    }
    setSpotifyPlayingSince(null);
    setSpotifyPlaying(false);
  }, [spotifyPlayingSince, stopSpotifyTimers]);

  const pause = useCallback(async () => {
    if (activeProvider === 'deezer') {
      deezerPlayer.pause();
      return;
    }
    if (activeProvider === 'spotify') {
      // DO NOT actually pause Spotify — causes iOS to suspend it, breaking
      // the next round. Just update app state; audio keeps playing.
      stopSpotifyAndAccumulate();
    }
  }, [activeProvider, deezerPlayer, stopSpotifyAndAccumulate]);

  const stop = useCallback(async () => {
    if (activeProvider === 'deezer') {
      deezerPlayer.pause();
      return;
    }
    if (activeProvider === 'spotify') {
      // Same as pause() for now — actual audio stop would cause dormancy.
      // The user explicitly deferred the Stop-button behavior; we'll figure
      // out a workable approach for it after the basic flow is solid.
      stopSpotifyAndAccumulate();
      if (spotifyCurrentUri) {
        setSpotifyHardPausedUri(spotifyCurrentUri);
      }
    }
  }, [activeProvider, deezerPlayer, spotifyCurrentUri, stopSpotifyAndAccumulate]);

  const clearError = useCallback(() => setError(null), []);

  // Compose the unified status from whichever provider is active.
  const status: PlayerStatus = (() => {
    if (activeProvider === 'spotify') {
      // Total play time = accumulated finished segments + current in-flight segment.
      const currentMs =
        spotifyPlayingSince != null
          ? spotifyPlayMs + (Date.now() - spotifyPlayingSince)
          : spotifyPlayMs;
      const elapsed = Math.min(PREVIEW_DURATION_S, Math.floor(currentMs / 1000));
      return {
        playing: spotifyPlaying,
        // "Loaded" once any play has happened for this Spotify session.
        isLoaded: spotifyCurrentUri !== null,
        isBuffering: spotifyBuffering,
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

  return [status, { play, pause, stop, clearError }];
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
