/**
 * useDucking — iOS audio-ducking helper.
 *
 * Lets us "quiet" Spotify Connect audio between rounds without actually
 * calling pausePlayback (which causes iOS to suspend Spotify within
 * seconds, breaking subsequent rounds with a wake banner).
 *
 * Mechanism: we hold a silent WAV in our own audio session, configured
 * (in _layout.tsx) with `interruptionMode: 'duckOthers'`. When we
 * `play()` the silent track, iOS automatically reduces Spotify's volume
 * to ~20% (system-level ducking, same mechanism Waze uses to quiet
 * Spotify during navigation prompts). When we `pause()` the silent
 * track, Spotify's volume restores.
 *
 * Spotify keeps streaming throughout — so the Connect session stays
 * alive, no iOS suspension, no wake banner on the next round. The
 * user hears music faintly during scoring, then full-volume again when
 * they pick the next playlist.
 *
 * The silent.wav asset is 5s of mono 8kHz PCM silence (~40KB),
 * generated at build prep via a small Node script (see commit notes).
 * `loop: true` keeps it playing indefinitely while ducked.
 */

import { useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

import { setRepeat, transferPlayback } from '@/lib/spotify/playback';

const silentAsset = require('@/assets/silent.wav');

/**
 * Heartbeat interval: how often we ping Spotify while paused/ducked to
 * keep its Connect session alive on the server side.
 *
 * Why 8 seconds: short enough that Spotify's server-side last-seen
 * timer doesn't expire (anecdotally ~30s before the device is dropped
 * from /me/player/devices), long enough that we're not hammering the
 * API for what's essentially a no-op.
 */
const HEARTBEAT_MS = 8000;

export interface DuckingControls {
  /** Start ducking — Spotify's volume drops to ~20% iOS-side. Idempotent. */
  startDucking: () => void;
  /** Stop ducking — Spotify's volume restores to full. Idempotent. */
  stopDucking: () => void;
}

export function useDucking(): DuckingControls {
  const player = useAudioPlayer(silentAsset);
  // Track our ducking state so we can short-circuit redundant calls
  // (start/stop fire from multiple places — pause(), stop(), 30s timer,
  // each play() — and we want exactly-once iOS audio-session transitions).
  const isDuckingRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Loop is set once on mount. The player itself is stable across
    // renders (useAudioPlayer returns a ref-stable instance).
    try {
      player.loop = true;
    } catch {
      // expo-audio occasionally throws if the player isn't fully ready
      // on first render — ignored; loop will be set again on first play.
    }
    return () => {
      try {
        player.pause();
      } catch {
        // Cleanup is best-effort; we don't want to crash on teardown.
      }
    };
  }, [player]);

  const startDucking = useCallback(() => {
    if (isDuckingRef.current) return;
    isDuckingRef.current = true;
    try {
      player.loop = true;
      player.seekTo(0);
      player.play();
    } catch {
      // Best-effort — if ducking fails, we fall back to whatever
      // Spotify's actual volume is. Not worth surfacing to UI.
    }
    // Spotify Connect heartbeat: keep the device registered with
    // Spotify's servers while we're 'silent.' Each setRepeat call
    // forces Spotify's server to ping the device for an ack, which
    // resets the server's last-seen timer for that device. Without
    // this, Spotify's servers drop the device from /me/player/devices
    // after ~30s of no activity → withDeviceRecovery can't find a
    // device to transferPlayback to → wake banner on the next round.
    if (heartbeatRef.current == null) {
      heartbeatRef.current = setInterval(() => {
        console.log('[heartbeat] ping');
        // setRepeat('off') is idempotent and cheap — same value we
        // already set in the round preload. Failure is non-fatal:
        // either the device is truly suspended (wake banner will
        // appear on the next playback attempt regardless) or it's a
        // transient 502. Swallow either way.
        void setRepeat('off').catch((err) => {
          console.log('[heartbeat] failed', err?.message ?? err);
        });
      }, HEARTBEAT_MS);
    }
  }, [player]);

  const stopDucking = useCallback(() => {
    if (!isDuckingRef.current) return;
    isDuckingRef.current = false;
    try {
      player.pause();
    } catch {
      // Best-effort.
    }
    if (heartbeatRef.current != null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, [player]);

  return { startDucking, stopDucking };
}
