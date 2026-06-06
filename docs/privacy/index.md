---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy for Songnado

**Effective date:** June 6, 2026
**Last updated:** June 6, 2026

This Privacy Policy describes how Songnado ("we," "us," or "the app") handles information when you use our mobile app on iOS or Android.

## The short version

Songnado is a music-trivia party game. **We do not run any backend server.** We do not collect, store, transmit, sell, or share your personal information with anyone, ever. Everything Songnado creates while you use it stays on your device. When you connect a third-party music service (Spotify) or play demo content (Deezer), those services have their own privacy practices, linked below.

## 1. Information processed by Songnado

| What | Where it lives | Why |
|---|---|---|
| Your Spotify display name, username, email, country, and Premium-status flag | In memory while the app is open; **never transmitted to us** | Displayed on the "Connected as …" screen after authentication; used to gate Premium-only Spotify playback. |
| Spotify OAuth access and refresh tokens | iOS Keychain or Android Keystore on your device, via Expo SecureStore | Used to make Spotify Web API calls on your behalf. Never transmitted to any Songnado server (we have none). |
| Your Spotify playlist names, descriptions, IDs, and cover images | In memory while the app is open; not persisted | Shown in the in-app playlist picker. |
| Game scores, app settings, custom playlist URLs | Local AsyncStorage on your device | So your last game's setup, scoreboard, and custom playlists persist between sessions. |
| Crash and performance data | None collected | If this changes (for example, if we add Sentry), this policy will be updated and an in-app opt-out provided. |
| Advertising identifiers | None collected | Songnado contains no ads and uses no advertising SDKs. |

We do not place cookies (the app is native, not a web view). We do not run analytics. We do not use trackers. We do not embed third-party SDKs other than the music providers listed below.

## 2. Third-party services

When you use Songnado, the following third-party services may process your data under their own privacy policies:

- **Spotify** — When you connect a Spotify account, you authenticate directly with Spotify; Songnado never sees your Spotify password. Spotify processes your account profile, playlist access, playback control, and any data it collects about your use of the Spotify client itself. See [Spotify's Privacy Policy](https://www.spotify.com/legal/privacy-policy/).
- **Deezer** — The in-app demo packs play 30-second preview clips served from Deezer's public preview URLs. No Deezer account is required; Deezer does not receive identifying information about you from Songnado. See [Deezer's Privacy Policy](https://www.deezer.com/legal/personal-datas).

## 3. Children

Songnado is rated for general audiences and is not directed at children under 13. We do not knowingly collect any data about children under 13.

## 4. Your rights and how to delete your data

Because Songnado does not store your data on any server we control, there is nothing for us to export or delete on your behalf. To remove all data the app holds on your device:

1. In Songnado, sign out of Spotify (clears OAuth tokens from secure storage).
2. Uninstall the app (clears all AsyncStorage data).

To independently revoke Songnado's access to your Spotify account, visit [https://www.spotify.com/account/apps/](https://www.spotify.com/account/apps/) and click "Remove access" next to Songnado.

## 5. Security

OAuth tokens are stored using your operating system's hardware-backed secure storage (iOS Keychain or Android Keystore, via Expo SecureStore). Songnado uses PKCE OAuth, so no client secret is ever shipped with the app. Because Songnado operates no backend, we have no servers that can be breached.

## 6. Changes to this policy

If this policy changes materially, we will update the "Last updated" date above and surface a notice in the app on the next launch after the change.

## 7. Contact

Daniel Dunaway
Email: [ddunaay@gmail.com](mailto:ddunaay@gmail.com)
GitHub: [https://github.com/ddunaway2386/songnado](https://github.com/ddunaway2386/songnado)
