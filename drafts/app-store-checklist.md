# Songnado — App Store submission checklist

Status as of the pre-launch audit. Bundle `com.ddunaay.songster`,
ASC App ID `6765927946`, currently at 1.0.2 (build 8) in TestFlight.

---

## 🔴 Blockers — these cause rejection, fix before submitting

### 1. The paywall is fake and advertises a price

`components/UnlockPackModal.tsx` shows a **"⭐ Songnado Pro — $4.99/mo"**
button whose handler is:

```js
function handleSubscribePro() {
  // Phase D: replace with real StoreKit subscribe flow.
  setIsPro(true);
}
```

It sets a local boolean. No StoreKit, no payment, no receipt, no restore.
There is no IAP library in `package.json` at all.

This fails **Guideline 3.1.1** (digital content must use in-app purchase)
and arguably **2.3.1** (advertising a price the app doesn't charge). It is
close to a guaranteed rejection, and a "$4.99/mo" string with no purchase
behind it is the kind of thing reviewers flag fast.

Three ways out:

| Option | Work | Notes |
|---|---|---|
| **A. Everything free** | ~1 hr | Delete lock tiers + modal. Simplest, fastest approval. Loses the progression hook. |
| **B. Real StoreKit IAP** | 1–2 weeks | Products in ASC, RevenueCat or expo-iap, sandbox testing, mandatory Restore Purchases, native rebuild. Right answer eventually, wrong answer for v1. |
| **C. Free unlocks only** ✅ | ~1 hr | Keep locked packs and the progression, **remove every mention of money**. Unlock by play-count or share — both already built in `unlocksStore`. No IAP needed, no rejection risk. |

**Recommendation: C.** It keeps the engagement mechanic, ships clean, and
leaves the door open to add real IAP in v1.1 once there's evidence people
want to pay. Concretely: drop the Pro button, keep "play N rounds to
unlock" and "share to unlock."

### 2. "Unlock all for testing" toggle is shipping to users

`app/setup/playlists.tsx` renders a pill reading **"Unlock all for testing"
/ "PRO UNLOCKED (testing)"** that flips `setIsPro`. That's debug UI in the
production flow — it both looks unfinished and hands every user the paid
tier. Remove it (or gate it behind `__DEV__`).

### 3. iPad support is declared but never tested

`app.json` has `ios.supportsTablet: true`. That means Apple **requires
13" iPad screenshots**, and the reviewer will run it on an iPad. The app
has never been opened on one — the Elimination grid, draft screen, and
scoreboard all use phone-tuned sizing.

**Recommendation:** set `supportsTablet: false` for v1. Fewer required
screenshots, fewer layout surfaces to get wrong, one less rejection path.
Add proper iPad support later as a real feature. *Requires a native
rebuild* — it's a config change, not OTA-able.

---

## 🟡 Decisions that gate the paperwork

### Age rating (blocks the questionnaire)

Depends entirely on the explicit-content call in
`scripts/explicit-review.csv`. Two outcomes:

- **Filter explicit** → answer "None" for profanity/crude humor → likely
  **4+**, the widest audience and the honest answer for a family party game.
- **Keep explicit** → must answer "Infrequent/Mild" or worse → **12+ or
  17+**, which narrows reach and invites scrutiny of a "family" pitch.

This is the single decision with the largest downstream effect on the
listing. Settle it before starting the questionnaire.

### Buzz mode visibility

Currently visible in the mode picker with a **NEW** badge, never tested on
more than one device. Family test scheduled — if it struggles, hide it
behind a flag before submitting. A prominently advertised feature that
fails on first contact is the most likely source of a 2-star "doesn't
work" review.

---

## 🟢 Already in place

- Apple Developer account — Individual, Daniel Dunaway (`FZWV79545H`)
- App record exists in ASC (`6765927946`), renamed Tunehunch → Songnado
- TestFlight build uploaded and installing cleanly (1.0.2 build 8)
- `eas submit` automated via `ascAppId` in `eas.json`
- Privacy policy live: <https://ddunaway2386.github.io/songnado/privacy/>
- Sentry crash reporting active
- No login / no accounts → **no demo account needed** for review
- Catalog audited: 2,872 tracks, zero dead previews, zero duplicates

---

## 📋 App Store Connect — assets to produce

### Screenshots (required)

With `supportsTablet: false`, only **6.7" iPhone** is required
(1290 × 2796). Apple up-scales for smaller devices. 3–10 images; the
first two are what people actually see in search results.

Suggested sequence, in priority order:

1. **Elimination grid mid-game** — the most distinctive screen, shows the
   per-team board
2. **Song playing with the 30s timer + team award buttons** — the core loop
3. **Pack picker** — communicates catalog depth (nine packs, thousands of songs)
4. **Draft screen** — protect/eliminate, the strategy hook
5. **Game over / winner** — the payoff

Take them on a real device at 6.7" (iPhone 14/15/16 Plus or Pro Max).
Set up a game with fun team names — screenshots with "Team 1 / Team 2"
look like a prototype.

### Text

- **App name** (30 chars): `Songnado`
- **Subtitle** (30 chars): needs writing — e.g. *"Music trivia party game"*
- **Promotional text** (170 chars, updatable without review)
- **Description** (4,000 chars) — must be accurate per **2.3.1**. Do **not**
  mention Spotify (it's flag-disabled), and do **not** imply a Deezer
  partnership or endorsement. Describe modes, packs, team play.
- **Keywords** (100 chars total, comma-separated, no spaces)
- **Support URL** — required. GitHub Pages site works; needs a contact route.
- **Marketing URL** — optional

### Privacy nutrition label

**Sentry changes this** — the app now collects data it didn't before:

- **Diagnostics → Crash Data**: collected, not linked to identity, not used
  for tracking
- **Diagnostics → Performance Data**: collected (tracing is at 1.0), same
  treatment
- Everything else — playlists, teams, scores — is local-only AsyncStorage
  and is **not** collected

No tracking, no ad identifiers, no third-party analytics beyond Sentry.

### Category & rating

- Primary: **Games → Trivia**
- Secondary: **Games → Music** (or Entertainment)
- Age rating: per the explicit decision above

### App Review notes (free-text, worth filling in)

Pre-empt the reviewer's likely questions:

> Songnado is a local party game — one device, teams pass it around. No
> account or login required.
>
> Audio is 30-second preview clips from Deezer's public API, fetched at
> play time. Songnado is not affiliated with or endorsed by Deezer.
>
> To try it: New Game → pick any mode → accept default teams → select one
> or more packs → Start. Requires an internet connection for audio.

---

## Suggested order of operations

1. Resolve the paywall (option C) and remove the test toggle — ~1 hr
2. Family verdict on explicit → sets age rating
3. Buzz mode go/no-go after tomorrow's test
4. `supportsTablet: false` + native rebuild (bundles 1–3)
5. Capture screenshots on the new build
6. Fill ASC listing: text, screenshots, privacy label, rating, review notes
7. Submit for review — expect roughly a week, plan for one rejection round
8. In parallel: TestFlight external testing with 10–20 non-family testers

Steps 6–7 carry calendar latency you can't compress later, which is why
they should start now rather than after more testing.

---

## Sentry debug symbols — REQUIRED before the submission build

Native crashes were arriving unsymbolicated (`<redacted>` frames, and a
"Processing Error" badge in Sentry) because both EAS build profiles set
`SENTRY_DISABLE_AUTO_UPLOAD=true`. That was the workaround for a build
failing with *"organization ID or slug required"* — it unblocked the build
by turning off debug-symbol upload, at the cost of every native crash from
every user being unreadable.

Fixed by naming the org and project in `app.json` instead:

```json
["@sentry/react-native", { "organization": "quindacy", "project": "react-native" }]
```

**One manual step is still outstanding.** The upload needs an auth token,
which must NOT be committed. Create one in Sentry
(Settings → Developer Settings → Auth Tokens) with `project:releases` and
`org:read`, then store it as an EAS secret:

```
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token> --type string
```

**Until that secret exists, EAS builds will fail** the same way they did
before — the disable flag is gone, so sentry-cli will try to upload and be
refused. Create the secret first, then build.

Verify after the next native build: force a test crash and confirm the
Sentry stack shows real function names rather than `<redacted>` offsets.
