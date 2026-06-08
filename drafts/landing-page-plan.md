# songnado.app Landing Page — Plan + Content

You own songnado.app via Porkbun. Currently it doesn't resolve to anything. Goal: have it serve a polished single-page "Coming Soon" landing page that:

1. Establishes brand presence ahead of launch
2. Captures App Store launch announcement signups (email or social follow)
3. Links to privacy policy (needed for App Store anyway)
4. Looks polished on phones (~70% of viewers will be on mobile)

---

## Easiest implementation path

GitHub Pages already hosts your privacy policy. Cheapest move: point `songnado.app` at the existing GitHub Pages site via DNS, then upgrade `docs/index.md` to be a real landing page.

**Two-step setup:**

### Step 1: DNS at Porkbun (~5 min)

Log in to Porkbun → songnado.app → DNS Records → add these:

```
Type    Host    Answer
A       @       185.199.108.153
A       @       185.199.109.153
A       @       185.199.110.153
A       @       185.199.111.153
CNAME   www     ddunaway2386.github.io
```

(Those four IPs are GitHub Pages' public addresses; they're stable.)

### Step 2: GitHub Pages custom-domain (~2 min)

In `songnado` repo → Settings → Pages → Custom domain field → enter `songnado.app` → check "Enforce HTTPS" once available (takes a few minutes after DNS propagates).

GitHub creates a `CNAME` file in your `docs/` folder with the content `songnado.app`. This tells Pages to serve the site under that domain.

### Step 3: Replace `docs/index.md` with proper landing page content

The current `docs/index.md` is a stub. Replace with the content below.

---

## Proposed `docs/index.md` replacement

```markdown
---
layout: default
title: Songnado — Music Trivia Party Game
description: Songnado is a music trivia party game launching on iOS and Android. No accounts, no ads, just music and friends.
---

# Songnado

A music-trivia party game that turns every game night into a sing-along, race-to-name-it showdown.

**Coming soon to the App Store and Google Play.**

## How it plays

1. Pick a playlist (11 curated packs across decades, Broadway, Movie Songs, and more)
2. Set up your teams (2 to 6 players)
3. Hit play — race to name the song and artist from a 30-second preview
4. Three game modes: Classic, Blitz, Elimination

Built by Daniel and his sons. No accounts required. No data collection. No ads. Just music.

## Stay in the loop

We're launching in late summer 2026. Drop us your email and we'll send a single launch announcement when we go live. No newsletter, no spam — just the launch heads-up.

📩 [Email us to be on the launch list](mailto:ddunaay@gmail.com?subject=Songnado%20launch%20list&body=Add%20me%20to%20the%20Songnado%20launch%20announcement%20list.%20Thanks!)

## Documents

- [Privacy Policy](./privacy/)

## Contact

For questions or to be added to the launch list: [ddunaay@gmail.com](mailto:ddunaay@gmail.com)

---

*Songnado, Inc. (in formation). © 2026 Daniel Dunaway. All rights reserved.*
```

---

## Polish considerations

### Now (before launch)

- Add Songnado logo at the top of the page (once Darick's final assets are ready, drop the icon file in `docs/assets/songnado-icon.png` and add an `<img>` tag)
- The current `_config.yml` uses the Cayman theme — clean and functional, no need to change

### v1.1 (post-launch)

When the app is live, change the landing page to:
- Replace "Coming soon" with App Store + Play Store badges (Apple provides official SVG badges)
- Add a few screenshots in a hero section
- Possibly add testimonials from beta testers
- Optional: a 30-second video preview embedded from YouTube

### v1.2+

If Songnado gets meaningful traction:
- Move off Jekyll/Cayman to a real static site generator (Astro, Next.js static export)
- Custom design (the Cayman theme is fine but generic)
- Blog for monthly pack drop announcements
- Newsletter signup via ConvertKit / Mailchimp

For v1, the Markdown-on-Cayman approach is exactly right. Don't overbuild.

---

## What to actually do before the meeting

If Darick has any spare time:
1. He can do the DNS + CNAME setup tonight (~10 min total)
2. Then `songnado.app` resolves to your existing privacy page within the hour (DNS propagation)
3. Replace `docs/index.md` with the content above when ready

Nothing here blocks the app submission. But having `songnado.app` live and pretty before App Store reviewers click your "Support URL" link looks more polished.
