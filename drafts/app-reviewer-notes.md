# Notes for App Reviewer — Songnado v1

Goes in App Store Connect → App Information → App Review Information →
Notes (free text, 4000 char max).

**Rewritten September 6, 2026.** The previous version was written in June
and told Apple three things that had since become false: that the app
collects no user data (Sentry was added in August), that the picker shows
11 playlists with 4 unlocked (it is 16 with 10 unlocked), and that dead
in-app-purchase placeholders exist in the build (the paywall was removed
in 1.0.3). It also named `p.scdn.co` — **Spotify's** CDN — as the audio
host, in the same document that argues the app never contacts Spotify.

Affirmative misstatements to App Review are worse than saying nothing.
Everything below was checked against the shipping code.

---

## Final text to paste into App Store Connect

```
Hi reviewer — thanks for taking the time to test Songnado.

Songnado is a music-trivia party game. No login or account is required for any feature, so everything is testable on first launch.

QUICK TESTING GUIDE
1. Open the app and tap "New Game".
2. Accept the default teams (or set any number from 2 to 6).
3. Game mode: Classic is the simplest to test.
4. Choose one or more music packs. Ten are unlocked by default.
5. Tap "Start game". A song loads and a 30-second preview plays automatically.
6. Mark "Song correct" and/or "Artist correct", then tap a team to award points.
7. Tap "Next round" to continue.

An internet connection is required, because audio is streamed at play time.

ABOUT THE AUDIO SOURCE
All audio is 30-second preview clips from Deezer's public API (api.deezer.com), streamed directly from Deezer's preview CDN (e-cdns-preview-*.dzcdn.net) and played by Expo Audio. The app does not download, cache beyond ordinary OS-level HTTP caching, redistribute, or modify any audio. There is no backend server. Songnado is not affiliated with, endorsed by, or sponsored by Deezer, and the app description says so.

ABOUT SPOTIFY CODE IN THE BUNDLE
The repository contains Spotify integration code that is disabled at build time by a feature flag (SPOTIFY_ENABLED, default false). No Spotify UI is reachable in this build and the app makes no network requests to any Spotify service. The code remains in the repo for a future release; if that ever ships, it will be submitted as an update with the description changed to match.

DATA COLLECTION
Songnado collects anonymous crash and performance diagnostics through Sentry so we can fix problems. That data is not linked to a user's identity and is not used for tracking or advertising, which is what our App Privacy answers state. Nothing else leaves the device: teams, scores, settings and any custom playlist URLs are stored only in local device storage. There are no accounts, no advertising SDKs and no analytics.

IN-APP PURCHASES
There are none in this version. No StoreKit code path is reachable.

MULTI-DEVICE MODE
If "Buzz" mode is visible in this build, it is optional: one device hosts a local Wi-Fi game and other phones join with a room code, using a direct TCP connection between devices on the same network. It requires two or more devices and never leaves the local network. Every other mode works on a single device, so no part of the review depends on it.

Thanks again — happy to answer anything at the contact address on file.
```

---

## Before pasting, confirm each of these against the build you submit

- [ ] Pack count in step 4 still says **ten unlocked** (10 free / 6 locked as
      of 1.0.3 — 10 curated packs plus 6 live Deezer packs, 16 total)
- [ ] `SPOTIFY_ENABLED` is false in the submitted binary
- [ ] `TEST_TOOLS_ENABLED` is false — otherwise the home screen shows
      "debug jukebox" and "test feedback" links and the game screens show
      Remove / Bad version buttons, which is a Guideline 2.2 problem
- [ ] The Buzz paragraph matches reality — delete it if Buzz is hidden
- [ ] App Privacy answers in App Store Connect say Diagnostics → Crash Data
      and Performance Data are collected, not linked to identity, not used
      for tracking
