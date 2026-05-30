# Curated Playlists — pre-bake design

**Status:** design only, no code yet
**Author/date:** 2026-05-28 (laptop session)
**Related:** [`SPOTIFY_INTEGRATION_PLAN.md`](./SPOTIFY_INTEGRATION_PLAN.md) (Phase C.4.5), [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md) (Free/Pro tiering)

---

## 1. Why this design exists

Spotify's November 2024 dev-mode policy blocks `GET /v1/playlists/{id}/tracks` and strips `tracks.total` from playlist responses. Today this forces the "context + shuffle + skipToNext" workaround in [`lib/providers/spotify.ts`](./lib/providers/spotify.ts) — Spotify owns the playback order, we don't get track URIs ahead of time, and the user sees duplicates and a metadata-loading blip on every round.

Extended Quota Mode would lift these restrictions, but approval is 2–4 weeks and not guaranteed. **Songnado's launch should not depend on EQM.**

The pre-bake approach: for the 6 launch curated playlists (see [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md)), fetch the track list **once at curation time** from outside the dev-mode-restricted app, ship the resulting URI list as a JSON file in the app bundle. The client never calls `/tracks`. At runtime the client picks a URI, calls `PUT /me/player/play` with that URI and a random `position_ms`, plays for 30 seconds, pauses. Both of those endpoints work fine under dev mode.

Result: a complete, polished Songnado experience that works **today**, for any user with Spotify Premium, without any EQM dependency. User-imported Spotify playlists remain the live-API path (with the existing workaround) and become a Premium "coming soon" feature gated on EQM approval, framed as a feature add rather than a hole.

## 2. The seams already fit

Reading the existing code, the abstraction is already well-shaped for this:

- [`lib/providers/types.ts`](./lib/providers/types.ts): `ProviderClient.getTrackAtIndex(playlistId, index): Promise<Song | null>`. For curated playlists this is a one-line lookup into the pre-baked array.
- [`stores/playlistStore.ts`](./stores/playlistStore.ts) `fetchNextPlayableTrack`: already calls `pickNextIndex` (which uses `playedIndices` + `totalTracks`) then `provider.getTrackAtIndex`. With a real `totalTracks` and an honest `getTrackAtIndex`, **the rotation store automatically gives us non-repeating tracks within a playlist** — no extra dedup logic needed.
- [`lib/playlists.ts`](./lib/playlists.ts) (SEED_PLAYLISTS) already supplies built-in playlists at hydration via `mergeSeeds`. Curated playlists are app-static, so they slot into this same pattern.
- [`hooks/usePlayer.ts`](./hooks/usePlayer.ts) already calls `playUri(spotifyUri, {positionMs})` for Spotify-sourced songs. With a real URI from the pre-bake, this path Just Works — no context-play, no shuffle, no skipToNext, no preload blip.

Almost nothing in the existing player/game/store layer changes. The work is concentrated in three places: a new provider variant, the data files, and a curation script.

## 3. Data model

### 3.1 Per-playlist JSON file

One file per curated playlist, shipped as a bundled asset.

```json
{
  "id": "songnado-2010s-hits",
  "name": "2010s Hits",
  "imageUrl": "https://i.scdn.co/image/ab67616d000048510...",
  "tier": "free",
  "version": 1,
  "tracks": [
    {
      "uri": "spotify:track:7qiZfU4dY1lWllzX7mPBI3",
      "title": "Shape of You",
      "artist": "Ed Sheeran",
      "albumImageUrl": "https://i.scdn.co/image/...",
      "durationMs": 233713
    }
  ]
}
```

Field notes:
- `id`: opaque string, prefixed `songnado-` to avoid colliding with real Spotify playlist IDs (which are base62 22-char). We control these.
- `tier`: `'free' | 'pro'`. Drives Premium-Songnado gating in the picker.
- `version`: integer. Bumped when the curator regenerates the file. Lets us OTA-update playlists via Expo Updates without an App Store release, and lets a future cache layer notice when data has changed.
- `tracks[].uri`: full Spotify track URI (not bare ID). Passed directly to `playUri`.
- `tracks[].title` / `artist`: for the reveal screen. No need to fetch from `currently-playing` after play.
- `tracks[].albumImageUrl`: for the reveal screen artwork. Optional — falls back to playlist `imageUrl` if missing.
- `tracks[].durationMs`: required for `pickRandomStartMs`. Without this we'd have to fall back to a conservative random window (e.g. 0–60s).

