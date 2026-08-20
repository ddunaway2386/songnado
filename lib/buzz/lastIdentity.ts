/**
 * Remembers which team this phone was, so rejoining a game gets you your
 * own team back instead of a duplicate.
 *
 * The store's auto-reconnect only covers a socket that drops while the app
 * stays on the game screen. Every other way back in — tapping Leave, the
 * app being killed, the phone rebooting, or the retries running out — comes
 * through the join screen, which had no memory of the previous identity and
 * so produced a second team holding no score. That is what a family test
 * actually hit.
 *
 * Persisted rather than held in memory because "logged out" often means the
 * app was killed outright.
 *
 * Sending a stale id is harmless: the host only reattaches when it still
 * knows that team AND that team has no live socket, and otherwise treats the
 * JOIN as new. So this can be liberal.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TeamColor } from './protocol';

const KEY = 'songster-buzz-identity';

export interface BuzzIdentity {
  /** Host address this identity belongs to — identities don't transfer. */
  host: string;
  port: number;
  teamId: string;
  name: string;
  color: TeamColor;
  /** Epoch ms, so a stale identity from days ago can be ignored. */
  savedAtMs: number;
}

/** Identities older than this are treated as a different occasion entirely. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function saveIdentity(id: Omit<BuzzIdentity, 'savedAtMs'>): Promise<void> {
  try {
    const payload: BuzzIdentity = { ...id, savedAtMs: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Losing this only costs a duplicate team; never break a join over it.
  }
}

/**
 * The stored teamId for this host, or null when there isn't a usable one.
 * Matching on host+port keeps one game's identity from leaking into another.
 */
export async function loadIdentityFor(
  host: string,
  port: number
): Promise<BuzzIdentity | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const id = JSON.parse(raw) as BuzzIdentity;
    if (id?.host !== host || id?.port !== port) return null;
    if (!id.teamId) return null;
    if (Date.now() - (id.savedAtMs ?? 0) > MAX_AGE_MS) return null;
    return id;
  } catch {
    return null;
  }
}

/**
 * The stored identity regardless of which host it came from. Used only to
 * prefill the join form, so a returning player doesn't have to retype their
 * name exactly for the reattach to match.
 */
export async function loadLastIdentity(): Promise<BuzzIdentity | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const id = JSON.parse(raw) as BuzzIdentity;
    if (!id?.name) return null;
    if (Date.now() - (id.savedAtMs ?? 0) > MAX_AGE_MS) return null;
    return id;
  } catch {
    return null;
  }
}

export async function clearIdentity(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do.
  }
}
