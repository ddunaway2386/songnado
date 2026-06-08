# App Store Screenshots — Composition Plan

Apple requires minimum 3, allows up to 10 screenshots per device size. Each tells a chapter of the Songnado story. They scroll horizontally on the App Store listing — first screenshot is the most important, last is least important.

## Required sizes

| Device | Resolution | Required? |
|---|---|---|
| 6.7" iPhone (15/16 Pro Max, etc.) | 1290 × 2796 px | ✅ Required |
| 6.5" iPhone (older) | 1242 × 2688 px | Optional but auto-generated from 6.7" |
| 5.5" iPhone | 1242 × 2208 px | Optional but recommended (older audience) |
| iPad 12.9" | 2048 × 2732 px | ✅ Required (we have `supportsTablet: true`) |
| iPad 11" | 1668 × 2388 px | Optional, auto-generated from 12.9" |

In practice: design 10 screenshots for 6.7" iPhone, generate iPad versions by adjusting layout for landscape/wider canvas. Apple auto-derives the smaller iPhone size.

## The 10 screenshots (in order)

### #1 — Hero/Cover (most important)

**Goal:** establish the brand and the core hook in 2 seconds.

**Composition:**
- Songnado logo at top center, large
- Background: gradient (blue → purple to match logo) OR a screenshot of the picker screen blurred behind
- Hero headline overlay: **"Name that tune."** (large, bold typography)
- Sub-headline: **"Music trivia for game night."**

**Why first:** App Store users scroll fast. Screenshot 1 is what they see in search results. Must communicate "this is a music trivia game" instantly.

### #2 — Setup Screen (teams + mode)

**Goal:** show how easy it is to start.

**Composition:**
- Actual screenshot of `app/index.tsx` setup screen
- 4 teams visible: "The Champions", "Mom's Team", "The Boys", "Trivia Crew"
- Game type chip set to "Deezer game"
- Game mode set to "Elimination" (showcases the unique mode)
- Headline overlay (top, semi-transparent): **"Set up in 30 seconds."**

### #3 — Playlist Picker

**Goal:** show the depth of music content.

**Composition:**
- Actual picker screen showing multiple cover art images (1990's, Broadway, Movie Songs, etc.)
- A mix of unlocked and 🔒 locked playlists visible (don't hide the gating)
- Headline overlay: **"11 curated music packs. From 70s rock to Broadway."**

### #4 — Song Playing (in-round view)

**Goal:** show the actual gameplay moment.

**Composition:**
- In-round view with cover art, song title masked behind "????", artist behind "????"
- Timer at ~15 seconds remaining (urgency!)
- Pause button visible
- "Skip song" and "End round" buttons visible
- Headline overlay: **"Race to name the song."**

### #5 — Elimination Standings Grid (showcase the unique mode)

**Goal:** highlight Songnado's differentiating game mode.

**Composition:**
- The new standings UI: 3 teams in rows, each with ✓ for cleared packs and ● for remaining
- Team Red has cleared 2 packs, Team Blue 3, Team Green 1
- Active team's row highlighted with "🔥 ×2" badge (hot streak example)
- Headline overlay: **"Clear every pack to win. Streak bonuses included."**

### #6 — Reveal Screen

**Goal:** show the payoff moment.

**Composition:**
- Reveal view showing cover art, song title, artist, full info
- A specific recognizable song (e.g., "Don't Stop Believin'" by Journey)
- "+3 to The Boys" overlay (showing points awarded)
- Headline overlay: **"Get it right? Score points. Miss it? Steal next round."**

### #7 — Game Over / Winner

**Goal:** the satisfying conclusion.

**Composition:**
- Game-over screen showing final scores
- Winner team highlighted with 🏆
- Rematch button visible
- Headline overlay: **"The Champions win!"**

### #8 — Add Playlist (custom Deezer import)

**Goal:** show that users can bring their own music.

**Composition:**
- Add Playlist screen with Deezer URL pasted
- Preview card showing the playlist about to be added
- Soundiiz pointer visible in the hint card below
- Headline overlay: **"Or paste your own Deezer playlist."**

### #9 — Locked Pack / Unlock modal

**Goal:** show the freemium model gently (not aggressively).

**Composition:**
- Unlock modal for Broadway pack
- "🔒 Broadway — 451 tracks" header
- Three unlock paths visible: 🎮 Play to unlock, 📤 Share to unlock, ⭐ Songnado Pro
- Headline overlay: **"Unlock more packs. Earn or upgrade."**

### #10 — Privacy/Made by Family (the trust closer)

**Goal:** trust + brand authenticity. The last screenshot is the one people see before deciding.

**Composition:**
- Background: warm color, maybe family-photo-inspired (silhouettes of a family playing the game)
- Bold text: **"Made by a family for families."**
- Below: "No ads. No data collection. No accounts. Ever."
- Songnado logo small at bottom
- Headline overlay: NONE — this IS the headline

---

## Design principles

1. **First word of each headline matters most** — readers skim. Lead with the verb or hook.
2. **Use real product UI, not mockups** — Apple sometimes rejects "this isn't what the app looks like" mockups
3. **Don't hide behind cover photography** — show the actual app
4. **Color cohesion** — pick 3-4 colors that match Darick's logo work and stick to them
5. **One headline per screenshot, not paragraphs** — App Store users scan in <1 second per screenshot
6. **No App Store badges or competitor names** — Apple rejects screenshots that reference Spotify, Apple Music, etc.

---

## Tools to create these

**Recommended (free / cheap):**
- **Figma** (free for personal) — design the headlines and overlays, import phone screenshots as background
- **PhotoshopExpress** or **Canva** — Canva has App Store screenshot templates
- **Apple's [App Store Connect screenshot guidelines](https://developer.apple.com/design/human-interface-guidelines/app-icons#App-Store-screenshots)** — official spec

**For the actual phone screenshots:**
- Take them on your physical device (iOS Settings → Display & Brightness → Screen Mirroring isn't needed; just hit Power+Volume Up)
- Or use Xcode simulator → File → Save Screen → set device to iPhone 15 Pro Max for 6.7" size
- For consistency, do them all on the same device in one session

**Pro tip:** before screenshots, fill the picker with packs that have rich cover art. The Broadway, Movie Songs, and decade packs all have strong covers — make those visible.

---

## Estimated effort

If Darick has design chops:
- Design template in Figma: 2-3 hours
- Capture 10 raw screenshots from device: 30 min
- Combine + add headlines: 2-3 hours
- iPad versions (recompose to wider format): 2 hours

**Total: ~1 full work day for someone competent in Figma.**

If hiring out: Fiverr designers do "10 App Store screenshots from your screen captures + brief" for $50-150. Faster but less iterative.

---

## What to discuss with sons tomorrow

1. Who designs these (Darick? Outside help? You?)
2. Approve the 10-screenshot story above, or modify it?
3. Should screenshot #1 (hero) be the logo, or a punchy gameplay shot? (My vote: logo + hook headline. The icon already shows the logo; the hero screenshot should hook on the GAME.)
4. Family-photo silhouette for screenshot #10 — design that or skip it?