Excluded deliberately:
- Album name (not shown in current reveal UI; skip until needed)
- Artist images (not used)
- ISRC / popularity / preview_url / explicit flag (not used for gameplay)

### 3.2 Manifest file

A single `assets/curated/manifest.json` lists all curated playlists. Lets the loader discover them without hardcoding filenames in code.

```json
{
  "version": 1,
  "playlists": [
    { "id": "songnado-2010s-hits",       "file": "songnado-2010s-hits.json" },
    { "id": "songnado-2020s-hits",       "file": "songnado-2020s-hits.json" },
    { "id": "songnado-2000s-hits",       "file": "songnado-2000s-hits.json" },
    { "id": "songnado-80s-90s",          "file": "songnado-80s-90s.json" },
    { "id": "songnado-movie-tv-themes",  "file": "songnado-movie-tv-themes.json" },
    { "id": "songnado-broadway",         "file": "songnado-broadway.json" }
  ]
}
```

### 3.3 Bundle size

Per `MONETIZATION_PLAN.md`, the launch packs total ~1,050 tracks. At ~250 bytes per track in JSON (URI + title + artist + image URL + duration), that's ~260 KB total uncompressed across 6 files, ~80 KB gzipped. Negligible bundle impact.

### 3.4 Storage location

`assets/curated/` at the repo root. Bundled by Expo automatically. Loaded via `expo-asset` at app init (or lazy-loaded on first picker open — see §4.2).

## 4. Code seams

### 4.1 New provider: `curatedSpotifyProvider`

A second `ProviderClient` implementation alongside `spotifyProvider`. Same playback path (Spotify Connect via `playUri`), different data source (pre-baked JSON vs live Web API).

```ts
// lib/providers/curated.ts
import type { PlaylistMeta, Song } from '../types';
import type { ProviderClient } from './types';
import { getCuratedPlaylist } from '../curated/loader';

export const curatedSpotifyProvider: ProviderClient = {
  id: 'curated',  // <-- new ProviderId value
  displayName: 'Songnado',

  async getPlaylistMeta(playlistId) {
    const data = await getCuratedPlaylist(playlistId);
    return {
      id: data.id,
      name: data.name,
      imageUrl: data.imageUrl,
      totalTracks: data.tracks.length,
    };
  },

  async getTrackAtIndex(playlistId, index) {
    const data = await getCuratedPlaylist(playlistId);
    const track = data.tracks[index];
    if (!track) return null;
    return {
      title: track.title,
      artist: track.artist,
      previewUrl: '',
      coverUrl: track.albumImageUrl ?? data.imageUrl,
      spotifyUri: track.uri,
      durationMs: track.durationMs,
    };
  },

  extractPlaylistId(input) {
    // Curated playlists aren't user-pasted, so we never need to parse a URL.
    // Throwing here surfaces caller bugs (Add-Playlist UI should never reach this).
    throw new Error('Curated playlists are app-managed and cannot be added by URL.');
  },
};
```

### 4.2 Loader

```ts
// lib/curated/loader.ts
import { Asset } from 'expo-asset';

import manifest from '../../assets/curated/manifest.json';

export interface CuratedTrack {
  uri: string;
  title: string;
  artist: string;
  albumImageUrl?: string;
  durationMs: number;
}
export interface CuratedPlaylistData {
  id: string;
  name: string;
  imageUrl: string;
  tier: 'free' | 'pro';
  version: number;
  tracks: CuratedTrack[];
}

const cache = new Map<string, CuratedPlaylistData>();

export async function getCuratedPlaylist(id: string): Promise<CuratedPlaylistData> {
  const cached = cache.get(id);
  if (cached) return cached;
  const entry = manifest.playlists.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown curated playlist: ${id}`);
  // For an in-bundle JSON file, `require` returns the parsed object directly
  // under Metro's bundling. (Asset.fromModule path is only needed for images.)
  const data = require(`../../assets/curated/${entry.file}`) as CuratedPlaylistData;
  cache.set(id, data);
  return data;
}

