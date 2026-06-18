#!/usr/bin/env node
/**
 * Extract HIGH-confidence per-track "source" metadata from a Deezer
 * playlist's track + album titles. This is the cheap auto pass — it only
 * captures entries with an explicit soundtrack/cast-recording qualifier
 * or a "From X" pattern. Everything else punts to scripts/propose-sources.mjs
 * (LLM-proposed) for curator review.
 *
 * Output (two CSVs):
 *   scripts/sources-extracted-<pack-slug>.csv  — HIGH-confidence hits, Source column filled
 *   scripts/sources-unmatched-<pack-slug>.csv  — everything else, Source blank
 *
 * Both CSVs share the same schema so they can both be ingested by
 * scripts/apply-sources.mjs once curator-confirmed.
 *
 * Usage:
 *   node scripts/extract-sources.mjs <deezer-playlist-id> <pack-slug>
 *
 * Example:
 *   node scripts/extract-sources.mjs 15427798341 movie-classics
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const playlistId = process.argv[2];
const packSlug = process.argv[3];
if (!playlistId || !packSlug) {
  console.error('Usage: node scripts/extract-sources.mjs <deezer-playlist-id> <pack-slug>');
  process.exit(1);
}

async function fetchPlaylistTracks(playlistId) {
  const all = [];
  let index = 0;
  const limit = 100;
  while (true) {
    const url = `https://api.deezer.com/playlist/${playlistId}/tracks?index=${index}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (data.error) break;
    const batch = data.data || [];
    all.push(...batch);
    if (!data.next || batch.length < limit) break;
    index += limit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return all;
}

/**
 * Returns a high-confidence source string or null.
 * HIGH confidence = album has an explicit soundtrack/cast qualifier OR
 * track title has a "From X" pattern. Anything weaker is punted to LLM.
 */
function extractHighConfidence(track) {
  const album = track.album?.title || '';
  const title = track.title || '';

  // Pattern A: track title "from "X"" / "From X"
  const fromPatterns = [
    /\([Ff]rom\s+["'](.+?)["']/,
    /\([Ff]rom\s+the\s+["'](.+?)["']/,
    /\b[Ff]rom\s+["'](.+?)["']/,
    /\b[Ff]rom\s+the\s+["'](.+?)["']/,
  ];
  for (const re of fromPatterns) {
    const m = title.match(re);
    if (m) return m[1].trim();
  }

  // Pattern B: album has explicit soundtrack/cast qualifier — strip the qualifier
  const STRIP = [
    /\s*[:\-—]?\s*\((?:The\s+)?Original\s+Motion\s+Picture\s+Soundtrack\).*$/i,
    /\s*[:\-—]?\s*\((?:The\s+)?Original\s+Motion\s+Picture\s+Score\).*$/i,
    /\s*[:\-—]?\s*\(Original\s+Soundtrack(?:\s+Album)?\).*$/i,
    /\s*[:\-—]?\s*\(O\.?S\.?T\.?\).*$/i,
    /\s*[:\-—]?\s*\(Music\s+[Ff]rom\s+the\s+(?:HBO|Netflix|Apple|Original|Motion|Major)[^)]+\).*$/i,
    /\s*[:\-—]?\s*\(Music\s+[Ff]rom\s+the\s+["'][^"']+["'][^)]*\).*$/i,
    /\s*[:\-—]?\s*\(Music\s+[Ff]rom\s+the\s+Motion\s+Picture\).*$/i,
    /\s*[:\-—]?\s*\(Music\s+Inspired\s+by[^)]+\).*$/i,
    /\s*[:\-—]?\s*\(Original\s+Broadway\s+Cast\s+Recording\).*$/i,
    /\s*[:\-—]?\s*\(Original\s+Cast\s+Recording\).*$/i,
    /\s*[:\-—]?\s*\(Original\s+Broadway\s+Cast\).*$/i,
    /\s*[:\-—]?\s*\(Broadway\s+Cast\s+Recording\).*$/i,
    /\s*[:\-—]?\s*Original\s+Motion\s+Picture\s+Soundtrack.*$/i,
    /\s*[:\-—]?\s*Original\s+Motion\s+Picture\s+Score.*$/i,
    /\s*[:\-—]?\s*Original\s+Broadway\s+Cast\s+Recording.*$/i,
  ];
  for (const re of STRIP) {
    if (re.test(album)) {
      let stripped = album.replace(re, '').trim();
      // Trim trailing punctuation
      stripped = stripped.replace(/[:\-—]\s*$/, '').trim();
      // Strip Episode / Volume info
      stripped = stripped
        .replace(/[:\-]\s*Episode\s+[IVX0-9]+.*$/i, '')
        .replace(/[:\-]\s*Vol\.?\s+[0-9].*$/i, '')
        .trim();
      if (stripped.length > 0 && stripped.length < 80) return stripped;
    }
  }

  return null;
}

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function main() {
  console.log(`=== Extract Sources (HIGH-confidence only): ${packSlug} ===\n`);
  console.log(`Fetching Deezer playlist ${playlistId}...`);
  const tracks = await fetchPlaylistTracks(playlistId);
  console.log(`Got ${tracks.length} tracks\n`);

  const extracted = [];
  const unmatched = [];
  for (const t of tracks) {
    if (!t || !t.id) continue;
    const source = extractHighConfidence(t);
    const row = {
      DeezerId: t.id,
      Title: t.title,
      Artist: t.artist?.name || '',
      Album: t.album?.title || '',
      Source: source || '',
    };
    if (source) extracted.push(row);
    else unmatched.push(row);
  }

  console.log('=== RESULTS ===');
  console.log(`  HIGH-confidence auto-extracted: ${extracted.length}  (${Math.round((extracted.length / tracks.length) * 100)}%)`);
  console.log(`  Needs LLM proposal + curator:   ${unmatched.length}  (${Math.round((unmatched.length / tracks.length) * 100)}%)`);

  const headers = ['DeezerId', 'Title', 'Artist', 'Album', 'Source'];
  for (const [name, rows] of [
    ['extracted', extracted],
    ['unmatched', unmatched],
  ]) {
    let csv = headers.join(',') + '\n';
    for (const r of rows) csv += headers.map((h) => csvField(r[h])).join(',') + '\n';
    const outPath = join(__dirname, `sources-${name}-${packSlug}.csv`);
    writeFileSync(outPath, csv);
    console.log(`✓ Wrote ${outPath}`);
  }

  if (extracted.length > 0) {
    console.log('\n=== SAMPLE EXTRACTED ===');
    for (const r of extracted.slice(0, 10)) {
      console.log(`  ${r.Title.slice(0, 50).padEnd(50)} → ${r.Source}`);
    }
  }

  console.log('\n=== NEXT STEPS ===');
  console.log(`1. node scripts/apply-sources.mjs scripts/sources-extracted-${packSlug}.csv`);
  console.log(`   (merges the HIGH-confidence hits into assets/sources/all.json)`);
  console.log(`2. node scripts/propose-sources.mjs scripts/sources-unmatched-${packSlug}.csv`);
  console.log(`   (LLM proposes sources for the rest — requires ANTHROPIC_API_KEY)`);
  console.log(`3. Open scripts/proposed-sources-${packSlug}.csv in Sheets, validate, save.`);
  console.log(`4. node scripts/apply-sources.mjs scripts/proposed-sources-${packSlug}.csv`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
