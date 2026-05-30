# Curated playlist data

These JSON files are the pre-baked source-of-truth for Songnado's curated
playlists. See [`../../CURATED_PLAYLISTS_DESIGN.md`](../../CURATED_PLAYLISTS_DESIGN.md)
for the full architecture.

## Files

- `manifest.json` — lists every shipped curated playlist by id + filename.
  The loader (`lib/curated/loader.ts`) reads this to discover which playlists
  exist. Add a new entry here when shipping a new playlist.
- `songnado-smoke-test.json` — one-track playlist used to verify the loader,
  provider wiring, and end-to-end gameplay loop. The track URI is Spotify's
  own tutorial example (Carly Rae Jepsen, "Cut To The Feeling") — globally
  available, useful for diagnosing region-locked / track-removed issues
  separately from architectural issues. Safe to delete this once a real
  curated playlist ships.

## Schema (per playlist file)

```jsonc
{
  "id": "songnado-2010s-hits",        // opaque; prefixed songnado- to avoid Spotify-ID collisions
  "name": "2010s Hits",                // display name
  "imageUrl": "https://i.scdn.co/...", // playlist cover; can be empty string for now
  "tier": "free",                      // "free" | "pro"  — drives Songnado Premium gating
  "version": 1,                        // bump when regenerated; lets future OTA + index-reset logic notice
  "tracks": [
    {
      "uri": "spotify:track:7qiZfU4dY1lWllzX7mPBI3",  // full Spotify URI (not bare ID)
      "title": "Shape of You",
      "artist": "Ed Sheeran",
      "albumImageUrl": "https://i.scdn.co/...",       // optional — falls back to playlist imageUrl
      "durationMs": 233713                            // required — used by pickRandomStartMs
    }
  ]
}
```

## Adding a new playlist (operational workflow)

1. Curate the playlist on your own Spotify account (public playlist).
2. Open https://exportify.net and log in with your Spotify account.
3. Click Export on the playlist → download CSV.
4. Run the conversion script (`npm run curate` — TODO, not built yet) to
   convert CSV → JSON in the schema above.
5. Drop the JSON file in this directory.
6. Add an entry to `manifest.json`.
7. Add a `require()` line in `lib/curated/loader.ts` (Metro requires
   literal paths for static analysis).
8. Commit, rebuild dev client, verify in the picker.

Until the conversion script exists, hand-author small JSONs or convert
CSVs manually.

## Curation rules (from MONETIZATION_PLAN.md)

- No deep cuts — "would you skip it in a car?"
- No covers, remixes, or live versions
- No tracks under 90 seconds (breaks the 30-second random-window math)
- Mix decade-energy in combined packs
