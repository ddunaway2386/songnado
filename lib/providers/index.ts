import type { ProviderId } from '../types';
import { curatedSpotifyProvider } from './curated';
import { deezerProvider } from './deezer';
import { spotifyProvider } from './spotify';
import type { ProviderClient } from './types';

/**
 * Provider registry. Add new providers here as they're implemented.
 */
const providers: Record<ProviderId, ProviderClient | null> = {
  deezer: deezerProvider,
  spotify: spotifyProvider,
  curated: curatedSpotifyProvider,
};

/**
 * Look up a provider client by ID. Throws if the provider isn't wired up
 * yet — caller bugs (e.g. routing a Spotify playlist before Spotify is
 * implemented) should surface immediately rather than silently fail.
 */
export function getProvider(id: ProviderId): ProviderClient {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Music provider "${id}" is not configured yet.`);
  }
  return provider;
}

/** True if a provider is wired up and usable. Useful for UI gating. */
export function isProviderAvailable(id: ProviderId): boolean {
  return providers[id] != null;
}

export type { ProviderClient } from './types';
