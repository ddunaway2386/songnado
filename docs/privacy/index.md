---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy for Songnado

**Effective date:** June 6, 2026
**Last updated:** November 2026 (revised because Songnado now plays music through Apple Music)

This Privacy Policy describes how Songnado ("we," "us," or "the app") handles information when you use our mobile app on iOS.

## The short version

Songnado is a music-trivia party game. **We do not run any backend server.** We never sell or share your personal information, and we do not collect names, email addresses, contacts, location, or anything else that identifies you. Everything Songnado creates while you play — teams, scores, settings — stays on your device. The one exception is anonymous crash and performance diagnostics, which are sent to Sentry so we can fix the app when it breaks; that data is not linked to your identity and is never used for tracking or advertising. Songs play through Apple Music on your own subscription; Apple's privacy practices are linked below.

## 1. Information processed by Songnado

| What | Where it lives | Why |
|---|---|---|
| Game scores, team names, app settings | Local AsyncStorage on your device | So your last game's setup and scoreboard persist between sessions. |
| Crash and performance data | Sent to Sentry (see section 2) | So we can find and fix crashes. Not linked to your identity and never used for tracking or advertising. |
| Advertising identifiers | None collected | Songnado contains no ads and uses no advertising SDKs. |

We do not place cookies (the app is native, not a web view). We do not run product analytics, and we do not use advertising or tracking SDKs. The only third-party SDK in the app is the Sentry crash reporter described below.

## 2. Third-party services

When you use Songnado, the following third-party services may process data under their own privacy policies:

- **Sentry** — Receives anonymous crash reports and performance diagnostics (device model, OS version, app version, and the technical details of a crash) so we can find and fix problems. It receives no name, email, contacts or location, and the data is not used for advertising or tracking. See [Sentry's Privacy Policy](https://sentry.io/privacy/).
- **Apple Music** — Songnado plays songs through Apple's MusicKit using your own Apple Music subscription, so iOS asks your permission first. Songnado uses that access only to play songs and to check that your subscription can play them. It does not read your library, playlists or listening history, and it does not send anything about your Apple Music account to us. Apple handles your subscription and playback, and songs played in a game may count as plays on your account. See [Apple's Privacy Policy](https://www.apple.com/legal/privacy/).
- **GitHub Pages** — The app reads a small public settings file from GitHub Pages so we can post service notices. This is an ordinary web request that sends no information about you or your games. See [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

### Note about Spotify

A Spotify integration exists in the Songnado codebase but is **not enabled in the App Store release of the app**. The public version of Songnado does not authenticate to or communicate with Spotify in any way.

## 3. Children

Songnado is rated for general audiences and is not directed at children under 13. We do not knowingly collect any data about children under 13.

## 4. Your rights and how to delete your data

Because Songnado does not store your data on any server we control, there is nothing for us to export or delete on your behalf. To remove all data the app holds on your device, uninstall the app — this clears all AsyncStorage data including team names and scores. You can turn off Songnado's Apple Music access at any time in the iOS Settings app.

## 5. Security

Songnado operates no backend, so we have no servers that can be breached. Local on-device data is protected by your operating system's standard app sandboxing.

## 6. Changes to this policy

If this policy changes materially, we will update the "Last updated" date above and describe the change in the app's release notes.

## 7. Contact

Daniel Dunaway
Email: [ddunaay@gmail.com](mailto:ddunaay@gmail.com)
GitHub: [https://github.com/ddunaway2386/songnado](https://github.com/ddunaway2386/songnado)
