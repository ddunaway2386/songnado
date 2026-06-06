# Songnado — Spotify Extended Quota Mode (EQM) application content

**Draft date:** 2026-05-27
**Status:** First draft for review. Privacy policy needs a public URL before submission; demo video deferred (per Daniel — gameplay needs more polish first).

> Form-field shapes are inferred from Spotify's current EQM application flow. Reword to fit actual form labels at submission time.

---

## 1. App description (short — for in-form text fields)

Songnado is a music-trivia party game for iOS and Android. Two to eight players sit around the host's phone; the host connects their Spotify Premium account and selects a playlist (their own, or one of Songnado's curated public playlists). For each round the app plays a short, random ~30-second window from a randomly selected track in that playlist, and players race to identify the song title and artist before time runs out. Songnado awards points, runs the scoreboard, and supports three game modes — Classic (first to target score), Blitz (speed-bonus scoring), and Elimination (clear every playlist).

Songnado is a Spotify Connect remote control plus a local game-logic layer. It never downloads, caches, redistributes, or processes audio. The user's official Spotify app on a device they already own plays all audio at all times. Songnado has no backend — the app is fully client-side, with OAuth tokens stored in OS-level secure storage (iOS Keychain / Android Keystore via Expo SecureStore).

---

## 2. Use-case justification (the substance of the application)

### 2.1 What Songnado is and how it works

Songnado is a consumer mobile app, planned for App Store and Google Play launch within the next quarter, built in Expo / React Native. The product is a music-trivia party game in the lineage of Heads Up! and SongPop, designed for in-person social play around a single host's phone.

A typical session:

1. Host opens the app, taps "Connect Spotify," authenticates via Spotify (PKCE OAuth, no client secret in the app).
2. App calls `GET /v1/me` to confirm Premium status. Free users see a friendly conversion screen instead of the playlist picker, but their connection is preserved for later upgrade.
3. Host picks a playlist from a unified picker that lists their own Spotify playlists alongside Songnado's curated public playlists and a handful of Deezer-powered demo packs.
4. App selects a random track from the playlist and starts playback at a random millisecond offset on the host's active Spotify device.
5. After ~30 seconds the app issues a pause; the reveal screen displays the track metadata (title, artist, album cover) with "Powered by Spotify" attribution.
6. Players claim points; round advances to the next track.

The Spotify Premium user's existing subscription drives all audio. Songnado neither hosts, caches, transcodes, nor otherwise touches the audio stream.

### 2.2 Spotify Web API surface used

**OAuth scopes** (verbatim from `lib/spotify/config.ts`):

| Scope | Why Songnado needs it |
|---|---|
| `user-read-private` | Confirm Premium (`product` field on `/v1/me`) at connect; show "Connected as &lt;name&gt;" in the UI. |
| `playlist-read-private`, `playlist-read-collaborative` | Populate the in-game picker with the user's playlists. |
| `user-modify-playback-state` | Start playback, pause, skip to next track, set shuffle, transfer playback to a target device, set device volume. |
| `user-read-playback-state` | Read currently-playing track metadata for the reveal screen; list available devices; detect the active device for wake-up recovery. |

Songnado does NOT request `user-read-email`, `user-read-currently-playing` (covered by `user-read-playback-state`), `user-library-*`, `user-top-read`, `user-read-recently-played`, `streaming`, `app-remote-control`, or any modify-library scopes.

**Endpoints called per session:**

