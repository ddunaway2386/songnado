/**
 * Spotify OAuth — PKCE flow via `expo-auth-session`.
 *
 * No client secret is embedded in the app; PKCE replaces it with a per-auth
 * code verifier/challenge pair generated client-side. Spotify's Authorization
 * Code with PKCE flow is documented at:
 * https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
 *
 * Token storage is the caller's responsibility (see `stores/spotifyStore.ts`).
 * This module only handles the OAuth roundtrip and refresh-token exchange.
 */

import * as AuthSession from 'expo-auth-session';

import { spotifyConfig } from './config';

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

/**
 * Tokens returned from a successful auth or refresh. Expiry is wall-clock —
 * convert from Spotify's `expires_in` (seconds-from-now) at fetch time.
 */
export interface SpotifyTokens {
  accessToken: string;
  /** May be undefined on refresh — Spotify sometimes omits it and the old one stays valid. */
  refreshToken?: string;
  /** Wall-clock millis (Date.now() + expires_in * 1000). */
  expiresAt: number;
  /** Granted scopes, space-separated string from Spotify. */
  scope: string;
}

export class SpotifyAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

/**
 * Run the full PKCE auth flow. Opens Spotify's authorization page in an
 * in-app browser, waits for redirect to `songsterv2://redirect`, then
 * exchanges the auth code for tokens.
 *
 * Throws `SpotifyAuthError` on any failure (user cancel, network error,
 * Spotify-side rejection). Caller should surface a friendly UI message;
 * the user is never blamed for a cancel.
 */
export async function authorize(): Promise<SpotifyTokens> {
  const request = new AuthSession.AuthRequest({
    clientId: spotifyConfig.clientId,
    scopes: [...spotifyConfig.scopes],
    redirectUri: spotifyConfig.redirectUri,
    usePKCE: true,
    // Don't ask Spotify to remember the user — they pick on every connect.
    // Spotify ignores `prompt` for some accounts but it's harmless.
    extraParams: { show_dialog: 'true' },
  });

  const result = await request.promptAsync(DISCOVERY);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new SpotifyAuthError('User cancelled', 'cancelled');
  }
  if (result.type === 'error') {
    throw new SpotifyAuthError(
      result.error?.message ?? 'Authorization failed',
      result.error?.code ?? 'auth_error'
    );
  }
  if (result.type !== 'success') {
    throw new SpotifyAuthError(`Unexpected auth result: ${result.type}`);
  }

  const code = result.params.code;
  const codeVerifier = request.codeVerifier;
  if (!code || !codeVerifier) {
    throw new SpotifyAuthError('Missing code or verifier after auth', 'invalid_response');
  }

  // Exchange the code for tokens. Spotify's token endpoint expects
  // application/x-www-form-urlencoded — not JSON.
  return exchangeCodeForTokens(code, codeVerifier);
}

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyConfig.redirectUri,
    client_id: spotifyConfig.clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch(DISCOVERY.tokenEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new SpotifyAuthError(
      `Token exchange failed: HTTP ${res.status} ${text}`,
      'token_exchange_failed'
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

/**
 * Trade a refresh token for a fresh access token. Called when the access
 * token is expired (proactively, or reactively on a 401 from the API).
 *
 * Spotify may or may not return a new refresh token in the response. When
 * it does, the caller should store the new one; when it doesn't, the
 * existing refresh token continues to work.
 */
export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: spotifyConfig.clientId,
  });

  const res = await fetch(DISCOVERY.tokenEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new SpotifyAuthError(
      `Refresh failed: HTTP ${res.status} ${text}`,
      res.status === 400 ? 'refresh_invalid' : 'refresh_failed'
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}
