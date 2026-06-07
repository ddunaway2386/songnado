/**
 * Remote runtime config — kill-switch and feature flags fetched from
 * GitHub Pages on app launch.
 *
 * Why this exists: if Spotify's Nov 2024 policy played out for Deezer
 * (their API gets restricted or Songnado specifically gets a takedown
 * request), we need the ability to disable Deezer playback within
 * minutes — without shipping a new app version through Apple's review.
 *
 * Architecture:
 *  1. JSON file lives at `docs/config/runtime.json` in this repo,
 *     served by GitHub Pages at
 *     https://ddunaway2386.github.io/songnado/config/runtime.json.
 *  2. App fetches on launch with a short timeout. Result is cached in
 *     AsyncStorage so subsequent launches start with the last-known
 *     state immediately while the fresh fetch runs in background.
 *  3. **Fails open**: any network/parse error leaves the previous
 *     cached config in effect, and if there's no cache, defaults to
 *     enabled. We don't want a flaky connection to brick the app.
 *  4. When `deezerEnabled` flips to false, `gameStore` refuses to
 *     start Deezer rounds and the setup screen surfaces a banner
 *     with `killSwitchReason`.
 *
 * To kill Deezer in production:
 *  1. Edit `docs/config/runtime.json` — set `deezerEnabled: false`
 *     and put a user-facing reason in `killSwitchReason`.
 *  2. Push to main.
 *  3. GitHub Pages rebuilds in ~30 seconds.
 *  4. All running apps pick it up on their next launch (or sooner
 *     if we add foreground re-checks later).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export interface RemoteConfig {
  schemaVersion: number;
  /** Master switch for Deezer playback. False = Deezer disabled with banner. */
  deezerEnabled: boolean;
  /**
   * User-facing message shown when a service is killed. Plain text, kept
   * short. Empty string when nothing is killed.
   */
  killSwitchReason: string;
  /** YYYY-MM-DD string, for our own debug. Not displayed. */
  lastUpdated: string;
}

const CONFIG_URL =
  'https://ddunaway2386.github.io/songnado/config/runtime.json';
const STORAGE_KEY = 'songnado.runtime-config.v1';
const FETCH_TIMEOUT_MS = 5000;

const DEFAULT_CONFIG: RemoteConfig = {
  schemaVersion: 1,
  deezerEnabled: true,
  killSwitchReason: '',
  lastUpdated: '1970-01-01',
};

interface RemoteConfigState {
  config: RemoteConfig;
  /** True after the first fetch attempt (success OR failure) completes. */
  hasInitialized: boolean;
  /** Kick off the boot-time fetch. Idempotent — extra calls no-op. */
  initialize: () => Promise<void>;
}

function isValidConfig(value: unknown): value is RemoteConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.deezerEnabled === 'boolean' &&
    typeof v.killSwitchReason === 'string' &&
    typeof v.lastUpdated === 'string'
  );
}

async function loadCached(): Promise<RemoteConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCached(config: RemoteConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Cache failure is non-fatal — we'll just refetch next launch.
  }
}

async function fetchRemote(): Promise<RemoteConfig | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Cache-bust query param so CDNs / proxies don't serve a stale
    // killed-state config back to us. GitHub Pages itself respects ETag
    // but downstream caches in the user's network might not.
    const url = CONFIG_URL + '?t=' + Date.now();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return isValidConfig(json) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const useRemoteConfigStore = create<RemoteConfigState>()((set, get) => ({
  config: DEFAULT_CONFIG,
  hasInitialized: false,

  initialize: async () => {
    if (get().hasInitialized) return;

    // Step 1: seed from cache immediately so the UI doesn't flash the
    // default state if a previous launch had a fresh fetch.
    const cached = await loadCached();
    if (cached) set({ config: cached });

    // Step 2: kick off a fresh fetch. Don't await — we want the app to
    // start using whatever-we-have (cache or default) right away, and
    // upgrade asynchronously when the network responds.
    void (async () => {
      const fresh = await fetchRemote();
      if (fresh) {
        set({ config: fresh, hasInitialized: true });
        await saveCached(fresh);
      } else {
        // Fetch failed. Mark initialized so the rest of the app doesn't
        // wait forever, but keep whatever we had (cache or default).
        set({ hasInitialized: true });
      }
    })();

    // Step 3: also mark initialized after the timeout window so any UI
    // gated on `hasInitialized` doesn't block forever in offline mode.
    setTimeout(() => {
      if (!get().hasInitialized) set({ hasInitialized: true });
    }, FETCH_TIMEOUT_MS + 100);
  },
}));
