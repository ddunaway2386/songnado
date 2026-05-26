# Spotify Integration Plan

Companion to `MIGRATION_PLAN.md`. Covers adding Spotify as a music provider alongside the existing Deezer one.

---

## Decisions locked in (don't re-litigate)

- **App name**: Songnado (was Tunehunch through May 25; locked May 25 after Spotify Dashboard rename)
- **Bundle ID**: `com.ddunaay.songster` (internal; never user-visible)
- **Spotify Client ID**: `7c5ac99bc5ef4bcd91a85391baab71b1` (treat as semi-public — embedded in client)
- **Client Secret**: rotated post-preview-check; will live only on user's machine (never needed client-side anyway since we use PKCE)
- **Spotify scheme planned**: `songsterv2://redirect` (already configured in `app.json`)
- **`preview_url` is null** for this app per Spotify's late-2024 restriction on new apps. Confirmed via API test.

This forces the **Spotify iOS SDK path** (App Remote), not the simpler preview-URL pattern Deezer uses.

---

## Architecture

### The two playback modes the app will support

| Provider | Auth | Playback | Audience | When loaded |
|---|---|---|---|---|
| **Deezer** | None (public API) | 30s preview MP3 via `expo-audio` | Anyone | Existing built-in starter packs + URL-added playlists |
| **Spotify** | OAuth via Spotify app | Full track via App Remote SDK | Spotify Premium users | After user taps "Connect Spotify" |

### Provider abstraction (already in place after Phase B refactor)

```
lib/providers/
  types.ts          // ProviderClient interface
  deezer.ts         // existing
  spotify.ts        // new — implements ProviderClient
  index.ts          // router
```

The existing `ProviderClient` covers metadata (`getPlaylistMeta`, `getTrackAtIndex`, `extractPlaylistId`). For Spotify we need to extend it with playback control because Spotify tracks don't have a fetchable URL — they need to be played via the SDK.

**Architectural addition** (Phase C.0):

```ts
interface PlayableTrackHandle {
  provider: ProviderId;
  // For Deezer: a preview URL the audio player can stream directly
  previewUrl?: string;
  // For Spotify: a track URI the SDK will play, plus duration so we can pick a random window
  spotifyUri?: string;
  durationMs?: number;
}

interface Song {
  title: string;
  artist: string;
  coverUrl: string;
  handle: PlayableTrackHandle;  // replaces the current `previewUrl: string`
}
```

Plus a unified playback interface the game screen calls:

```ts
interface Player {
  play(handle: PlayableTrackHandle, opts?: { startMs?: number; durationMs?: number }): Promise<void>;
  pause(): Promise<void>;
  isPlaying: boolean;
  currentTimeMs: number;
}
```

