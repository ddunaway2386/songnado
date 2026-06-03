# Briefing: Spotify iOS dormancy research for Songnado

**Date:** 2026-06-03
**Purpose:** Hand off to a research agent for deep-dive into options for the iOS Spotify dormancy problem.
**Prepared by:** Claude Sonnet 4.5 (1M context) after a 2-evening App Remote investigation that did not pan out.

---

## What Songnado is

A music-trivia party game for iOS + Android, built in Expo (SDK 55) / React Native 0.83 / React 19.2. The host's iPhone runs Songnado; players gather around it; the app plays ~30-second random windows from songs and players race to guess title + artist. Game modes: Classic, Blitz, Elimination. Solo developer, pre-launch.

**Architecture:** Songnado is a Spotify Connect remote control. It does not host, cache, or stream audio. The user's existing Spotify Premium subscription on their iPhone plays all audio; Songnado just sends play / pause / skip commands via Spotify's Web API. No backend — fully client-side, with OAuth tokens in Expo SecureStore.

**Repo:** `C:\Projects\Songster\songster-v2\` (also at github.com/ddunaway2386/songnado, private).

**Key reference docs in the repo:**
- `MIGRATION_PLAN.md` — migration from FlutterFlow to Expo
- `SPOTIFY_INTEGRATION_PLAN.md` — Spotify integration phases (C.1-C.5 done)
- `MONETIZATION_PLAN.md` — freemium model ($4.99/mo, $29.99/yr, $79.99 lifetime; Spotify free for all)
- `CURATED_PLAYLISTS_DESIGN.md` — the architectural pivot to pre-baked playlist data (built + verified on hardware)
- `drafts/eqm-application.md` — Spotify Extended Quota Mode application content

## The problem we're trying to solve

**iOS Spotify dormancy.** When the Spotify app is backgrounded or not actively playing audio, Web API calls (`PUT /v1/me/player/play`, `PUT /v1/me/player/pause`, etc.) return:
- 404 `NO_ACTIVE_DEVICE`
- 502 Bad Gateway
- Sometimes 500 errors

The user must manually open Spotify and tap play on any song before Songnado can issue commands. Hardware testing on 2026-06-02 confirmed it's stricter than previously documented: **Spotify must be ACTIVELY producing audio**, not just open or paused — open-and-paused Spotify still trips the wake-up requirement.

A secondary problem: Songnado's auto-pause at the 30-second mark is **deliberately disabled** because actually pausing Spotify via Web API causes iOS to dormancy-suspend Spotify, breaking the *next* round's playback. Audio plays through scoring as a result — bad UX. See `hooks/usePlayer.ts:211-294` for the comment cluster explaining this trade-off.

## Other context that's relevant

**Spotify dev-mode restrictions (Nov 2024 policy):**
- `GET /v1/playlists/{id}/tracks` returns 403 for new dev apps
- `tracks.total` is stripped from `/me/playlists` and `/playlists/{id}` responses
- 5-tester cap on the allowlist
- Applying for Extended Quota Mode (EQM) to lift these; submission ready but not yet sent (privacy policy needs hosting); 2-4 week review timeline

**Architectural pivot (verified on hardware this week):** Pre-baked curated playlist data. Track URI + title + artist + duration + image are captured at curation time (via Exportify.net → CSV → JSON) and shipped as JSON in the app bundle (`assets/curated/`). At runtime: pick a URI, call `PUT /me/player/play` with `position_ms`, no `/tracks` dependency. This decouples launch from EQM approval.

**The curated path STILL has the dormancy problem.** The pre-bake fixes the catalog-access problem (no /tracks call needed) but Web API playback still requires an active Spotify device.

## What we tried tonight that did not work

**App Remote spike via `@wwdrew/expo-spotify-sdk` v1.0.0** (the most recent maintained Expo wrapper around the Spotify iOS SDK v5.0.1 + Android SDK v4.0.1).

The thesis: App Remote's IPC channel talks directly to the Spotify app's running process, bypassing the Cloud Connect API. If it worked, `Player.pause()` would be instant + would not trigger iOS dormancy.

Implementation: `app/debug-spotify.tsx` (in repo, on main, commit `bac1fe1`). A debug screen with `AppRemote.connect()`, `Player.play/pause/resume`, and a live event log.

**Every connection attempt failed identically with:**

```
[CONNECTION_FAILED]
  com.spotify.app-remote code -1000 "Connection attempt failed"
  → com.spotify.app-remote.transport code -2000 "Stream error"
  → NSPOSIXErrorDomain code 61 "The operation couldn't be completed. Connection refused"
