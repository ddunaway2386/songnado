# Deezer Playlist Builder — Setup & Usage

> One-time setup: ~10 minutes. After that, you can convert curated CSVs into Deezer playlists in 2 minutes per pack.

The two scripts that power this workflow:

- `scripts/deezer-auth.mjs` — one-time OAuth helper that grabs an access token
- `scripts/build-playlist.mjs` — converts a CSV with Keep marks into a new Deezer playlist

---

## The Daniel Workflow™ (top to bottom)

For each new pack:

### Step 1 — Aggregate (10 min)

On Deezer.com:
1. Search for existing decade/theme playlists (Deezer has "80s Hits", "90s Pop", "Best Wedding Songs" etc.)
2. Add 2-3 high-quality ones to your library
3. Combine them into one big "kitchen sink" playlist for the pack you're building
4. Don't worry about quality yet — the kitchen sink can have 600-1200 tracks, lots of overlap, deep cuts

### Step 2 — Analyze (5 min, automatic)

Run the existing curate-playlist.mjs script:

```bash
node scripts/curate-playlist.mjs <kitchen-sink-playlist-id>
```

You get a CSV at `scripts/curation-<id>.csv` with:
- All tracks tagged Auto-keep / Manual review / Auto-cut
- No-preview tracks pre-flagged for cut
- Duplicates flagged
- Sorted by popularity rank

### Step 3 — Curate (3-5 hrs, your taste work)

Open the CSV in Google Sheets:
1. Create a filter (`Data → Create a filter`)
2. Add a new column: **Final decision** (or whatever name you want)
3. For each row, mark `Keep` or `Cut`
4. Listen to preview clips via the `PreviewUrl` column for the tracks you're unsure about
5. Export when done: File → Download → CSV → save back to `scripts/curation-<id>.csv`

You can let the Auto-keep tier inherit "Keep" automatically if you want to skip reviewing them (most are obvious classics). Just bulk-fill the column for rows matching `Recommendation = Auto-keep`.

### Step 4 — Build (2 min)

Run the new script:

```bash
node scripts/build-playlist.mjs scripts/curation-<id>.csv "Your Pack Name"
```

Example:
```bash
node scripts/build-playlist.mjs scripts/curation-13707544281.csv "90s Mega Hits"
```

The script:
- Reads your CSV
- Filters to rows where `Final decision = Keep`
- Creates a brand-new Deezer playlist in your account with the name you gave
- Adds all the Keep tracks in batches
- Outputs the new playlist ID

### Step 5 — Ship (5 min)

1. Visit the new playlist on deezer.com
2. Open Playlist Settings → toggle Public ON
3. Add to `lib/playlists.ts`:
   ```typescript
   { id: 'NEW_ID', name: 'Your Pack Name', totalTracks: 412, tier: 'free' },
   ```
4. Commit + push

That's it. Total realistic time: 4-6 hours from "let's build a new pack" to "shipped, live in app on next install".

---

## ONE-TIME SETUP (10 minutes)

Before the first run of build-playlist.mjs, you need to authorize the script to write to your Deezer account.

### Step 1: Create a Deezer Application (5 min)

1. Go to https://developers.deezer.com/myapps
2. Log in with the Deezer account you want the playlists owned by (probably `dr001382`)
3. Click "Create a new Application"
4. Fill in the form:

| Field | Value |
|---|---|
| Application name | Songnado Curation |
| Application domain | `localhost` |
| Redirect URL after authentication | `http://localhost:8765/auth` |
| Description | Personal curation tool for Songnado app |
| Link to your application | `http://localhost` |
| Logo | skip (optional) |
| Acceptance of terms | ✓ tick the box |

5. Click Create.
6. On the resulting page, copy the **Application ID** and **Secret Key** — you'll paste them next.

### Step 2: Add credentials to `.env.local` (1 min)

In your project root, edit `.env.local` (create it if missing). Add:

```bash
DEEZER_APP_ID=12345678
DEEZER_APP_SECRET=abc123def456...
```

Use the actual values from your Deezer app page. This file is gitignored — won't get committed.

### Step 3: Run the auth helper (1 min)

```bash
node scripts/deezer-auth.mjs
```

This will:
1. Open your browser to Deezer's authorization page
2. You click "Authorize Songnado Curation"
3. Deezer redirects you back to `localhost:8765/auth` (the local server the script spins up)
4. Script captures the auth code, exchanges it for an access token
5. Saves the token to `.env.local` as `DEEZER_ACCESS_TOKEN=...`
6. Done — close the browser tab

### Step 4: Verify it worked

Your `.env.local` should now have three Deezer entries:

```bash
DEEZER_APP_ID=...
DEEZER_APP_SECRET=...
DEEZER_ACCESS_TOKEN=...
```

The access token doesn't expire unless you explicitly revoke it on Deezer. You won't need to re-run the auth helper.

---

## Quick test (no curation work needed)

Want to verify the whole pipeline before committing real curation effort?

Run this:

```bash
node scripts/build-playlist.mjs scripts/curation-13707544281.csv "Test - 90s Auto-Keep" --keep-column Recommendation --keep-value "Auto-keep"
```

This uses the existing curation CSV's `Recommendation` column instead of `Final decision`. It'll build a 135-track playlist from the top-25% mainstream 90s tracks. You can verify it shows up correctly on deezer.com, then delete it.

---

## Troubleshooting

### `Missing DEEZER_APP_ID or DEEZER_APP_SECRET`

You haven't added them to `.env.local`. See Step 2 above.

### Browser doesn't auto-open

Some systems block exec-launched browsers. Paste the URL the script prints into your browser manually.

### `Authorization rejected`

You clicked Decline on the Deezer auth page. Re-run the script and click Authorize.

### `Token exchange failed`

Usually means the redirect URI on your Deezer app doesn't match exactly. Double-check it's `http://localhost:8765/auth` (no trailing slash, http not https).

### `Add tracks failed: 400`

Could be:
- A track ID in your CSV doesn't exist on Deezer anymore (rare)
- You hit Deezer's rate limit (script handles this by sleeping; if persistent, increase `RATE_LIMIT_DELAY_MS` in build-playlist.mjs)

### Reset / re-auth

If the access token gets invalidated for any reason: delete the `DEEZER_ACCESS_TOKEN=` line from `.env.local` and re-run `scripts/deezer-auth.mjs`.

---

## Why this approach beats Soundiiz

| Concern | Custom scripts | Soundiiz Pro |
|---|---|---|
| Annual cost | $0 | $54 |
| Match accuracy | 100% (Deezer IDs from our own script — no fuzzy search) | ~95% (their fuzzy match) |
| Workflow fit | Designed exactly for our Curate→Decide→Build pattern | General-purpose tool, has more options |
| Setup time | 10 min one-time | 3 min one-time |
| Future scaling | Free for unlimited packs | $54/yr ongoing |
| Maintenance | We maintain the script | They maintain the tool |

For the 50+ packs you and the family will build, the custom path is hands-down better. Soundiiz would have been worth it for ad-hoc one-offs; this script wins for systematic curation.

---

## What's gitignored

- `.env.local` — your DEEZER_* credentials. Never commits to git. Safe.
- `scripts/curation-*.csv` — the analysis output CSVs. These ARE committed currently as reference data. If you want to keep your editing copies private, edit them locally without committing back.