export function listCuratedPlaylists(): { id: string; tier: 'free' | 'pro' }[] {
  // Read-only metadata for the picker; full data loaded lazily on play.
  return manifest.playlists.map((entry) => {
    const data = require(`../../assets/curated/${entry.file}`) as CuratedPlaylistData;
    return { id: data.id, tier: data.tier };
  });
}
```

Note: Metro statically analyzes `require` calls, so the literal-template `require(\`./../../assets/curated/${entry.file}\`)` form works only if all candidate files are reachable at build time. The implementation will need to either:
- Use a `require.context`-style map (cleaner), or
- Hardcode an `id -> require()` map in the loader (less elegant but reliable on all Metro versions).

The hardcoded-map approach is simpler and avoids Metro edge cases:

```ts
const playlistData: Record<string, () => CuratedPlaylistData> = {
  'songnado-2010s-hits':       () => require('../../assets/curated/songnado-2010s-hits.json'),
  'songnado-2020s-hits':       () => require('../../assets/curated/songnado-2020s-hits.json'),
  // ...
};
```

### 4.3 `ProviderId` extension

Add `'curated'` to `ProviderId`:

```ts
// lib/types.ts
export type ProviderId = 'deezer' | 'spotify' | 'curated';
```

This is a typescript-only change; the runtime impact is limited to the provider registry update.

### 4.4 Provider registry

```ts
// lib/providers/index.ts
const providers: Record<ProviderId, ProviderClient | null> = {
  deezer: deezerProvider,
  spotify: spotifyProvider,
  curated: curatedSpotifyProvider,  // <-- new
};
```

### 4.5 Seed playlists

The 6 curated playlists become seeds, merged at hydration like the existing Deezer seeds:

```ts
// lib/playlists.ts (extend SEED_PLAYLISTS or add CURATED_SEEDS)
import { listCuratedPlaylists, getCuratedPlaylist } from './curated/loader';

export function getCuratedSeeds(): Playlist[] {
  return listCuratedPlaylists().map(({ id }) => {
    const data = require_curated_sync(id); // see loader for sync variant
    return {
      id: data.id,
      name: data.name,
      imageUrl: data.imageUrl,
      totalTracks: data.tracks.length,
      provider: 'curated',
      isBuiltIn: true,
      playedIndices: [],
    };
  });
}
```

Merged in `mergeSeeds` alongside `SEED_PLAYLISTS` (Deezer).

### 4.6 Persistence

`partialize` currently filters out `provider !== 'spotify'`. Curated playlists are app-static, so they should persist similarly to Deezer playlists — their `playedIndices` is the meaningful per-user state we want to keep across sessions. Change:

```ts
partialize: (state) => ({
  // Persist Deezer + curated playlists. Live Spotify playlists are
  // account-tied and refetched fresh on each connect.
  playlists: state.playlists.filter((p) => p.provider !== 'spotify'),
  lastMetaRefresh: state.lastMetaRefresh,
}),
```

Already correct — the filter is on `=== 'spotify'`, so `'curated'` passes through. No change needed.

### 4.7 `refreshMeta` and dev-mode workarounds

Curated playlists don't need network refresh — the JSON file is the source of truth. `getPlaylistMeta` in `curatedSpotifyProvider` just reads from the bundled data. `refreshMeta` will safely call it; nothing breaks.

### 4.8 What does NOT change

- [`lib/spotify/playback.ts`](./lib/spotify/playback.ts) — unchanged. Curated playback uses the same `playUri` path.
- [`hooks/usePlayer.ts`](./hooks/usePlayer.ts) — unchanged. Branches on `song.spotifyUri`, which curated tracks have.
- [`app/game.tsx`](./app/game.tsx) — unchanged.
- [`lib/spotify/auth.ts`](./lib/spotify/auth.ts) / [`stores/spotifyStore.ts`](./stores/spotifyStore.ts) — unchanged. Curated playback still requires a connected Spotify Premium session.
- [`lib/rotation.ts`](./lib/rotation.ts) — unchanged. The existing `selectNextIndex` does exactly what curated playlists need.

## 5. Curation pipeline (operational, not in-app)

The hard problem: how does Daniel actually produce `songnado-2010s-hits.json`? Dev-mode blocks `/playlists/{id}/tracks` from the Songnado app's credentials, so we can't fetch from inside the app or from a Node.js script using Songnado's client ID.

Three viable paths, in order of preference:

### 5.1 Recommended: Spotify Web Player export via Exportify

[Exportify.net](https://exportify.net/) is an open-source web app that exports Spotify playlists to CSV using **the user's own login** (not a third-party developer app). It uses OAuth against Spotify's API on the user's behalf — Daniel logs in as himself, picks his curated playlist, gets a CSV of every track with URI, title, artist, album, duration, etc.

Workflow:
1. In Spotify, Daniel curates the playlist as a public playlist on his account.
2. Open Exportify, log in, click Export on the playlist → CSV download.
3. Run a local Node.js script (~50 lines) that converts CSV → the JSON shape from §3.1.
4. Drop the JSON into `assets/curated/`, update the manifest.
5. Commit, rebuild, ship.

One-time work per playlist. ~10 minutes including review. Total launch effort: ~1 hour for 6 playlists, plus the curation work itself (4–6 hr per pack per [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md)).

Risk: Exportify is third-party. If it goes down or breaks, fall back to (5.3).

### 5.2 Fallback: third-party desktop tools

Tools like Soundiiz and TuneMyMusic export Spotify playlists to various formats. Most have a free tier sufficient for 6 playlists. Same workflow as 5.1 with a different export tool.

### 5.3 Manual via Spotify Web Player → script-assisted

Open the playlist in Spotify Web Player, view source / use the network tab to capture the response from the Web Player's internal API (which uses session cookies and hits a different endpoint that isn't dev-mode-restricted). Parse the response. Tedious — only do this if (5.1) and (5.2) are both unavailable.

### 5.4 Future: post-EQM Node.js script

Once Extended Quota Mode is approved on the Songnado dev app, the right curation pipeline is a small Node.js script using Songnado's own client credentials:

```ts
// scripts/curate.ts
async function curate(playlistUrl: string, outFile: string, tier: 'free' | 'pro') {
  const id = extractPlaylistId(playlistUrl);
  const meta = await spotifyFetch(`/playlists/${id}?fields=id,name,images,tracks(total)`);
  const tracks = await spotifyPaginatedFetch(`/playlists/${id}/tracks`);
  writeJSON(outFile, { id, name: meta.name, imageUrl: meta.images[0].url, tier, version: 1, tracks: tracks.map(toCuratedTrack) });
}
```

Add to `package.json scripts` as `curate`. Daniel runs `npm run curate -- https://... assets/curated/foo.json free`.

This is the long-term answer but doesn't gate launch.

## 6. Premium gating

Per [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md): 2010s Hits is free; the other 5 are Pro.

Two checks:
1. **Spotify Premium check** (existing): all curated playlists require a connected Spotify Premium account to play. Without one, picker shows the Spotify-connect CTA on the playlist tile.
2. **Songnado Pro check** (new, but applies elsewhere too): playlist tiles with `tier: 'pro'` show a lock badge for Free-tier Songnado users; tapping triggers the existing upgrade-trigger flow from MONETIZATION_PLAN.md.

The picker reads `tier` from the playlist metadata. The play-attempt guard hooks into the existing Premium check in the play path.

Neither check is new — both already exist (Premium check in [`stores/spotifyStore.ts`](./stores/spotifyStore.ts), Pro check is part of the unbuilt Phase D). Curated playlists just consume them.

## 7. Phasing

Build order, smallest-first:

1. **Schema + loader** (~1 hr). Create one hand-written JSON file with 10 real tracks for smoke-testing. Build `lib/curated/loader.ts`. Verify `require()`-based loading works in dev client.
2. **Provider + registry wiring** (~1 hr). Implement `curatedSpotifyProvider`. Extend `ProviderId`. Wire into the registry. Add as a seed playlist. Manually verify the picker shows it and `getTrackAtIndex(id, 0)` returns the expected track.
3. **End-to-end gameplay test** (~30 min). Pick the curated playlist, start a game, verify a round plays (specific URI, random window, reveal screen shows pre-baked title/artist with no blip).
4. **Curation pipeline** (~1–2 hr including learning Exportify). Curate one real launch playlist via Exportify, write the CSV→JSON conversion script, generate the JSON, drop in, ship. **At this point one curated launch playlist is real.**
5. **Curate remaining 5** (~1 hr each via Exportify, plus 4–6 hr curation work each per existing plan — that's the long pole).
6. **Premium gating UI** (~1–2 hr). Lock badges on Pro-tier tiles, upgrade-trigger hook. Likely deferred to Phase D when the rest of the Pro UI lands.
7. **OTA updates** (deferred). Use Expo Updates to ship updated `assets/curated/*.json` between App Store releases. Set up post-launch.

Total engineering for steps 1–5: ~1 day. Curation work for 6 playlists at 4–6 hr each: ~30 hr (the actual long pole, which exists regardless of architecture).

## 8. Open questions

- **Does `require('json-file')` reliably load JSON assets in Expo 54 / RN 0.81 New Architecture builds?** Believed yes via Metro's built-in JSON resolver, but worth verifying with a 10-line smoke test before committing the loader pattern. Fallback: use `expo-asset` to load JSON files as bundled assets.
- **Should the curation script also generate the playlist cover image as a bundled asset (vs the current `imageUrl` pointing at Spotify's CDN)?** Tradeoff: bundling avoids a hot-network dependency on first picker render but bloats the app; remote URL keeps the bundle small but breaks if Spotify rotates the CDN URL. Recommend remote URL for v1, revisit if Spotify image URLs prove unstable.
- **Should curated playlists support OTA updates immediately or wait?** Expo Updates is straightforward but adds a runtime check. Recommend ship v1 with bundled-only and add OTA in a v1.1 update once the launch is stable.
- **Premium-required UX on a non-connected user.** Today, picker only shows Spotify playlists when connected. With curated playlists always visible regardless of Spotify state, the tile needs a "Connect Spotify to play" state distinct from "Upgrade to Pro." Worth designing the tile state machine before building (~3 states: needs-Spotify, needs-Pro, ready).
- **Should curated `getPlaylistMeta` ever go remote** (e.g. to update artwork)? No — bundled is the source of truth. Updates ship via OTA or app update.
- **Pre-bake durations for 90s+ guarantee.** Curation rule already says "no tracks under 90s." The `durationMs` in the pre-bake should make this verifiable — the conversion script should fail-loudly on any track <90s rather than silently shipping a too-short track.
- **Empty-playedIndices on first install of an updated playlist version.** When a playlist's `version` field increments (e.g. tracks added/removed), should we reset `playedIndices` for that playlist? Otherwise old `playedIndices` may point at removed tracks. Recommend: yes, reset on version bump. Add a `lastSeenVersion` per playlist in the store, compare on hydrate.

## 9. References

- [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) — Phase 7 polish items
- [`SPOTIFY_INTEGRATION_PLAN.md`](./SPOTIFY_INTEGRATION_PLAN.md) — Phase C.4.5 stub for curated playlists
- [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md) — Free/Pro tier definitions, the 6 launch packs, curation rules
- [`lib/providers/spotify.ts`](./lib/providers/spotify.ts) — live-API Spotify provider (the dev-mode workaround being complemented, not replaced)
- [`lib/providers/types.ts`](./lib/providers/types.ts) — `ProviderClient` interface curated playlists implement
- [`stores/playlistStore.ts`](./stores/playlistStore.ts) — rotation + fetch flow that curated playlists slot into unchanged
- [Exportify](https://exportify.net/) — recommended curation export tool
