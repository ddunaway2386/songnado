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

const silentAsset = require('@/assets/silent.wav');

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
  }, [player]);

  const stopDucking = useCallback(() => {
    if (!isDuckingRef.current) return;
    isDuckingRef.current = false;
    try {
      player.pause();
    } catch {
      // Best-effort.
    }
  }, [player]);

  return { startDucking, stopDucking };
}