- `GET /v1/me` — once on connect (Premium detection).
- `GET /v1/me/playlists` — once on connect; refresh on user action.
- `GET /v1/playlists/{id}/tracks` — once per playlist selection, to pick a random track and starting offset. **Currently blocked in dev mode — a primary reason for this application.**
- `GET /v1/playlists/{id}` — to display playlist name, image, and track count in the picker. **`tracks.total` currently stripped in dev-mode responses — a secondary reason for this application.**
- `PUT /v1/me/player/play` — once per round (with a `context_uri` + offset for live playlists, or with a single-track URI plus `position_ms` for the curated-playlist path).
- `PUT /v1/me/player/pause` — used by the explicit-stop control (the 30-second round timer currently does NOT auto-pause, because doing so causes iOS to suspend the Spotify app and break the next round).
- `POST /v1/me/player/next` — used as the progression mechanism for live Spotify playlists (workaround for the blocked `/tracks` endpoint).
- `PUT /v1/me/player/shuffle` — enabled at the start of each live Spotify playlist (part of the `/tracks` workaround).
- `PUT /v1/me/player/repeat` — set to `'off'` in the per-round preload setup so the random-window playback isn't trapped in a repeat-track loop. Idempotent; no other repeat states used.
- `PUT /v1/me/player/seek` — currently defined as a building block but not in the active playback path (the random-window seek is achieved via `PUT /v1/me/player/play` with `position_ms` instead). Listed for completeness; may be used in future polish.
- `GET /v1/me/player/currently-playing` — once per round, to populate the reveal-screen metadata after the workaround flow registers the chosen track.
- `GET /v1/me/player/devices` — to enumerate the user's signed-in devices and prefer the user's phone (avoids audio routing to stale browser Web Player sessions).
- `PUT /v1/me/player` — to transfer playback to the user's phone when an iOS-induced dormant-session error (`502` / `500` / `404`) requires a wake-up.
- `PUT /v1/me/player/volume` — present in the codebase as a fallback for a "silence between rounds" strategy; in practice this call is a no-op on the user's primary iOS Spotify client (the API returns success but the device ignores the volume change), so the strategy is not active today. Disclosed for completeness.

**Endpoints Songnado does NOT call** (worth listing explicitly to scope the request):

- No catalog search (`/v1/search`).
- No recommendations engine (`/v1/recommendations`).
- No audio analysis (`/v1/audio-features`, `/v1/audio-analysis`).
- No user-listening-history endpoints (`/v1/me/top/*`, `/v1/me/player/recently-played`).
- No library / save endpoints, with one possible exception: `PUT /v1/me/playlists/{id}/followers` to let users one-tap follow Songnado's own curated public playlists. No saves of arbitrary content on the user's behalf.
- No artist/track follow endpoints.
- No user-data export.

### 2.3 Why Songnado needs Extended Quota Mode

Three concrete blockers, all caused by the November 2024 dev-mode policy change:

**(a) `GET /v1/playlists/{id}/tracks` returns 403 for dev-mode apps.** This is the spine of Songnado's intended architecture: pick a random index in the playlist, call `play` with that track's URI plus a random millisecond offset, pause at +30 s, advance on player action. Without access to the tracks endpoint, Songnado has no track URIs, no IDs, no album/duration metadata, and no way to address tracks individually. The app currently works around this by starting the playlist as a Spotify context with shuffle enabled and using `POST /v1/me/player/next` for progression — ceding control of track order to Spotify's shuffle algorithm. This workaround introduces real, user-visible problems:

  - **Repeat tracks within a session.** Spotify shuffle can revisit a track that's already been played; users see "didn't we just have this song?" with no recourse. Songnado cannot detect or skip the duplicate because it doesn't have the upstream track list to compare against.
  - **Metadata can't be pre-loaded for the reveal screen.** The reveal-screen UI must wait for `currently-playing` to populate after the track begins playing — producing a brief audible blip during preload that all our playtesters notice.
  - **Round count is unbounded.** Without knowing the track list, Songnado can't tell the user "5 tracks left in this playlist." Game pacing for Elimination mode (where each playlist must be cleared) is hobbled.

  Restoring `GET /v1/playlists/{id}/tracks` would let Songnado return to the deterministic gameplay architecture it was designed around.

**(b) `tracks.total` is stripped from `/v1/me/playlists` and `/v1/playlists/{id}` responses for dev-mode apps.** The playlist picker today cannot display real track counts for the user's own Spotify playlists. Songnado falls back to a `100` sentinel and the literal string "shuffled" instead of an honest count — a regression compared to the Deezer side of the same picker, which shows real numbers. Users have flagged this as looking broken.

