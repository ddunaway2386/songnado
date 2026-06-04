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

import { prefetchSmartphoneDevice, transferPlayback } from '@/lib/spotify/playback';

const silentAsset = require('@/assets/silent.wav');

/**
 * Heartbeat interval: how often we ping Spotify while paused/ducked to
 * keep its Connect session alive on the server side.
 *
 * Aggressive 5s cadence: the user's device suspends Spotify within ~8s
 * of an API-driven pause (observed in Metro: setRepeat heartbeats at
 * 8s already 502'd). We need to ping faster than that suspension
 * window to have a chance.
 */
const HEARTBEAT_MS = 5000;

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
    // Spotify's servers while we're 'silent.' We use transferPlayback
    // (with play: false so audio doesn't kick in) rather than a
    // metadata setter — transferPlayback is the same mechanism
    // withDeviceRecovery uses to wake a dormant device, and on this
    // user's iOS device it's the only call that's reliably engaging.
    // Lighter-weight calls like setRepeat were 502'ing within 8s of
    // pause, suggesting the server doesn't route them to a paused
    // device. transferPlayback forces the round-trip.
    if (heartbeatRef.current == null) {
      heartbeatRef.current = setInterval(() => {
        void (async () => {
          const phoneId = await prefetchSmartphoneDevice().catch(() => null);
          if (!phoneId) {
            console.log('[heartbeat] no phone in device list');
            return;
          }
          console.log('[heartbeat] transfer ping →', phoneId.slice(0, 8));
          try {
            await transferPlayback(phoneId, false);
            console.log('[heartbeat] OK');
          } catch (err) {
            const msg =
              err && typeof err === 'object' && 'message' in err
                ? String((err as { message: unknown }).message)
                : String(err);
            console.log('[heartbeat] failed', msg);
          }
        })();
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
