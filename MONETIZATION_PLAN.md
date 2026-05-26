# Monetization Plan

Companion to `MIGRATION_PLAN.md` and `SPOTIFY_INTEGRATION_PLAN.md`. Defines the freemium model, feature gating, upgrade UX, and pricing.

App name: **Songnado** (locked May 25, 2026 — Spotify Developer Dashboard updated, app.json display name updated. Internal identifiers like the `songsterv2://` URL scheme and `com.ddunaay.songster` bundle ID stay unchanged.)

---

## Decisions locked

1. **Model:** Freemium with a paid "Pro" tier. No ads, ever.
2. **Pricing:** $4.99/mo, $29.99/yr, **$79.99 lifetime** (push lifetime hardest).
3. **Free trial:** 7-day trial on the monthly subscription. Standard App Store / Play Store flow.
4. **Core principle:** Free must be a genuinely playable party-game experience, not crippleware.
5. **Never subtract from Free.** New monetization moves add to Pro; they don't paywall existing free features. Review-bomb risk is real and asymmetric.
6. **Spotify Connect stays free forever.** It's the wow moment and the differentiator — gating it would kill virality. Marginal cost is ~zero since the user's own Spotify subscription pays for the audio.

---

## Feature gating matrix

| Feature | Free | Pro |
|---|:---:|:---:|
| **Deezer demo packs** (3-4 starter) | ✓ | ✓ |
| **Spotify Connect** (user's own playlists) | ✓ | ✓ |
| **Random-window playback** (Spotify) | ✓ | ✓ |
| **Classic mode** | ✓ | ✓ |
| **Blitz mode** | ✓ | ✓ |
| **Elimination mode** | — | ✓ |
| **Future game modes** | — | ✓ (default policy) |
| **Songnado Official curated playlists** | 1 preview pack | All 6+ |
| **Custom Spotify playlists added** | Up to 3 | Unlimited |
| **Game history & stats** | Last game only | Full history + streaks |
| **Per-team session memory** (resume interrupted game) | — | ✓ |
| **Themes / team color packs** | Default only | All packs |
| **Ad-free** | ✓ | ✓ |
| **Team count (1-6) / target score / settings** | ✓ | ✓ |

### Why these specific cuts

- **Spotify Connect free** — non-negotiable. The wow moment can't be paywalled.
- **Classic + Blitz free, Elimination Pro** — two modes is a full party experience. Elimination is the most "campaign-y" mode and a clean upsell trigger. All future modes default to Pro.
- **3 custom playlists free** — most casuals only have 1-2 party playlists. The 4th-add moment is a high-intent upgrade trigger.
- **1 curated playlist free as preview** — "2010s Hits" (broadest appeal). Free users get to actually try the curation quality. "Show, don't tell" converts better than 100% locked.
- **Stats/history Pro** — only matters to repeat users, and "see my streak" is a classic conversion moment.
- **No ads, ever** — ads in a party game destroy the room. Don't.

---

## Upgrade triggers — where Pro shows up

Ordered by priority / engagement intent:

1. **Locked tile in playlist picker** — "Songnado Picks" section shows 6 cards: 1 unlocked ("2010s Hits"), 5 with soft lock icon. Tapping a locked card → upgrade sheet with the playlist's preview.
2. **Elimination mode card on game setup** — small "Pro" badge. Tapping it: "Elimination is a Pro mode. Try Pro free for 7 days, or use Classic/Blitz." Two CTAs: upgrade / dismiss.
3. **4th custom playlist add attempt** — "You've got 3 custom playlists on Free. Pro unlocks unlimited. [Try Pro] [Maybe later]"
4. **End-of-game screen after 3rd completed game** — small dismissable banner: "Enjoying [App]? See your stats and unlock more with Pro."
5. **Settings → Upgrade to Pro** — always available, never hidden
6. **Stats screen on Free** — shows "Last game" prominently with a teaser of "all your games" blurred behind a Pro CTA

### What we will NOT do

- Modal blocks at app launch or game start (party-killer)
- Any mid-game interruption (party-killer ×2)
- "Are you sure you want to miss out?" dark patterns
- Auto-converting trials without prominent disclosure
- Ads of any kind, free tier or paid

---

## Upgrade screen layout

Single screen, three options, lifetime visually prioritized:

```
┌─────────────────────────────────────────┐
│         Unlock [App] Pro                │
│                                         │
│  ✓ All 6 curated playlists              │
│  ✓ Unlimited custom playlists           │
│  ✓ Elimination mode + future modes      │
│  ✓ Game history, stats & streaks        │
│  ✓ Premium themes                       │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ Lifetime         $79.99 once  ⭐  │  │  ← Best value badge
│  │ Pay once, own forever              │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ Annual         $29.99/yr           │  │
│  │ Equivalent to $2.50/mo             │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ Monthly        $4.99/mo            │  │
│  │ 7-day free trial included          │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Restore Purchase  •  Terms  •  Privacy │
└─────────────────────────────────────────┘
```

### Why push lifetime

Party games have **bursty engagement** — used at parties, dormant for months. Subscriptions feel bad for that pattern; people cancel during dormant stretches and forget to re-sub. Lifetime captures full value without the "am I using this enough?" guilt that kills sub LTV.

Expected mix: ~50% lifetime / ~30% annual / ~20% monthly → blends to ~$45 ARPU. This is the input to the SOM scenarios in `MEMORY.md`.

---

## Edge cases

| Scenario | Behavior |
|---|---|
| User has Pro, Spotify Premium lapses | Pro features still work; Spotify connect breaks gracefully: "Your Spotify subscription seems to have lapsed — Pro features still work with demo packs." |
| User has Spotify Premium but not Pro | Full Spotify experience on Free tier — no extra friction |
| Pro subscription lapses | 7-day grace period, then revert. **Never delete user data.** Custom playlists 4-N stay visible and playable but greyed as "Pro feature — re-subscribe to add more." |
| User on Free taps Elimination | Sheet: "Elimination is a Pro mode. Start 7-day trial / Use Classic instead." |
| User refunds purchase | App Store / Play Store handles refund; on next launch we check receipt status and downgrade gracefully |
| Family Sharing (iOS) | Apple's Family Sharing applies automatically to non-consumable IAP (lifetime). Subscription does not share by default — Apple's standard behavior. Don't override. |
| User downgrades and re-upgrades | All data persists. Re-upgrading restores stats history exactly as it was. |

---

## Implementation phase (slot after Phase C.5)

**Phase D — Monetization (~2-3 days):**

- [ ] **D.1** — IAP product setup in App Store Connect + Play Console (monthly sub, annual sub, lifetime non-consumable)
- [ ] **D.2** — `expo-iap` or `react-native-iap` integration; receipt validation
- [ ] **D.3** — `stores/proStore.ts` — Zustand store: entitlement state, expiry, grace period tracking
- [ ] **D.4** — Feature gates: a single `useIsPro()` hook, gate checks throughout the app
- [ ] **D.5** — Upgrade screen (one screen, three options) + all 6 trigger touchpoints
- [ ] **D.6** — Free trial flow + receipt-status polling on launch
- [ ] **D.7** — Edge case handling (grace period, lapse, refund, restore)

Belongs *after* Spotify integration is shipped (Phase C). Without Spotify working end-to-end, there's no real Pro feature to sell.

---

## Open follow-ups

1. **Family Sharing messaging** — App Store listing should mention lifetime supports Family Sharing as a selling point.
2. **Spotify Premium affiliate revenue** — separate from Pro revenue. ~$2-10 per Free-Spotify-user we convert. Adds 5-10% on top of Pro revenue. Configure once C.1 is live.
3. **Lifetime price A/B** — $79.99 is the starting point. If conversion is strong (>3% of MAU), test $99.99 post-launch. If weak (<1.5%), test $59.99.
4. **Gift purchases** — "buy lifetime for a friend." Defer; not v1.
5. **Refund handling for lifetime** — Apple/Google control this. We honor whatever the platform decides; we don't try to override.
6. **Tax / regional pricing** — Apple and Google auto-tier prices per market. Use Apple's "Tier 5 / 30 / 80" equivalents rather than hard-coded USD.