**(c) The five-tester cap blocks family-scale playtesting.** Daniel's immediate household includes six Spotify accounts that actively playtest Songnado (himself plus five family members across two households). Since Spotify tightened the cap in February 2026, every playtest session requires rotating accounts in and out of the allowlist, which fragments the playtest signal. Songnado is built specifically for in-person family and party play, so household-scale continuous playtesting is core to development.

### 2.4 Compliance commitments

Songnado will, before public launch and on an ongoing basis:

- Follow Spotify's Branding Guidelines: Spotify logo on the connection screen and on every UI surface that initiates Spotify playback, at minimum size with safe-space padding; no use of "Spotify" in the app name or marketing copy; "Powered by Spotify" attribution on the reveal screen and the Spotify connection settings screen.
- Never download, cache (beyond what the OS does for in-flight HTTP), redistribute, transcode, or process Spotify audio outside the official Spotify client.
- Never use Spotify content to train machine-learning models.
- Never sell or share Spotify-derived data with third parties.
- Never use Spotify content in non-interactive contexts, commercial broadcasts, or in-store / out-of-home environments.
- Render track metadata (title, artist, album, cover art) verbatim with Spotify attribution.
- Keep all curated "Songnado Official" playlists as standard public playlists on a Songnado-owned Spotify account, opt-in followed by users via `PUT /v1/me/playlists/{id}/followers`. Songnado will not re-aggregate or rehost playlist contents.
- Maintain a public privacy policy (draft in §3 below) and link to it from the app and the App Store / Play Store listings.

### 2.5 Commercial model

Songnado is a freemium consumer app. Spotify connection and Spotify-driven gameplay are **free for all users at all subscription tiers** — only Songnado-side features (additional game modes, additional curated playlists, unlimited custom playlists, session resume, extended stats) sit behind a Premium tier ($4.99/mo, $29.99/yr, $79.99 lifetime). Songnado's commercial model never gates or paywalls access to the user's own Spotify content.

---

## 3. Privacy policy (to host publicly before submission)

> Host this at a stable URL (e.g. `https://ddunaway2386.github.io/songnado/privacy/` via GitHub Pages, or a dedicated `songnado.app/privacy` page once that domain exists). Paste the URL into the EQM form and into the App Store / Play Store listings.

---

### Privacy Policy for Songnado

**Effective date:** [INSERT WHEN PUBLISHED]
**Last updated:** [INSERT WHEN PUBLISHED]

This Privacy Policy describes how Songnado ("we," "us," or "the app") handles information when you use our mobile app on iOS or Android.

#### The short version

Songnado is a music-trivia party game. **We do not run any backend server.** We do not collect, store, transmit, sell, or share your personal information with anyone, ever. Everything Songnado creates while you use it stays on your device. When you connect a third-party music service (Spotify) or play demo content (Deezer), those services have their own privacy practices, linked below.

#### 1. Information processed by Songnado

| What | Where it lives | Why |
|---|---|---|
| Your Spotify display name, username, email, country, and Premium-status flag | In memory while the app is open; **never transmitted to us** | Displayed on the "Connected as …" screen after authentication; used to gate Premium-only Spotify playback. |
| Spotify OAuth access and refresh tokens | iOS Keychain or Android Keystore on your device, via Expo SecureStore | Used to make Spotify Web API calls on your behalf. Never transmitted to any Songnado server (we have none). |
| Your Spotify playlist names, descriptions, IDs, and cover images | In memory while the app is open; not persisted | Shown in the in-app playlist picker. |
| Game scores, app settings, custom playlist URLs | Local AsyncStorage on your device | So your last game's setup, scoreboard, and custom playlists persist between sessions. |
| Crash and performance data | None collected | If this changes (for example, if we add Sentry), this policy will be updated and an in-app opt-out provided. |
| Advertising identifiers | None collected | Songnado contains no ads and uses no advertising SDKs. |

