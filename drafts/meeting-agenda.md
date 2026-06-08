# Songnado Family Meeting — Agenda

> **Attendees:** Daniel + 4 sons + 2 daughters-in-law (7 people)
> **Estimated time:** 90 minutes
> **Goal:** align on strategic decisions, assign concrete work, set realistic timeline

---

## Pre-read (send to family the night before)

Three links — 10 minutes of reading total:

1. **App Store Listing drafts** — pick a Description variant: `https://github.com/ddunaway2386/songnado/blob/main/drafts/app-store-listing.md`
2. **Playlist Strategy research report** — context on the curation plan: `https://github.com/ddunaway2386/songnado/blob/main/drafts/playlist-strategy-research.md`
3. **Curation Playbook** — what they'll be doing if they take a pack: `https://github.com/ddunaway2386/songnado/blob/main/drafts/curation-playbook.md`

---

## Agenda

### 1. Welcome + status catch-up (15 min)

**Daniel briefs the team on the last 10 days of work:**
- Brand: Songnado name verified clear (USPTO + App Store + domain owned)
- App: core gameplay shipped, all 3 modes work (Classic / Blitz / Elimination)
- Elimination polish: per-team standings grid, hot streak mechanic, steal logic
- Single-provider pivot: app launches Deezer-only; Spotify hidden behind build flag
- 11 existing playlists already curated, validated against Deezer API (93% availability across 20 planned categories)
- Privacy policy published at GitHub Pages
- Kill switch infrastructure: can disable Deezer access remotely if needed

**Output:** everyone understands current state. Hold questions until end if possible.

---

### 2. Brand decision: file the trademark? (10 min)

**Context:** USPTO trademark search came back zero conflicts. Songnado.app domain owned. App Store search shows no existing Songnado app.

**Discussion:**
- Should we file USPTO trademark application now ($250, locks in priority date) vs. wait until post-launch?
- Filing as individual (Daniel) or wait until LLC formation?
- Who handles the ~1 hour of online filing if we proceed?

**Reference:** `drafts/trademark-application.md` (USPTO field-by-field walkthrough)

**Recommended decision:** file now, individual filing, one son volunteers to handle online forms.

**Output:** assigned owner + target file date

---

### 3. Logo task assignment (5 min)

**Context:** AI-generated logo concept exists (blue/purple tornado with music notes + "Songnado" wordmark). Needs adaptation for App Store icon requirements.

**Asks of Darick (or whoever has design chops):**
- Re-prompt AI generator for icon-only variant (just tornado, no wordmark, square format, deep navy background)
- Or hand-edit existing image in Figma/Photopea to extract tornado element
- Produce all 6 asset sizes (see `app.json` for exact filenames + dimensions)

**Timeline:** ~1 week if AI re-generation, ~3 days if hand-editing

**Output:** Darick (or owner) committed, deadline set

---

### 4. Game design decisions (15 min)

Three quick votes on game features already designed but not yet shipped:

**a. Draft Mode for Elimination — v1.2 commit?** (5 min)
- Concept: pick/ban phase before Elimination starts, lets teams shape the playlist set
- "Block Broadway because mom's team will dominate" example
- Effort: ~1-2 weeks of UI work
- Decision: commit to v1.2 release, or hold?
- Recommended: **commit** — it's Songnado's strongest differentiation feature

**b. Pack-count gating for Draft Mode** (5 min)
- Draft requires 8+ packs in user's library to unlock
- Free users have 4 packs at install; need to earn or buy 4 more to access Draft
- Decision: confirm 8 as the threshold, or different number?
- Recommended: 8 (matches the visual richness of the picker)

**c. Hot Streak default setting** (5 min)
- Currently shipping: "Limit to 3 in a row" as the default
- Alternatives: Off (no bonus turns) or Unlimited
- Decision: confirm default?
- Recommended: limit-3 (gives the streak feel without runaway snowball games)

**Output:** three decisions logged

---

### 5. Curation plan + pack assignments (20 min)

**Big agenda item.** Reference: `drafts/playlist-strategy-research.md` for the 55-pack plan.

**a. Confirm launch hero packs (5 min)**
- Recommended 4: 90s Mega Hits, 80s Mega Hits, Wedding Reception Bangers, Road Trip Sing-Alongs
- These get the free-tier slots; everything else launches as locked
- Decision: confirm or adjust?

**b. Walk through Deezer availability results (5 min)**
- Headline: 93% availability across all 20 tested categories
- Only Anime pack at 53% (needs strategy adjustment)
- Pull up the CSV report on a laptop projected to screen, scroll through

**c. Assign packs to family members (10 min)**

