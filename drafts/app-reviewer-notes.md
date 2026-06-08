# Notes for App Reviewer — Songnado v1

This text goes in App Store Connect → App Information → App Review Information → Notes (free-text field, max 4000 chars).

Purpose: pre-empt Apple reviewer questions and confusion. They'll likely test the app and may grep the bundle or GitHub repo. Better to explain unusual things up front than have them flag something benign.

---

## Final text to paste into App Store Connect

```
Hi reviewer — thanks for taking the time to test Songnado!

Songnado is a music-trivia party game. No login or account is required to use any feature, so you can test everything immediately on first launch.

QUICK TESTING GUIDE
1. Open the app — you'll land on the setup screen.
2. Set teams to 2 (or any number 2-6).
3. Game mode: Classic (simplest to test).
4. Scroll down to "Deezer packs" — 4 packs will be unlocked by default (1990's, 2000's, 2010's, Movie Songs).
5. Tap "Start game".
6. On the next screen, pick any playlist. A song will load.
7. Tap "Play" to hear a 30-second preview from Deezer.
8. Mark "Song correct" or "Artist correct", then tap a team to award points.
9. Repeat for additional rounds.

ABOUT THE AUDIO SOURCE
All audio is sourced from Deezer's public preview API (api.deezer.com). Each track exposes a preview URL hosted at p.scdn.co or e-cdns-preview-*.dzcdn.net. The app does not download, cache (beyond OS-level HTTP caching), redistribute, or transform any audio. The Deezer preview URL is played directly by Expo Audio. We have no backend.

ABOUT SPOTIFY CODE IN THE REPO
If you grep our public GitHub repo (https://github.com/ddunaway2386/songnado), you'll see substantial Spotify integration code. This code is INTENTIONALLY DISABLED in the production build via a build-time feature flag:

  lib/featureFlags.ts exports: SPOTIFY_ENABLED = process.env.EXPO_PUBLIC_SPOTIFY_ENABLED === 'true'

The env variable is unset in production builds, so the flag is false, and all Spotify-dependent UI and API calls are dead-code-stripped at bundle time by Metro. The shipped app makes zero network requests to Spotify and shows zero Spotify-branded UI. We will enable Spotify integration in a future major version when we qualify for Spotify's Extended Quota Mode (currently requires 250K+ MAU, which we don't have as a pre-launch indie app).

NETWORK ACTIVITY YOU MAY SEE
1. Deezer Search API (api.deezer.com) — used to fetch track metadata for built-in playlists and any custom playlist the user adds by URL
2. Deezer CDN (e-cdns-preview-*.dzcdn.net or p.scdn.co) — streaming the 30-second audio previews
3. GitHub Pages (ddunaway2386.github.io/songnado/config/runtime.json) — on app launch, the app fetches a tiny JSON file with feature flags. This is our kill-switch for Deezer access if needed. Privacy: no user data sent.
4. NO requests to Spotify, Google Analytics, advertising networks, or anything else.

WHAT'S DIFFERENT BETWEEN GAME MODES
- Classic: flat scoring, first team to target score (10/15/20) wins
- Blitz: faster answers = more points (time bonus)
- Elimination: each team has to clear every playlist on the board to win; teams can "steal" a playlist clear if the active team misses

ABOUT THE "LOCKED" PLAYLISTS
The picker shows 11 playlists. 4 are unlocked at install. 7 show with a lock icon. Tapping a locked pack opens a modal explaining unlock options:
- Play 5 rounds → unlock 1 pack of your choice (engagement-based, no purchase)
- Share Songnado with a friend via native share sheet → instant unlock
- (Placeholder for future IAP — not active in v1)

There are no in-app purchases active in v1. The Pro tier and individual pack purchases are placeholders that don't trigger StoreKit. We plan to enable them in v1.1.

DATA COLLECTION
Songnado does not collect any user data. There's no backend. All state (game scores, team names, custom playlists, unlock progress) is stored on-device via AsyncStorage. The privacy policy at https://ddunaway2386.github.io/songnado/privacy/ explains this in detail.

CONTACT FOR QUESTIONS
Daniel Dunaway: ddunaay@gmail.com
GitHub: https://github.com/ddunaway2386/songnado (public)

Thanks for reviewing!
```

---

## Word count check

~2,700 chars. Well under Apple's 4000 limit. Plenty of room.

## What this accomplishes

- **Pre-empts confusion about Spotify code in repo** — reviewer won't flag "you have Spotify code but aren't using it" as a deceptive submission. We explain it openly.
- **Documents the feature flag mechanism** — reviewer can verify our claim by checking the bundle (no Spotify imports executed at runtime).
- **Lays out the unlock modal** — reviewer might wonder "where's the IAP I see referenced in the code?" Answer: not active in v1.
- **Explains the kill switch network call** — reviewer sees a startup fetch to GitHub Pages and might wonder. Answer: it's a kill switch config, no user data.
- **Gives a step-by-step test path** — reviewer doesn't have to figure out how to use the app. They can follow the 9 steps and verify functionality fast.
- **No login required is highlighted** — saves reviewer time (they don't need test credentials).

## If reviewers ask follow-up questions

Common rejection categories and how to respond:

- **"You reference Pro subscription but no IAP active"** → "Correct. The UI shows the value prop and the IAP flow is wired into a placeholder. We plan to activate IAP in v1.1 once we've validated user demand."
- **"Music content licensing concerns"** → "All audio is served by Deezer via their official public preview API, exactly as their API is designed to be used. We do not host or transform any audio. Our use is consistent with other apps using the Deezer preview API."
- **"What is the GitHub Pages config fetch?"** → "Kill switch for our music provider in case of unforeseen issues. No user data sent. The fetched JSON is a 4-field config (deezerEnabled, killSwitchReason, version, lastUpdated)."