We do not place cookies (the app is native, not a web view). We do not run analytics. We do not use trackers. We do not embed third-party SDKs other than the music providers listed below.

#### 2. Third-party services

When you use Songnado, the following third-party services may process your data under their own privacy policies:

- **Spotify** — When you connect a Spotify account, you authenticate directly with Spotify; Songnado never sees your Spotify password. Spotify processes your account profile, playlist access, playback control, and any data it collects about your use of the Spotify client itself. See Spotify's Privacy Policy: https://www.spotify.com/legal/privacy-policy/
- **Deezer** — The in-app demo packs play 30-second preview clips served from Deezer's public preview URLs. No Deezer account is required; Deezer does not receive identifying information about you from Songnado. See Deezer's Privacy Policy: https://www.deezer.com/legal/personal-datas

#### 3. Children

Songnado is rated for general audiences and is not directed at children under 13. We do not knowingly collect any data about children under 13.

#### 4. Your rights and how to delete your data

Because Songnado does not store your data on any server we control, there is nothing for us to export or delete on your behalf. To remove all data the app holds on your device:

1. In Songnado, sign out of Spotify (clears OAuth tokens from secure storage).
2. Uninstall the app (clears all AsyncStorage data).

To independently revoke Songnado's access to your Spotify account, visit https://www.spotify.com/account/apps/ and click "Remove access" next to Songnado.

#### 5. Security

OAuth tokens are stored using your operating system's hardware-backed secure storage (iOS Keychain or Android Keystore, via Expo SecureStore). Songnado uses PKCE OAuth, so no client secret is ever shipped with the app. Because Songnado operates no backend, we have no servers that can be breached.

#### 6. Changes to this policy

If this policy changes materially, we will update the "Last updated" date above and surface a notice in the app on the next launch after the change.

#### 7. Contact

Daniel Dunaway
Email: [CHOOSE ONE: `ddunaay@gmail.com` (personal) or `danieldunaway@idocdata.com` (Apple Dev)]
GitHub: https://github.com/ddunaway2386/songnado

---

## 4. Open items before submission

- [ ] **Privacy policy URL.** Pick a host (GitHub Pages from `ddunaway2386/songnado` is the cheapest path). Publish and paste URL into EQM form + App Store listing.
- [ ] **Contact email choice.** `ddunaay@gmail.com` vs `danieldunaway@idocdata.com` — recommend the gmail for public-facing privacy contact (cleaner, separate from Apple Dev billing).
- [ ] **Demo video.** Deferred per current plan; revisit once Skip-song bug is fixed and picker polish is shipped, so the recorded gameplay isn't visibly buggy.
- [x] **Verify scope list against the actual code.** Audited 2026-06-05 against `lib/spotify/config.ts` at commit `037c1cc`. All five draft scopes match exactly: `playlist-read-private`, `playlist-read-collaborative`, `user-read-private`, `user-modify-playback-state`, `user-read-playback-state`. `app-remote-control` confirmed removed (was the App Remote spike on `@wwdrew/expo-spotify-sdk`, abandoned per the dormancy research brief).
- [x] **Confirm endpoint list against code.** Audited 2026-06-05 against `lib/spotify/playback.ts` + `lib/providers/spotify.ts` at commit `037c1cc`. Two endpoints added since the original draft: `PUT /v1/me/player/repeat` (round-preload setup) and `PUT /v1/me/player/seek` (defined but not currently in the active playback path). Both added to §2.2 above.
- [ ] **Curated-playlist follow endpoint.** Decide whether `PUT /v1/me/playlists/{id}/followers` is in or out of v1 scope; remove from §2.2 / §2.4 if Phase C.4.5 is deferred past launch.
- [ ] **App Store / Play Store launch dates.** Spotify may ask. If unknown, "Q3 2026" is fine.
- [ ] **Spotify Dashboard fields.** Make sure App Description in the Spotify Dashboard matches §1 of this draft before opening the EQM form.