`useDeezerPlayer()` wraps `expo-audio` (today's behavior).
`useSpotifyPlayer()` wraps the Spotify App Remote SDK.
`useUnifiedPlayer()` picks one based on the active track's provider.

### Random-window playback (the gameplay upgrade)

With full-track access via SDK, instead of always playing seconds 0–30, we play a random 30-second window from anywhere in the song:

```ts
const startMs = Math.floor(Math.random() * (durationMs - 30_000));
spotify.playerApi.play(uri, { startMs });
// Schedule pause at startMs + 30_000
```

This is meaningfully harder than the preview pattern — chorus is more likely to surface than the intro. We could expose this as a "Hard mode" toggle, or make it the default for Spotify-backed playlists since it's a feature unlocked by the upgrade.

---

## Library choice — REVISED

After investigating current options (May 2026):

- **`@wwdrew/expo-spotify-sdk`** is the only actively-maintained Expo Spotify library, but it's auth-only — no playback control
- **`react-native-spotify-remote`** has playback but is stale + likely broken under new architecture
- **Writing a custom App Remote native module** = 1–2 days of Swift work

**Decision: skip native SDKs entirely. Use the Spotify Web API + Spotify Connect for everything.**

This is pure HTTP + JS:
- `expo-auth-session` for OAuth (PKCE flow, no client secret in app)
- `expo-secure-store` for access/refresh token storage
- Web API for metadata (`/me/playlists`, `/playlists/{id}/tracks`)
- **Spotify Connect via Web API for playback** (`PUT /me/player/play` with `uri` + `position_ms`, etc.)

### Trade-offs

| | Native SDK (App Remote) | Web API + Spotify Connect |
|---|---|---|
| Native module | Required (Swift) | None |
| EAS Build risk | High | None |
| Library maintenance risk | High | None |
| Latency per play/pause | ~50ms | ~200ms (negligible for 30s game) |
| User UX prerequisite | Spotify app installed | Spotify app installed + active session |
| Cross-platform | iOS-only without more native work | iOS + Android free |
| Time to ship | 3+ days | ~2 days |

### One UX wrinkle: "active device"

Spotify Connect playback requires the user to have an **active Spotify device** (their phone with Spotify running at least once that session, or a connected speaker). If they haven't opened Spotify today, the first `PUT /me/player/play` returns a 404 "No active device."

Mitigation: on the first play attempt of a session, if we detect this error, show a friendly modal:
> *"Open Spotify briefly, play any song, then come back to Songnado. We just need to wake up your Spotify connection."*

After that one-time wake-up, the session stays active for hours. Acceptable friction.

---

## Phases

### Phase C.0 — Foundation (½ day)

- [ ] Install `expo-auth-session` + `expo-crypto` (PKCE OAuth)
- [ ] Install `expo-secure-store` (token storage)
- [ ] Add Spotify Client ID to app config via `extra` in `app.json`, read at runtime
- [ ] Update `app.json` to make sure the `scheme` (`songsterv2`) is registered for redirect URI handling
- [ ] Add `https://accounts.spotify.com` to any future security headers we might add
- [ ] Verify typecheck + tests pass after install (no native deps means low risk)

### Phase C.1 — Auth flow (½ day)

- [ ] `lib/spotify/auth.ts` — wraps `expo-auth-session` for PKCE auth flow
- [ ] `lib/spotify/api.ts` — token-bearing `fetch` wrapper, auto-refresh on 401
- [ ] `stores/spotifyStore.ts` — Zustand store: connection state, tokens (in secure store), user profile
- [ ] Secure token storage via `expo-secure-store` (access + refresh tokens)
- [ ] `Connect Spotify` button on setup screen — opens Spotify OAuth, returns with token
- [ ] Connection state UI: "Connected as <username>" with disconnect option

### Phase C.2 — Spotify provider implementation (½ day)

- [ ] `lib/providers/spotify.ts` — implements `ProviderClient`
  - `getPlaylistMeta(id)` — `GET /v1/playlists/{id}`
  - `getTrackAtIndex(id, i)` — `GET /v1/playlists/{id}/tracks?offset={i}&limit=1` (returns track WITHOUT previewUrl, with spotifyUri + durationMs)
  - `extractPlaylistId(input)` — parses `open.spotify.com/playlist/{id}` URLs
- [ ] `lib/providers/spotify.ts` exports `listUserPlaylists()` — `GET /me/playlists` for showing user's library
- [ ] Update provider registry to include Spotify
- [ ] Token-bearing fetch wrapper that auto-retries on 401

### Phase C.3 — Song type + Player abstraction (½ day)

- [ ] Migrate `Song` type to carry `PlayableTrackHandle` instead of bare `previewUrl`
- [ ] Update all callers (small — few places construct `Song`)
- [ ] `hooks/usePlayer.ts` — unified player that dispatches to Deezer or Spotify based on `handle.provider`
- [ ] Game screen swaps `useAudioPlayer` → `usePlayer`

### Phase C.4 — UI integration (1 day)

- [ ] Setup screen: new section "Your Spotify Playlists" appears after connection
- [ ] Show user's playlists alongside built-in Deezer ones, with provider badge
- [ ] Selectable multi-select works the same as Deezer playlists
- [ ] Game flow unchanged — the player abstraction handles provider differences transparently
- [ ] Show "Spotify Premium required" gate gracefully if user is Free tier
- [ ] Show "Install Spotify" prompt if app not installed

### Phase C.5 — Random-window playback + active-device UX (½ day)

- [ ] When playing a Spotify track, compute `startMs = random(0, durationMs - 30_000)`
- [ ] `PUT /v1/me/player/play` with `{ uris: [trackUri], position_ms: startMs }`
- [ ] Schedule pause at `startMs + 30_000` via `PUT /v1/me/player/pause`
- [ ] Handle 404 "No active device" gracefully — show "wake up Spotify" modal
- [ ] (Optional) UI badge "playing from 1:23" so host knows the slice

**Total: ~2 focused days** to ship Spotify integration end-to-end (down from 3+ thanks to skipping native SDKs).

---

## Open questions / decisions for later

1. **Free vs Premium app tiers**: How is Spotify integration gated in the app?
   - Recommended: free tier uses Deezer starter packs only; "Songnado Pro" unlocks Spotify connect
   - Pricing: $4.99/mo or $24.99 lifetime — to be decided
2. **Deezer starter packs strategy**: keep them (with licensing risk) or replace with curated Spotify-hosted "Songnado Official" playlists once Spotify is wired
3. **Apple MusicKit as a third provider**: parallel iOS-only path for Apple Music users. Phase D candidate.
4. **Android**: Spotify also has an Android SDK. Adding Android = doubling native module work. Defer until iOS is shipped and stable.

---

## Risks

- **Spotify Dev Mode 5-tester cap (Feb 2026 change)** — must explicitly add each tester (including your sons) in the Spotify Dashboard under User Management. For wider beta, apply for "Extended Quota Mode" (~2-week approval).
- **"No active device" on first play** — handled by the wake-up modal. One-time friction per session.
- **Token expiry mid-game** — access tokens last 1 hour. Mitigation: refresh in background using the stored refresh token; the auto-refresh API wrapper handles this transparently.
- **User has no Spotify Premium** — Web API playback endpoints return 403. Show clear "Spotify Premium required" message; let them keep using the Deezer free tier.
- **User doesn't have Spotify app installed** — show "Install Spotify" prompt linking to App Store before attempting OAuth.
- **Spotify rate limits** — generous in dev mode, sufficient for our use case. No mitigation needed.
