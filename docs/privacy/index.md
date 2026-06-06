---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy for Songnado

**Effective date:** June 6, 2026
**Last updated:** June 6, 2026 (revised same-day to reflect the Deezer-only public release decision)

This Privacy Policy describes how Songnado ("we," "us," or "the app") handles information when you use our mobile app on iOS or Android.

## The short version

Songnado is a music-trivia party game. **We do not run any backend server.** We do not collect, store, transmit, sell, or share your personal information with anyone, ever. Everything Songnado creates while you use it stays on your device. The app plays 30-second song previews served by Deezer's public API; Deezer's own privacy practices are linked below.

## 1. Information processed by Songnado

| What | Where it lives | Why |
|---|---|---|
| Game scores, team names, app settings | Local AsyncStorage on your device | So your last game's setup and scoreboard persist between sessions. |
| Custom playlist URLs you add | Local AsyncStorage on your device | So your custom Deezer playlists stay available for future games. |
| Crash and performance data | None collected | If this changes (for example, if we add Sentry), this policy will be updated and an in-app opt-out provided. |
| Advertising identifiers | None collected | Songnado contains no ads and uses no advertising SDKs. |

We do not place cookies (the app is native, not a web view). We do not run analytics. We do not use trackers. We do not embed third-party SDKs other than the music provider listed below.

## 2. Third-party services

When you use Songnado, the following third-party service may process data under its own privacy policy:

- **Deezer** — The in-app starter packs and any Deezer playlists you add play 30-second preview clips served from Deezer's public preview URLs. No Deezer account is required; Deezer does not receive identifying information about you from Songnado. See [Deezer's Privacy Policy](https://www.deezer.com/legal/personal-datas).

### Note about Spotify

A Spotify Connect integration exists in the Songnado codebase but is **not enabled in the App Store / Play Store release of the app**. Until Songnado qualifies for Spotify's Extended Quota Mode (which currently requires 250,000+ monthly active users and a registered business entity), the Spotify integration is reserved for internal development builds only. If you are using a development build with Spotify enabled, the data processed by that integration is described in the [previous version of this policy on GitHub](https://github.com/ddunaway2386/songnado/commits/main/docs/privacy/index.md); the public App Store/Play Store version of Songnado does not authenticate to or communicate with Spotify in any way.

## 3. Children

Songnado is rated for general audiences and is not directed at children under 13. We do not knowingly collect any data about children under 13.

## 4. Your rights and how to delete your data

Because Songnado does not store your data on any server we control, there is nothing for us to export or delete on your behalf. To remove all data the app holds on your device, uninstall the app — this clears all AsyncStorage data including team names, scores, and custom playlist URLs.

## 5. Security

Songnado operates no backend, so we have no servers that can be breached. Local on-device data is protected by your operating system's standard app sandboxing.

## 6. Changes to this policy

If this policy changes materially, we will update the "Last updated" date above and surface a notice in the app on the next launch after the change.

## 7. Contact

Daniel Dunaway
Email: [ddunaay@gmail.com](mailto:ddunaay@gmail.com)
GitHub: [https://github.com/ddunaway2386/songnado](https://github.com/ddunaway2386/songnado)
