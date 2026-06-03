import Constants from 'expo-constants';

interface SpotifyConfig {
  /** Spotify Developer Dashboard app Client ID. */
  clientId: string;
  /**
   * OAuth redirect URI. Must match (exactly) what's registered in the
   * Spotify Dashboard's "Redirect URIs" list. The path after the scheme is
   * arbitrary as long as the registered value matches.
   */
  redirectUri: string;
  /** OAuth scopes we request — minimum needed for the integration. */
  scopes: readonly string[];
}

const SCOPES = [
  // Read the user's playlists.
  'playlist-read-private',
  'playlist-read-collaborative',
  // Read user profile (display name in UI).
  'user-read-private',
  // Control playback (play/pause/seek/queue).
  'user-modify-playback-state',
  // Read playback state (current device, whether anything is playing).
  'user-read-playback-state',
  // Required by @wwdrew/expo-spotify-sdk for App Remote IPC sessions.
  // Lets AppRemote.connect(accessToken) bind to the user's running Spotify app
  // for low-latency play/pause/skip without going through the Web API.
  // Users will need to re-authorize Spotify after this scope is added.
  'app-remote-control',
] as const;

function readClientId(): string {
  const id = Constants.expoConfig?.extra?.spotify?.clientId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      'Spotify Client ID is missing from app.json (expo.extra.spotify.clientId)'
    );
  }
  return id;
}

export const spotifyConfig: SpotifyConfig = {
  clientId: readClientId(),
  // Custom scheme registered in app.json: `songsterv2://`. The same value is
  // registered in the Spotify Dashboard under Redirect URIs.
  redirectUri: 'songsterv2://redirect',
  scopes: SCOPES,
};