Let each person volunteer based on what genres they actually listen to. Suggested initial assignments to seed the discussion:

| Person | Suggested first pack | Rationale |
|---|---|---|
| Daniel | 90s Mega Hits (trim existing) | Pilots the workflow, then trains sons on it |
| Son #1 | TBD | Whichever genre they know best |
| Son #2 | TBD | Same |
| Son #3 | TBD | Same |
| Son #4 | TBD | Same |
| Daughter-in-law #1 | Wedding Reception Bangers | Cross-cultural pack, broad appeal |
| Daughter-in-law #2 | Road Trip Sing-Alongs | Same |

**Reference for them:** `drafts/curation-playbook.md` — 6-step workflow, time budget, quality criteria.

**Reality check:** ~6-8 hours per pack first time, 5-7 hours after. Realistic timeline is 6-12 months for the full 55-pack library, not 3 months. Use monthly-drop cadence post-launch.

**Output:** named owners + first-pack assignments + agreed timeline

---

### 6. App Store decisions (10 min)

Reference: `drafts/app-store-listing.md`

**a. Description variant: A, B, or C?** (5 min)
- A: Casual/voice-driven ("WAIT — that's your favorite song?!")
- B: Family-warm ("Made by Daniel and his sons")
- C: Feature-rich/scannable
- Read aloud each first paragraph, vote

**b. Subtitle?** (2 min)
- Recommended: "Music trivia for game night" (28/30 chars)

**c. Pricing decision** (3 min)
- Ship v1 free with NO IAP active (defer Pro tier to v1.1) — recommended
- Or ship v1 with full Pro subscription + individual pack IAPs active

**Output:** description direction, subtitle, IAP timing

---

### 7. Landing page + DNS (5 min)

**Reference:** `drafts/landing-page-plan.md`

- Songnado.app domain owned but not currently resolving
- 10-minute DNS setup at Porkbun → points domain at existing GitHub Pages site
- Replaces stub landing with proper marketing page

**Decision:** who handles the ~10-min Porkbun + GitHub Pages config?

**Output:** assigned owner

---

### 8. Timeline + close (10 min)

**Realistic launch timeline (9 weeks from today):**

| Week | Milestone |
|---|---|
| 1-2 | Curation kickoff, logo work, screenshot mockups |
| 3 | Production EAS build, TestFlight upload (internal family) |
| 4-5 | Family TestFlight testing, bug fixes |
| 6 | App Store Connect setup, screenshot finalization, all metadata fields |
| 7 | Submit for review |
| 8-9 | Address rejections (1-2 cycles), final approval, launch |

**Target launch: early August 2026.**

**Bring up "right not fast":** if anyone is feeling rushed, slow down. We can extend any week. Timeline is a guide, not a deadline.

**Output:** committed launch target (rough month), next family check-in date

---

## Decisions to capture

By the end of the meeting, the following should be decided:

- [ ] Trademark: file now? Who?
- [ ] Logo: assigned to Darick (or other) with deadline
- [ ] Draft Mode: v1.2 commit yes/no
- [ ] Pack count gate for Draft: 8 confirmed?
- [ ] Hot Streak default: limit-3 confirmed?
- [ ] Hero pack list: 4 confirmed
- [ ] Pack assignments: who owns which first pack
- [ ] Description variant: A / B / C
- [ ] Subtitle: confirmed
- [ ] IAP timing: v1 or v1.1
- [ ] Landing page DNS: assigned owner
- [ ] Launch target month: agreed

---

## After the meeting

Daniel posts decisions to family chat. Each person knows:

1. What pack they own
2. When their first pack is due (suggest: 4-6 weeks for first attempt, given learning curve)
3. Where to ask questions (family chat)
4. Where to find reference docs (drafts/ folder in the songnado repo)
5. Where to track work (shared Google Sheets — Daniel sets up if not already)

Next family meeting: ~3 weeks out, to review first packs and address any blockers.

---

## Reference card (print or screenshot for the meeting)

**Quick links — for the laptop projected to the screen:**

- All drafts: github.com/ddunaway2386/songnado/tree/main/drafts
- Listing drafts: drafts/app-store-listing.md
- Playlist research: drafts/playlist-strategy-research.md
- Curation playbook: drafts/curation-playbook.md
- Cross-pack tracker: drafts/cross-pack-tracker.csv
- Privacy nutrition label: drafts/app-privacy-nutrition-label.md
- Reviewer notes: drafts/app-reviewer-notes.md
- Screenshots plan: drafts/app-store-screenshots-plan.md
- Trademark guide: drafts/trademark-application.md
- Landing page plan: drafts/landing-page-plan.md
- Deezer availability data: scripts/deezer-availability-report.csv
