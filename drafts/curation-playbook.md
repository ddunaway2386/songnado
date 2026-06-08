# Songnado Curation Playbook

> **For:** Daniel + 4 sons + 2 daughters-in-law (the curation team)
> **Goal:** consistent, high-quality Songnado music packs that feel like premium curation, not a dump of every song from an era
> **Time per pack:** ~6-8 hours of focused work, spread over 2-3 evenings

This is the onboarding guide. Read it before you start your first assigned pack. Daniel piloted the workflow on 90s Mega Hits — what's below is the refined version of that learning.

---

## Why we curate (not auto-generate)

Songnado's product moat is **the curation taste**, not the technology. Any developer could build a music quiz app. Almost none of them put real effort into picking the right 400 songs from the 10,000 candidates.

When players say *"oh, this pack is good"* — what they're actually saying is *"the curator knew their audience."* That's what we're building.

A good Songnado pack feels like a mixtape from someone who knows the era cold. A bad one feels like an algorithm's leftover bin.

---

## The 6-step workflow

Every pack follows the same flow:

### 1. Set up your workspace (10 min)

Open four things side-by-side:

1. **Your Deezer playlist** (existing pack on Deezer.com, or a new empty playlist you just created)
2. **The validator CSV** (`scripts/deezer-availability-report.csv`) — filter to your pack name to see your 15 anchor seed tracks
3. **A working Google Sheet** for tracking decisions per song ([template structure below](#per-pack-working-sheet-template))
4. **The cross-pack dedup tracker** (`drafts/cross-pack-tracker.csv`) — check before adding any high-overlap song

### 2. Verify your anchor tracks (15 min)

Open the validator CSV, filter to your pack. The 15 tracks listed there are **non-negotiable anchors** — songs everyone associates with the pack theme. Make sure they're all in your Deezer playlist:

- If a track is missing: search Deezer, click `+`, add.
- If a track is in the CSV but flagged "Found = false": you have a substitution decision. Find an equivalent ("we wanted 'Higher and Higher' by Jackie Wilson but it's not on Deezer — swap to a different Jackie Wilson track or a different Motown anchor").

### 3. Curate the body (3-5 hours, the slow part)

The actual work. Walk through every track and decide Keep/Cut.

**Keep criteria** — answer YES to at least 2 of these for every track:

- Would 70%+ of the target audience recognize this in 30 seconds?
- Is this the artist's most famous track? (one of their top 3)
- Did this song chart in the top 40?
- Is there a cultural moment attached (movie scene, viral moment, wedding standard)?
- Does the 30-second Deezer preview hit a recognizable hook?

**Cut criteria** — cut anything where:

- The 30-second preview is silent intro or instrumental bridge (deal-breaker)
- It's an album cut that wasn't a single
- It's a "deep cuts" type track that fans love but casuals don't know
- The artist is over-represented (no artist should be more than ~5% of the pack)
- It's a regional hit that didn't cross over

Aim for a pack of **250-500 tracks** depending on the pack theme:

| Pack type | Target track count | Rationale |
|---|---|---|
| Mega Hits / Decade headliners | 400-500 | Broad appeal, lots of recognizable tracks |
| Niche / Specialty | 200-350 | Focused enough that 200 is plenty |
| Genre-specific | 250-400 | Depends on how rich the genre catalog is |
| Christmas/Holiday | 150-200 | The pool of "iconic" Christmas songs is finite |

Too few = repetition kills replay value. Too many = you're including filler that drags down pack quality.

### 4. Quality QC pass (1-2 hours)

This is the step everyone wants to skip. Don't.

**Preview window QC:**
Sample 30-50 tracks at random (~10% of your pack). Listen to the FULL 30-second Deezer preview for each. Flag any with:

- ❌ Intro silence (15+ seconds of buildup before vocal/hook)
- ❌ Wrong section (the 30-second window misses the chorus entirely)
- ❌ Live version where preview is just crowd noise
- ❌ Remaster that sounds noticeably different from the iconic original

For any flagged track: search Deezer for an alternate release of the same song. Most chart hits have 3-5 different releases on Deezer (single, album, remaster, deluxe, etc.). Find one with a recognizable preview window. Swap.

**Artist concentration check:**
In Deezer's playlist view, sort by artist. Anyone above ~5% of pack total? (For a 400-track pack: 20 tracks per artist max.)

Common over-representation:
- Garth Brooks
- Madonna
- Mariah Carey
- The Beatles
- Boy bands

Trim heavy hitters down to their 5-8 most iconic tracks.

**Cross-pack dedup check:**
Open `drafts/cross-pack-tracker.csv`. Before adding any potentially-overlapping song:

1. Is it already claimed by another pack? Check the "Primary Pack" column
2. If yes: skip it, or add a note in the tracker that you're including it as a secondary
3. If no: add the row, declaring your pack as Primary

**Rule of thumb:** any single track should appear in at most **2-3 packs** across the entire Songnado library. If 4+ packs all want "Bohemian Rhapsody," step back and decide which one really needs it most.

### 5. Connect to the app (15 min)

#### If trimming an existing pack:

The Deezer playlist ID is already in `lib/playlists.ts`. Three steps:

1. In Deezer: rename the playlist if needed (e.g., "1990's" → "90s Mega Hits")
2. In `lib/playlists.ts`: update the `name` field to match, update `totalTracks` to your new count
3. Commit + push:
   ```bash
   git add lib/playlists.ts
   git commit -m "Songnado: curate [pack name] — [old count] → [new count] tracks"
   git push origin main
   ```

The app will pick up the new playlist contents automatically via Deezer's API on next launch.

#### If creating a new pack:

1. Make the playlist public on Deezer (Settings on the playlist page)
2. Copy the playlist ID from the URL (e.g., `https://www.deezer.com/us/playlist/13700823521` → ID is `13700823521`)
3. Open `lib/playlists.ts`, add a new entry:
   ```typescript
   { id: '13xxxxxxxxxx', name: 'Wedding Reception Bangers', totalTracks: 280, tier: 'free' },
   ```
4. Choose tier:
   - `'free'` for the 4 hero packs (first impression)
   - `'locked'` for everything else (unlockable via play / share / IAP / Pro)
5. Commit + push

### 6. Test in the app (30 min)

Reload Metro with `--clear`, kill+reopen the app, then play 3-5 rounds using ONLY your new pack.

Specifically pay attention to:

- **Recognition rate**: aiming for 4 out of 5 songs that feel "oh I know this!" If you're getting more than 1 in 5 "what's this?" tracks, your pack needs more trimming.
- **Preview quality**: are previews opening on a hook? Or do you skip 5+ seconds wishing the audio would start hitting?
- **Pack feel**: does it feel like the curator (you) knew the era? Or like a random Spotify auto-generated playlist?

Iterate. Most packs need 2-4 rounds of "play, notice, tweak, retest" before they feel done.

### 7. Document learnings (15 min)

Add what you learned to this playbook (yes, this very document — it should keep growing). Specifically:

- Pack-specific tips you wish you'd known at the start
- Deezer interface gotchas you hit
- Tracks you wish were on Deezer but aren't (so we can flag for substitutions in similar future packs)
- Anything that took longer than expected and why

Don't worry about polishing — just append a note. Future-you (and your sons) will thank you.

---

## Per-pack working sheet template

Create a Google Sheet for each pack you work on. Columns:

| Column | Contents | Example |
|---|---|---|
| **#** | Sequential row number | 1, 2, 3... |
| **Title** | Track title as on Deezer | "Smells Like Teen Spirit" |
| **Artist** | Artist as on Deezer | "Nirvana" |
| **Deezer ID** | The track ID (from URL or API) | "14401354" |
| **Keep?** | YES / NO / MAYBE | YES |
| **Preview OK?** | YES / NO / Not checked | YES |
| **In other packs?** | List of overlapping packs | "OHW pack also claims" |
| **Notes** | Any per-track comments | "Anchor track" |

You don't need this for every pack — but for your first 1-2, it's useful for staying organized. After that, you'll develop muscle memory.

---

## Common gotchas

### Deezer search quirks

- **Apostrophes are inconsistent** — Deezer sometimes parses "Don't Stop" and "Dont Stop" differently. If a search returns no results, try both.
- **Featured artists are in subtitle, not main title** — "Crazy In Love (feat. Jay-Z)" — Deezer treats "feat. Jay-Z" as the title. Don't trim it; the longer title is correct.
- **Remasters vs originals** — Deezer often has both. The remaster has cleaner audio but sometimes a worse preview window than the original. Listen to both before adding.
- **"Bohemian Rhapsody" is special**: 30-second preview is the iconic operatic section — perfect. But many older songs have intros that eat the entire 30 seconds.

### Preview window patterns

Songs with bad 30-second windows often share patterns:

- **Slow build intros** (Pink Floyd, Led Zeppelin, prog rock generally) — preview is often the buildup before any vocal
- **Songs that start with extended instrumental** ("Stairway to Heaven", "Free Bird") — Deezer's preview is usually 30 seconds of pre-vocal noodling
- **Album openers** — sometimes Deezer's preview is the album's opening track which is often atmospheric

For these: search for a "single edit" or "radio edit" version. Often it's tighter.

### Cross-pack tension

Some tracks legitimately fit 4+ packs. Example: "Africa" by Toto fits 80s Mega Hits, Yacht Rock, Road Trip, AND One Hit Wonders.

When this happens, ask: **which pack's identity is most served by this track?**

- 80s Mega Hits identity = "the songs that defined the decade" — yes "Africa" is on the list, but it's not THE defining track
- Yacht Rock identity = "smooth 70s-80s soft rock with a specific vibe" — "Africa" is the genre's anthem
- Road Trip Sing-Alongs identity = "songs everyone sings along to in the car" — strong case
- One Hit Wonders identity = "the artist's only hit" — Toto had multiple hits, so weak case here

→ Africa is **primary in Yacht Rock**, OK to also include in Road Trip Sing-Alongs, skip from 80s Mega Hits.

When in doubt: discuss in the family chat with the other curators.

---

## Time budget reality check

| Pack | Curated by | Realistic timeline |
|---|---|---|
| First pack (anyone's first attempt) | Anyone | 8-12 hours (you're learning) |
| Subsequent packs | Same person | 5-7 hours each (faster) |
| Pack #5+ | Experienced curator | 4-6 hours each |
| Touch-up / iteration | Existing pack | 1-2 hours per pass |

**This is not a 3-month project across 60 packs.** Realistic timeline is 6-12 months for the full library, with monthly drops post-launch carrying the long tail.

Don't burn out trying to ship more than ~1 pack/week per curator. Sustainable pace > heroic effort.

---

## Quality acceptance test

Before declaring a pack "done":

- [ ] All 15 anchor tracks present (verified against validator CSV)
- [ ] Final track count within target range for pack type
- [ ] At least 30-50 tracks spot-checked for preview window quality
- [ ] No single artist over ~5% of pack (sorted-by-artist sanity check done)
- [ ] Cross-pack dedup tracker updated with any contested tracks
- [ ] Played 3-5 rounds in the app, no obvious "what's this?" tracks
- [ ] Commit message documents the changes
- [ ] Posted in family chat: "[pack name] is curated, 450 tracks, ready for review"

Anyone in the family team can do a spot-check by playing a session and reporting back. Second-eye review is valuable.

---

## When you're stuck

- **Pack feels lifeless / generic** → you need more anchor tracks. Search "[era] hits" on YouTube or Reddit's r/[decade]Music and surface songs you'd forgotten about.
- **Pack has too many tracks, can't decide what to cut** → cut anything with under 90% recognition. Better a tight 300-track pack than a soupy 600-track pack.
- **Deezer doesn't have a critical track** → check different versions (remaster, deluxe, live). If none work, swap in a similar-era track by the same artist.
- **Other family curator already claimed a track you want** → message them; either they'll let you also include it, or they'll release the claim. Don't quietly grab it.

---

## What success looks like

A Songnado pack succeeds when:

1. **First-time players say "oh yeah!"** for 4 out of 5 tracks
2. **Repeat players keep getting surprised** by songs they'd forgotten existed
3. **Younger players learn something** (curators include 1-2 "you should know this" essentials)
4. **Older players feel nostalgic** (curators don't shy from the obvious classics)
5. **The 30-second preview always serves the song** (no silent intros, no random bridges)
6. **It feels intentional**, like a friend made this for you

That last one is the highest bar. Get there and you've made a great pack.
