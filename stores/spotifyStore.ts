/**
 * Spotify connection store.
 *
 * Two-layered persistence on purpose:
 *  - **Tokens** (access + refresh) live in `expo-secure-store` — encrypted
 *    at rest on iOS/Android. Never in AsyncStorage.
 *  - **Connection metadata** (profile, product tier, status flags) lives in
 *    Zustand's in-memory state. It's rehydrated from secure storage + a
 *    `GET /me` call on app start.
 *
 * Why not persist everything together? Secure store has a small size limit
 * and isn't designed for arbitrary blobs. Tokens are the only thing that
 * actually needs encryption; profile data is public and gets refreshed
 * cheaply on launch.
 */

import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { authorize, SpotifyAuthError, type SpotifyTokens } from '@/lib/spotify/auth';
import {
  getCurrentUser,
  setTokenAdapter,
  SpotifyApiError,
  type SpotifyUserProfile,
} from '@/lib/spotify/api';

const TOKEN_KEY = 'songnado.spotify.tokens.v1';

export type SpotifyStatus =
  | 'idle' // Not connected, no attempt made
  | 'restoring' // App just launched, checking secure store
  | 'connecting' // OAuth in flight
  | 'connected' // Connected with a valid session
  | 'error'; // Last attempt failed — user can retry

export interface SpotifyState {
  status: SpotifyStatus;
  profile: SpotifyUserProfile | null;
  tokens: SpotifyTokens | null;
  /** Last error message, cleared on next successful action. */
  error: string | null;

  /** Convenience: is the connected user on Spotify Premium? */
  isPremium: boolean;

  // ---- Actions ----

  /** Called once at app init. Reads tokens from secure store, refreshes profile. */
  restoreFromStorage: () => Promise<void>;

  /** Kicks off the OAuth flow. Throws are swallowed and surfaced via state. */
  connect: () => Promise<void>;

  /** Disconnect: wipe tokens and reset to idle. Idempotent. */
  disconnect: () => Promise<void>;

  /** Internal: update tokens (called by api.ts after refresh). */
  setTokens: (tokens: SpotifyTokens) => Promise<void>;
}

// Helpers ---------------------------------------------------------------------

async function loadTokens(): Promise<SpotifyTokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpotifyTokens;
    // Sanity check — if the shape is wrong, treat as no tokens.
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: SpotifyTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
}

async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}

// Store -----------------------------------------------------------------------

export const useSpotifyStore = create<SpotifyState>((set, get) => ({
  status: 'idle',
  profile: null,
  tokens: null,
  error: null,
  isPremium: false,

  async restoreFromStorage() {
    // Idempotency guard: if we're already restoring, connected, or actively
    // OAuthing, don't double-fire. Only re-enter from 'idle' or 'error'.
    const current = get().status;
    if (current === 'restoring' || current === 'connecting' || current === 'connected') {
      return;
    }
    set({ status: 'restoring', error: null });
    const tokens = await loadTokens();
    if (!tokens) {
      set({ status: 'idle', tokens: null, profile: null, isPremium: false });
      return;
    }

    set({ tokens });
    // Fetch profile to confirm the token still works and to detect product changes
    // (e.g. user upgraded Free → Premium since last session).
    try {
      const profile = await getCurrentUser();
      set({
        status: 'connected',
        profile,
        isPremium: profile.product === 'premium',
        error: null,
      });
    } catch (err) {
      // Token may be permanently invalid (revoked, scope changed, etc.)
      if (err instanceof SpotifyApiError && err.status === 401) {
        await clearTokens();
        set({ status: 'idle', tokens: null, profile: null, isPremium: false });
        return;
      }
      // Transient network errors: keep the tokens, surface as error state so
      // the user can retry without re-authing.
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to verify Spotify connection',
      });
    }
  },

  async connect() {
    set({ status: 'connecting', error: null });
    try {
      const tokens = await authorize();
      await saveTokens(tokens);
      set({ tokens });

      const profile = await getCurrentUser();
      set({
        status: 'connected',
        profile,
        isPremium: profile.product === 'premium',
        error: null,
      });
    } catch (err) {
      // User cancel isn't really an error — just bounce back to idle quietly.
      if (err instanceof SpotifyAuthError && err.code === 'cancelled') {
        set({ status: 'idle', error: null });
        return;
      }
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not connect to Spotify',
      });
    }
  },

  async disconnect() {
    await clearTokens();
    set({
      status: 'idle',
      tokens: null,
      profile: null,
      isPremium: false,
      error: null,
    });
  },

  async setTokens(tokens: SpotifyTokens) {
    await saveTokens(tokens);
    set({ tokens });
  },
}));

// Wire the API client to this store as the token source. Done once at module
// load so every consumer of `lib/spotify/api.ts` gets transparent token mgmt.
setTokenAdapter({
  getTokens: () => useSpotifyStore.getState().tokens,
  onTokensRefreshed: (tokens) => useSpotifyStore.getState().setTokens(tokens),
  onAuthLost: () => useSpotifyStore.getState().disconnect(),
});
