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
 *  - `appleId` set → Apple Music path (the v1.0 App Store catalogue). MusicKit
 *    plays the host's own subscription from a random start; a local timer
 *    pauses it after 30s of play time, like the Spotify path. See
 *    lib/appleMusic.ts.
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

import { useDucking } from '@/hooks/useDucking';
import { appleMusic, pickAppleStartS } from '@/lib/appleMusic';
import { PREVIEW_DURATION_S } from '@/lib/scoring';
import {
  NoActiveDeviceError,
  NotPremiumError,
  pausePlayback,
  pickRandomStartMs,
  playTrackInContext,
  resumePlayback,
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

export interface PlayOptions {
  /**
   * Continue the 30s window instead of restarting it.
   *
   * Buzz mode needs this: when a team answers wrong the music picks back up
   * for the remaining teams, and restarting would replay audio the room
   * already heard, hand the later teams a longer listen than the first team
   * got, and let a round run indefinitely as answers pile up.
   *
   * Deezer resumes from the paused position (only if the same preview is
   * still loaded — otherwise it falls through to a normal fresh play).
   * Spotify reuses the existing resume branch, which seeks to
   * roundStart + already-played time and shortens the auto-pause timer to
   * whatever is left.
   */
  resume?: boolean;
}

export interface PlayerControls {
  /** Load + start a song. Resolves once playback has begun (or errored). */
  play: (song: Song, opts?: PlayOptions) => Promise<void>;
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
  /**
   * Apple Music only: load a song and seek to its random start without
   * playing, so the next play() of that song skips the load. Call it only
   * between rounds — it replaces whatever MusicKit has queued, so the previous
   * song can no longer be resumed. A no-op for other providers and while a
   * round is playing.
   */
  prepare: (song: Song) => Promise<void>;
}

export function usePlayer(): [PlayerStatus, PlayerControls] {
  // --- Deezer (expo-audio) ---
  const deezerPlayer = useAudioPlayer(null);
  const deezerStatus = useAudioPlayerStatus(deezerPlayer);
  // Which preview URL is currently loaded into the Deezer player. Lets a
  // resume request tell "same track, keep the position" from "different
  // track, load it fresh".
  const deezerLoadedUrlRef = useRef<string | null>(null);

  // --- iOS ducking (silent WAV in our own audio session) ---
  // Used in place of pausePlayback on Spotify-path round transitions so
  // iOS doesn't suspend Spotify (which would surface the wake banner).
  // See useDucking.ts for the full rationale.
  const { startDucking, stopDucking } = useDucking();

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

  // --- Apple Music (MusicKit, local timer) ---
  // Same accounting as the Spotify path: play time rather than wall-clock, so
  // a paused round keeps its remaining budget. What the callbacks read lives
  // in refs (no stale closures); the state copies only drive re-renders.
  /** Song currently loaded in MusicKit's queue, or null once replaced. */
  const appleIdRef = useRef<string | null>(null);
  /** Set by stop() or an outside pause, so the next play() resumes in place. */
  const appleHardPausedRef = useRef<string | null>(null);
  const applePlayMsRef = useRef(0);
  const applePlayingSinceRef = useRef<number | null>(null);
  /** Song prepare() has loaded and seeked, waiting for play(). */
  const applePreparedRef = useRef<string | null>(null);
  const applePreparingRef = useRef<Promise<void> | null>(null);
  /** True while play()/prepare() drive MusicKit, so their own events aren't read as outside control. */
  const appleBusyRef = useRef(false);
  const appleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appleTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [applePlaying, setApplePlaying] = useState(false);
  const [appleBuffering, setAppleBuffering] = useState(false);
  const [appleJustFinished, setAppleJustFinished] = useState(false);
  const [applePlayMs, setApplePlayMs] = useState(0);
  const [applePlayingSince, setApplePlayingSince] = useState<number | null>(null);
  const [, setAppleTick] = useState(0);

  // --- Shared ---
  const [activeProvider, setActiveProvider] = useState<
    'deezer' | 'spotify' | 'apple' | null
  >(null);
  const [error, setError] = useState<PlayerError | null>(null);

  // Cleanup all timers + intervals on unmount, plus hard-pause Spotify.
  //
  // Reaching this cleanup means the host component (typically the game
  // screen) is unmounting — heading to /game-over after a winner, back to /
  // after End Game, or backing out some other way. None of those have a
  // "next round" that the soft-pause trade-off (in pause() and stop() below)
  // is protecting, so we can safely call the real pausePlayback here.
  //
  // Best-effort: pausePlayback handles 403 "no active session" internally;
  // a 404 (no active device — Spotify already dormant) lands in our .catch
  // and is a no-op since audio isn't playing anyway. We skip withDeviceRecovery
  // deliberately — its recovery path transfers playback with play=true, which
  // would briefly start audio just to pause it. Not what we want on exit.
  useEffect(() => {
    return () => {
      if (spotifyPauseTimerRef.current) clearTimeout(spotifyPauseTimerRef.current);
      if (spotifyTickIntervalRef.current) clearInterval(spotifyTickIntervalRef.current);
      void pausePlayback().catch(() => {});
      if (appleTimerRef.current) clearTimeout(appleTimerRef.current);
      if (appleTickRef.current) clearInterval(appleTickRef.current);
      if (appleIdRef.current || applePreparedRef.current) appleMusic()?.Player.pause();
    };
  }, []);

  // Reset the one-shot `didJustFinish` flag the frame after it fires.
  useEffect(() => {
    if (spotifyJustFinished) {
      const id = setTimeout(() => setSpotifyJustFinished(false), 0);
      return () => clearTimeout(id);
    }
  }, [spotifyJustFinished]);

  useEffect(() => {
    if (appleJustFinished) {
      const id = setTimeout(() => setAppleJustFinished(false), 0);
      return () => clearTimeout(id);
    }
  }, [appleJustFinished]);

  const stopAppleTimers = useCallback(() => {
    if (appleTimerRef.current) {
      clearTimeout(appleTimerRef.current);
      appleTimerRef.current = null;
    }
    if (appleTickRef.current) {
      clearInterval(appleTickRef.current);
      appleTickRef.current = null;
    }
  }, []);

  /** Folds the in-flight segment into the round's play time and marks it paused. */
  const settleApple = useCallback(() => {
    stopAppleTimers();
    const since = applePlayingSinceRef.current;
    if (since != null) applePlayMsRef.current += Date.now() - since;
    applePlayingSinceRef.current = null;
    setApplePlayMs(applePlayMsRef.current);
    setApplePlayingSince(null);
    setApplePlaying(false);
  }, [stopAppleTimers]);

  /** Starts the round clock once audio is actually running. */
  const startAppleClock = useCallback(() => {
    stopAppleTimers();
    const now = Date.now();
    applePlayingSinceRef.current = now;
    setApplePlayingSince(now);
    setApplePlaying(true);
    const remainingMs = Math.max(100, PREVIEW_DURATION_MS - applePlayMsRef.current);
    appleTimerRef.current = setTimeout(() => {
      appleTimerRef.current = null;
      appleMusic()?.Player.pause();
      settleApple();
      setAppleJustFinished(true);
    }, remainingMs);
    appleTickRef.current = setInterval(() => setAppleTick((t) => t + 1), SPOTIFY_TICK_MS);
  }, [settleApple, stopAppleTimers]);

  // The lock screen, Control Center, AirPods and phone calls can all pause or
  // play MusicKit behind the game's back. An outside pause stops the round
  // clock (and the next Play resumes in place); an outside play restarts the
  // clock so the 30s auto-pause still lands instead of the song running on.
  useEffect(() => {
    const am = appleMusic();
    if (!am) return;
    const sub = am.Player.addListener('onPlaybackStateChange', (e: { playbackStatus?: string }) => {
      if (appleBusyRef.current || !appleIdRef.current) return;
      const playing = e?.playbackStatus === 'playing';
      if (!playing && applePlayingSinceRef.current != null) {
        settleApple();
        appleHardPausedRef.current = appleIdRef.current;
      } else if (playing && applePlayingSinceRef.current == null) {
        if (applePlayMsRef.current >= PREVIEW_DURATION_MS) am.Player.pause();
        else startAppleClock();
      }
    });
    return () => sub.remove();
  }, [settleApple, startAppleClock]);

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

  /** Silences MusicKit when a round switches to another provider. */
  const leaveApple = useCallback(() => {
    appleMusic()?.Player.pause();
    settleApple();
    appleIdRef.current = null;
    appleHardPausedRef.current = null;
  }, [settleApple]);

  const play = useCallback(
    async (song: Song, opts?: PlayOptions) => {
      const wantResume = opts?.resume === true;
      setError(null);
      setSpotifyJustFinished(false);

      // --- Apple Music path ---
      if (song.appleId) {
        const am = appleMusic();
        if (!am) {
          setError({ reason: 'unknown', message: 'Apple Music is not available in this build.' });
          return;
        }
        if (activeProvider === 'deezer') deezerPlayer.pause();
        setActiveProvider('apple');
        setAppleJustFinished(false);
        stopAppleTimers();
        setAppleBuffering(true);
        appleBusyRef.current = true;
        try {
          // A prepare() still in flight would race this load; let it land.
          await applePreparingRef.current?.catch(() => {});
          const isResume =
            (wantResume || appleHardPausedRef.current === song.appleId) &&
            appleIdRef.current === song.appleId;
          if (!isResume) {
            // Seek before play: on device this starts exactly at the target
            // with no intro leak (spike, 2026-10-25). Playing first and then
            // seeking let the opening through for a moment.
            if (applePreparedRef.current !== song.appleId) {
              await am.MusicKit.setPlaybackQueue(song.appleId, am.MusicItem.SONG);
              am.Player.seekToTime(pickAppleStartS(song.durationMs));
            }
            applePreparedRef.current = null;
            appleIdRef.current = song.appleId;
            applePlayMsRef.current = 0;
            setApplePlayMs(0);
          }
          appleHardPausedRef.current = null;
          am.Player.play();
          if (!(await waitForApplePlaying(am))) {
            throw new Error("Apple Music didn't start playing. Check your connection and try again.");
          }
        } catch (err) {
          appleBusyRef.current = false;
          setAppleBuffering(false);
          am.Player.pause();
          settleApple();
          setError(playerErrorFromException(err));
          return;
        }
        appleBusyRef.current = false;
        setAppleBuffering(false);
        startAppleClock();
        return;
      }

      // --- Spotify path ---
      if (song.spotifyUri) {
        console.log('[player] play() Spotify branch entered for', song.spotifyUri);
        // If Deezer was active, kill its audio first.
        if (activeProvider === 'deezer') {
          deezerPlayer.pause();
        }
        if (activeProvider === 'apple') leaveApple();
        setActiveProvider('spotify');

        // Stop ducking BEFORE the playback call so Spotify's volume is
        // already at full when the new track starts. Otherwise the new
        // track would begin at the ducked ~20% level until iOS releases
        // the duck (which happens when our silent track stops anyway,
        // but doing it first eliminates a brief faint-start.)
        stopDucking();

        // Decide: resume from where the user stopped, or fresh random window?
        // An explicit resume request counts too — buzz mode's pause() only
        // ducks, so it never sets spotifyHardPausedUri.
        const isResume =
          wantResume || spotifyHardPausedUri === song.spotifyUri;
        let startedPlayMs = spotifyPlayMs;
        setSpotifyBuffering(true);
        try {
          await withDeviceRecovery(async () => {
            const positionMs = isResume
              ? spotifyRoundStartMsRef.current + spotifyPlayMs
              : pickRandomStartMs(song.durationMs ?? PREVIEW_DURATION_MS);
            console.log('[player] play start', {
              positionMs,
              isResume,
              hasPlaylistId: !!song.spotifyPlaylistId,
            });
            if (isResume || !song.spotifyPlaylistId) {
              // Resume case: track was hard-paused by the user; just
              // resume at the saved position (no body, Spotify continues
              // from paused position). Or: no playlist context known —
              // fall back to plain resume.
              await resumePlayback();
            } else {
              // Fresh-window case: re-establish playlist context AND
              // jump to specific track + position in one call. This is
              // the only body shape Spotify accepts without choking with
              // 403 'Restriction violated' (just position_ms alone is
              // rejected; seek on a paused player is rejected; playUri
              // works but destroys the playlist queue).
              await playTrackInContext(
                song.spotifyPlaylistId,
                song.spotifyUri!,
                positionMs
              );
            }
            console.log('[player] play OK');
            if (!isResume) {
              spotifyRoundStartMsRef.current = positionMs;
            }
          });
          if (!isResume) {
            startedPlayMs = 0;
            setSpotifyPlayMs(0);
          }
        } catch (err) {
          console.log('[player] play() FAILED', err);
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
        console.log('[player] setSpotifyPlaying(true) called — UI should show Pause now');
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
          // 30s auto-end: duck Spotify instead of pausing. Same Connect-
          // keep-alive reasoning as pause() — audio drops to ~20% and
          // sounds like the round ended, but the session never goes
          // dormant so the next round transitions without a wake banner.
          startDucking();
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
        // If Spotify was active, kill its audio + cleanup timers.
        // We pause Spotify so its audio doesn't mix with Deezer's, but
        // we INTENTIONALLY keep ducking (silent.wav) playing through
        // the Deezer round — that keeps our audio session continuously
        // active, which prevents iOS from aggressively suspending
        // Spotify across the cross-provider switch. Without this,
        // Spotify suspends during the Deezer round and the next
        // Spotify-playlist pick triggers the wake banner. silent.wav
        // is genuinely silent so the user hears only Deezer's audio.
        if (activeProvider === 'spotify') {
          stopSpotifyTimers();
          setSpotifyPlaying(false);
          setSpotifyPlayingSince(null);
          setSpotifyPlayMs(0);
          setSpotifyHardPausedUri(null);
          startDucking(); // keep our audio session alive across the switch
          void pausePlayback().catch(() => {});
        }
        if (activeProvider === 'apple') leaveApple();
        setActiveProvider('deezer');

        // Resume only if this exact preview is still loaded — replace()
        // would discard the position we're trying to keep. If anything else
        // has been loaded since, fall through to a normal fresh play rather
        // than silently resuming the wrong track.
        if (wantResume && deezerLoadedUrlRef.current === song.previewUrl) {
          deezerPlayer.play();
          return;
        }

        deezerLoadedUrlRef.current = song.previewUrl;
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
      startDucking,
      stopDucking,
      stopAppleTimers,
      settleApple,
      startAppleClock,
      leaveApple,
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
    if (activeProvider === 'apple') {
      appleMusic()?.Player.pause();
      settleApple();
      return;
    }
    if (activeProvider === 'deezer') {
      deezerPlayer.pause();
      return;
    }
    if (activeProvider === 'spotify') {
      stopSpotifyAndAccumulate();
      // Duck instead of pause: iOS lowers Spotify's volume to ~20%
      // without actually pausing playback, so the Connect session stays
      // alive and the next round doesn't need a wake-up banner.
      // Spotify keeps "playing" faintly in the background until the
      // user picks the next playlist (which calls stopDucking + skip).
      startDucking();
    }
  }, [activeProvider, deezerPlayer, stopSpotifyAndAccumulate, startDucking, settleApple]);

  const stop = useCallback(async () => {
    if (activeProvider === 'apple') {
      appleMusic()?.Player.pause();
      settleApple();
      appleHardPausedRef.current = appleIdRef.current;
      return;
    }
    if (activeProvider === 'deezer') {
      deezerPlayer.pause();
      return;
    }
    if (activeProvider === 'spotify') {
      stopSpotifyAndAccumulate();
      if (spotifyCurrentUri) {
        setSpotifyHardPausedUri(spotifyCurrentUri);
      }
      // Same as pause() — duck instead of hard-pausing Spotify.
      startDucking();
    }
  }, [
    activeProvider,
    deezerPlayer,
    spotifyCurrentUri,
    stopSpotifyAndAccumulate,
    startDucking,
    settleApple,
  ]);

  const clearError = useCallback(() => setError(null), []);

  const prepare = useCallback(async (song: Song) => {
    const am = appleMusic();
    const appleId = song.appleId;
    if (!am || !appleId) return;
    // Never pull the queue out from under a playing or starting round.
    if (applePlayingSinceRef.current != null || appleBusyRef.current) return;
    if (applePreparedRef.current === appleId) return;
    const job = (async () => {
      appleBusyRef.current = true;
      try {
        applePreparedRef.current = null;
        await am.MusicKit.setPlaybackQueue(appleId, am.MusicItem.SONG);
        am.Player.seekToTime(pickAppleStartS(song.durationMs));
        applePreparedRef.current = appleId;
        // The queue no longer holds the previous round's song.
        appleIdRef.current = null;
        appleHardPausedRef.current = null;
      } catch {
        applePreparedRef.current = null;
      } finally {
        appleBusyRef.current = false;
      }
    })();
    applePreparingRef.current = job;
    await job;
  }, []);

  // Compose the unified status from whichever provider is active.
  const status: PlayerStatus = (() => {
    if (activeProvider === 'apple') {
      const currentMs =
        applePlayingSince != null ? applePlayMs + (Date.now() - applePlayingSince) : applePlayMs;
      return {
        playing: applePlaying,
        isLoaded: true,
        isBuffering: appleBuffering,
        currentTime: Math.min(PREVIEW_DURATION_S, Math.floor(currentMs / 1000)),
        didJustFinish: appleJustFinished,
        error,
      };
    }
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

  return [status, { play, pause, stop, clearError, prepare }];
}

/** Polls MusicKit until it reports playing; false after `timeoutMs`. */
async function waitForApplePlaying(
  am: NonNullable<ReturnType<typeof appleMusic>>,
  timeoutMs = 8000
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await am.Player.getCurrentState();
    if (s?.playbackStatus === 'playing') return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
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
