/**
 * The one way into Apple Music (MusicKit) from JS.
 *
 * v1.0 plays the host's own Apple Music subscription (decided 2026-10-25,
 * after an App Review consultation on Oct 15 and a device spike): Songnado
 * picks the song and the window, Apple Music plays it. Deezer previews stay
 * family-only, because Deezer's terms limit them to private, non-commercial
 * use.
 *
 * ## Why everything goes through here
 *
 * `@lomray/react-native-apple-music` builds a NativeEventEmitter at import
 * time, which throws on any binary without the native module — every 1.0.3 /
 * 1.0.4 install. expo-router evaluates every route at launch and family-lane
 * OTAs reach those binaries, so a single top-level import anywhere would
 * crash them on startup (the same failure shape as Sentry.init on a binary
 * without Sentry). The bridge is therefore required lazily, and only after
 * checking the native module exists.
 *
 * `APPLE_MUSIC_ACTIVE` decides which catalogue the app uses: Apple Music when
 * the binary has MusicKit, Deezer otherwise. That keeps both lanes correct
 * without a build flag that could be set wrong: the App Store binary always
 * has the module, the old family binaries never do.
 */
import { NativeModules, Platform } from 'react-native';

type Bridge = typeof import('@lomray/react-native-apple-music');

let bridge: Bridge | null | undefined;

/** The MusicKit bridge, or null on binaries/platforms without it. */
export function appleMusic(): Bridge | null {
  if (bridge !== undefined) return bridge;
  if (Platform.OS !== 'ios' || !NativeModules.MusicModule) {
    bridge = null;
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  bridge = require('@lomray/react-native-apple-music') as Bridge;
  return bridge;
}

/**
 * Family builds can force the old Deezer catalogue on a MusicKit binary with
 * EXPO_PUBLIC_FORCE_DEEZER=true. Never set for App Store builds.
 */
const FORCE_DEEZER = process.env.EXPO_PUBLIC_FORCE_DEEZER === 'true';

export const APPLE_MUSIC_ACTIVE: boolean =
  !FORCE_DEEZER && Platform.OS === 'ios' && !!NativeModules.MusicModule;

/** Seconds of song a round plays (matches the old Deezer preview length). */
const ROUND_WINDOW_S = 30;

/**
 * Random start for a round, in seconds. Keeps clear of the first 10s (or
 * first tenth) so rounds rarely open on silence or a count-in, and leaves the
 * full window plus 5s before the end. Short tracks start at 0.
 */
export function pickAppleStartS(durationMs?: number): number {
  const dur = (durationMs ?? 0) / 1000;
  const latest = dur - ROUND_WINDOW_S - 5;
  if (latest <= 0) return 0;
  const earliest = Math.min(Math.max(10, dur * 0.1), latest);
  return Math.round((earliest + Math.random() * (latest - earliest)) * 10) / 10;
}

export type AppleMusicAccess =
  | { kind: 'ready' }
  /** The user declined access, or it's restricted (Screen Time). */
  | { kind: 'denied' }
  /** Access granted, but this Apple ID can't play the catalogue. */
  | { kind: 'no-subscription'; canSubscribe: boolean }
  /** Apple wants the user to accept updated Apple Music terms first. */
  | { kind: 'privacy-ack' }
  | { kind: 'error'; message: string };

/**
 * Asks for Apple Music access (iOS shows its prompt once) and checks the
 * subscription can play catalogue songs. Safe to call repeatedly: after the
 * first answer iOS returns the stored decision without prompting.
 */
export async function requestAppleMusicAccess(): Promise<AppleMusicAccess> {
  const am = appleMusic();
  if (!am) return { kind: 'error', message: 'Apple Music is not available in this build.' };
  try {
    const status = String(await am.Auth.authorize());
    if (status !== 'authorized') return { kind: 'denied' };
    const sub = await am.Auth.checkSubscription();
    if (sub.canPlayCatalogContent) return { kind: 'ready' };
    return { kind: 'no-subscription', canSubscribe: !!sub.canBecomeSubscriber };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'privacyAcknowledgementRequired') return { kind: 'privacy-ack' };
    if (code === 'permissionDenied') return { kind: 'denied' };
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