```

POSIX errno 61 = `ECONNREFUSED` — socket-level refusal at the iOS Spotify app's IPC listener. Fires BEFORE any token or scope validation, so the OAuth side is not the issue.

**All documented prerequisites confirmed satisfied:**

| Prereq | Status |
|---|---|
| Spotify Dev App exists, Client ID `7c5ac99bc5ef4bcd91a85391baab71b1` | ✅ |
| `songsterv2://redirect` registered (Web API PKCE) | ✅ |
| `songsterv2://spotify-app-remote` registered (App Remote SDK init) | ✅ |
| `com.ddunaay.songster` Bundle ID registered in Dashboard | ✅ |
| Dashboard has iOS in "APIs used" | ✅ |
| Premium account | ✅ |
| Token includes `app-remote-control` scope (granted via fresh OAuth after scope added) | ✅ |
| Spotify app actively producing audio at connect time | ✅ |
| Spotify app force-quit + relaunched between attempts | ✅ |

**Four separate attempts at 03:58, 04:05, 04:18:35, 04:18:41 (UTC) — identical error.**

Existing dev environment:
- iPhone (model unknown, recent iOS; user's primary phone)
- EAS dev build of Songnado SDK 55, commit `bac1fe1`
- Spotify iOS app current version (installed, Premium account `dr001382`)

## The strategic question

**How can Songnado deliver a good production UX given that:**
1. App Remote IPC failed even with every documented prerequisite met
2. Web API Spotify Connect requires the Spotify app to be actively playing audio
3. We have no backend (privacy policy commitment) so server-side workarounds are off the table
4. Curated content can ship today but still requires Spotify Connect for playback

## Research directions to investigate

1. **Is `@wwdrew/expo-spotify-sdk` known to have this POSIX 61 bug?** Search the package's GitHub issues + Spotify iOS SDK github for `CONNECTION_FAILED`, `ECONNREFUSED`, `NSPOSIXErrorDomain 61`. Is there a workaround?
2. **iOS 18+ compatibility issues with Spotify iOS SDK 5.x?** Apple changed inter-process communication restrictions in recent iOS versions. Has the Spotify iOS SDK been updated for these? Is there a known gap?
3. **Alternative React Native Spotify SDK packages?** Beyond `react-native-spotify-remote` (dead) and `@wwdrew/expo-spotify-sdk` (failing for us), are there other actively maintained options?
4. **Custom native module wrapping Spotify iOS SDK directly?** Would bypassing the package wrapper change anything? Or is the failure mode at the Spotify-iOS-SDK level itself?
5. **What do production apps that use Spotify Connect do for dormancy UX?** Look at Last.fm, SongPop, MusiXMatch, Heardle clones, etc. Are they hitting the same iOS dormancy issue? What workarounds do they use?
6. **Could we use the Spotify Connect API more cleverly?** E.g., periodic `GET /me/player` polling to keep the session "warm" without triggering audio. Or `PUT /me/player` (transfer playback) with `play: false` as a wake-up that doesn't start audio.
7. **Is there a way to keep Spotify alive via iOS background audio session APIs?** Songnado runs in foreground during play; could it request a background audio mode that keeps Spotify Connect alive?
8. **Apple Music / MusicKit as a parallel provider?** MusicKit on iOS has different dormancy characteristics (it's an Apple framework, not a Cloud Connect remote). Adds iOS-only complexity but might eliminate the problem class for Apple Music subs.
9. **Spotify's own deep-link schemes (`spotify://`) for orchestrating the wake-up.** Can we deep-link into Spotify, force it to start a specific URI, then return to Songnado with the device active? What's the minimum disruption to user flow?
10. **The pre-game wake-up UX pattern.** Even without a technical fix, a well-designed pre-game flow ("Tap to open Spotify and start any song; Songnado will know when you're back") could make the dormancy ritual painless. What does this look like? Detection mechanism?

## What I'd want from the research

- **Confirmed-or-refuted answer on the @wwdrew package POSIX 61 issue.** Open GitHub issue? Closed with workaround? Known bug?
- **Best-case for App Remote on current iOS.** If there's a known path to making it work, what is it?
- **Realistic ranking of alternatives.** For each option in the research directions, what's the effort, what's the payoff, what's the risk?
- **A recommended path forward.** Given Songnado is solo-dev and pre-launch, what's the highest-leverage move?

The output should be opinionated and concrete enough to make a decision from — not just a survey of possibilities.

## Files worth looking at if needed

- `app/debug-spotify.tsx` — the App Remote spike screen (what we tried)
- `lib/spotify/playback.ts` — the existing Web API workaround layer (`withDeviceRecovery`, smartphone-device caching, etc.)
- `lib/providers/spotify.ts` — context+shuffle workaround for the blocked /tracks endpoint
- `hooks/usePlayer.ts` — the unified player hook; comments at lines 211-294 document the dormancy trade-off
- `app/game.tsx` — the gameplay screen; auto-fires play on round start
- `app.json` — config plugins, bundle ID, scheme

If you want code-level grep, the repo is at `C:\Projects\Songster\songster-v2\`.
