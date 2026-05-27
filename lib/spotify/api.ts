/**
 * Spotify Web API client — thin wrapper over `fetch` that handles
 * bearer-token auth, automatic refresh on 401, and Premium detection.
 *
 * This module is auth-aware but storage-agnostic: it asks the caller
 * (via `getTokens` / `onTokensRefreshed`) for the current tokens and
 * notifies when it refreshes them, so the Zustand store + secure-store
 * stay the source of truth.
 */

import { refreshAccessToken, SpotifyAuthError, type SpotifyTokens } from './auth';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly spotifyCode?: string
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

/**
 * Adapter the API client uses to read/write tokens. Implemented by the
 * Zustand store. Keeping it as a parameter (not a hard dependency) means
 * `api.ts` stays testable without React.
 */
export interface TokenAdapter {
  /** Return the current tokens, or null if disconnected. */
  getTokens(): SpotifyTokens | null;
  /** Called whenever a refresh produces new tokens — persist them. */
  onTokensRefreshed(tokens: SpotifyTokens): void | Promise<void>;
  /** Called when refresh fails terminally (refresh token revoked, etc.). */
  onAuthLost(): void | Promise<void>;
}

let adapter: TokenAdapter | null = null;

/** Wire the API client to the token store. Called once at app init. */
export function setTokenAdapter(a: TokenAdapter): void {
  adapter = a;
}

function requireAdapter(): TokenAdapter {
  if (!adapter) {
    throw new SpotifyApiError(
      'Token adapter not configured — call setTokenAdapter() at app init.',
      0
    );
  }
  return adapter;
}

/**
 * Ensure we have a non-expired access token. Refreshes proactively if
 * we're within 60 seconds of expiry (clock skew buffer).
 */
async function getValidAccessToken(): Promise<string> {
  const a = requireAdapter();
  const tokens = a.getTokens();
  if (!tokens) {
    throw new SpotifyApiError('Not connected to Spotify', 401);
  }

  const buffer = 60_000; // 1 minute
  if (tokens.expiresAt > Date.now() + buffer) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    // No refresh token means we can't recover — force re-auth.
    await a.onAuthLost();
    throw new SpotifyApiError('Access token expired and no refresh token', 401);
  }

  try {
    const fresh = await refreshAccessToken(tokens.refreshToken);
    await a.onTokensRefreshed(fresh);
    return fresh.accessToken;
  } catch (err) {
    if (err instanceof SpotifyAuthError && err.code === 'refresh_invalid') {
      await a.onAuthLost();
    }
    throw err;
  }
}

/**
 * Core authenticated fetch. Adds the bearer token, retries once on 401
 * after a refresh, and translates Spotify error responses into
 * `SpotifyApiError`s with useful messages.
 */
async function spotifyFetch(
  path: string,
  init: RequestInit = {},
  retryOn401 = true
): Promise<Response> {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && retryOn401) {
    // Token may have been revoked mid-flight — force a refresh and retry once.
    const a = requireAdapter();
    const tokens = a.getTokens();
    if (tokens?.refreshToken) {
      try {
        const fresh = await refreshAccessToken(tokens.refreshToken);
        await a.onTokensRefreshed(fresh);
        return spotifyFetch(path, init, false); // no further retry
      } catch {
        await a.onAuthLost();
      }
    }
  }

  return res;
}

async function readError(res: Response): Promise<SpotifyApiError> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const json = (await res.json()) as { error?: { message?: string; status?: number } };
    if (json.error?.message) {
      message = json.error.message;
      code = String(json.error.status ?? res.status);
    }
  } catch {
    // Body wasn't JSON; stick with the HTTP status.
  }
  return new SpotifyApiError(message, res.status, code);
}

/**
 * GET helper that returns parsed JSON. Handles auth, retry-on-401, and
 * Spotify error responses uniformly. Use this for any read endpoint.
 */
export async function spotifyGet<T>(path: string): Promise<T> {
  const res = await spotifyFetch(path);
  if (!res.ok) throw await readError(res);
  return res.json() as Promise<T>;
}

/**
 * PUT helper. Most Spotify mutation endpoints (play, pause, seek, volume)
 * return 204 No Content on success — we just need to confirm 2xx and surface
 * errors. Pass `body` to send a JSON-encoded payload; omit for empty PUTs.
 */
export async function spotifyPut(path: string, body?: unknown): Promise<void> {
  const init: RequestInit = { method: 'PUT' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await spotifyFetch(path, init);
  if (!res.ok) throw await readError(res);
}

// ============================================================================
// Public API surface — keep narrow; add as phases need it.
// ============================================================================

export interface SpotifyUserProfile {
  id: string;
  displayName: string;
  /** "premium" | "free" | "open" — branch on this for the Free-user UX. */
  product: 'premium' | 'free' | 'open';
  email?: string;
  /** Profile image URL (may be empty for new accounts). */
  imageUrl: string;
}

/**
 * GET /v1/me — current user profile. Crucial: the `product` field tells
 * us whether they can drive playback. We hit this immediately after auth
 * so Free users get the conversion screen instead of a 403 mid-game.
 */
export async function getCurrentUser(): Promise<SpotifyUserProfile> {
  const json = await spotifyGet<{
    id: string;
    display_name?: string;
    product: 'premium' | 'free' | 'open';
    email?: string;
    images?: { url: string }[];
  }>('/me');

  return {
    id: json.id,
    displayName: json.display_name ?? json.id,
    product: json.product,
    email: json.email,
    imageUrl: json.images?.[0]?.url ?? '',
  };
}
