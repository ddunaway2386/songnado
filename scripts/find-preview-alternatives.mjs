#!/usr/bin/env node
/**
 * Find Deezer preview alternatives for no-preview tracks.
 *
 * Background: Songnado packs need every track to have a playable
 * 30-second preview URL. Some Deezer tracks lack a preview URL even
 * though the song is in the catalog — usually because the version
 * we linked is from a release without preview rights. But there are
 * often OTHER versions (different album release, remaster, deluxe
 * edition) of the SAME song that DO have a preview.
 *
 * This script:
 *  1. Loads a curation CSV (output of curate-playlist.mjs)
 *  2. Filters to tracks marked HasPreview = false
 *  3. For each, searches Deezer for the same title + artist
 *  4. Filters out karaoke/tribute/instrumental/cover versions
 *  5. Picks the best alternate that DOES have a preview
 *  6. Outputs a substitution CSV: original ID → replacement ID
 *
 * The curator reviews the substitutions and either:
 *  - Manually swaps tracks in Deezer's UI (find original, delete, add new)
 *  - Or uses Soundiiz Pro to bulk-build a new playlist with replacements
 *
 * Usage:
 *   node scripts/find-preview-alternatives.mjs <curation-csv>
 *
 * Example:
 *   node scripts/find-preview-alternatives.mjs scripts/curation-13707544281.csv
 *
 * Outputs:
 *   scripts/preview-substitutions-<id>.csv
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/find-preview-alternatives.mjs <curation-csv>');
  process.exit(1);
}

const REQUEST_DELAY_MS = 100;
const SEARCH_LIMIT = 10; // candidates to consider per track

// Markers that suggest a track is karaoke / cover / tribute / instrumental
// → cut these from alternative search results
const REJECT_PATTERNS = [
  /karaoke/i,
  /tribute/i,
  /\b(made\s*famous\s*by)\b/i,
  /\bcover\b/i,
  /\binstrumental\b/i,
  /\bbackground music\b/i,
  /\bmusical box\b/i,
  /\bmusic box version\b/i,
  /\bpiano version\b/i,
  /\bin the style of\b/i,
  /\boriginally performed by\b/i,
];

function shouldReject(text) {
  if (!text) return false;
  return REJECT_PATTERNS.some((re) => re.test(text));
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === ',') {
        result.push(current);
        current = '';
      } else if (c === '"' && current.length === 0) {
        inQuotes = true;
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    headers.forEach((h, j) => (row[h] = fields[j] ?? ''));
    return row;
  });
  return { headers, rows };
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*-\s*remaster.*$/i, '')
    .replace(/\s*-\s*live.*$/i, '')
    .replace(/\s*-\s*single version.*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looselyMatches(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function searchDeezer(title, artist) {
  const q = `track:"${title}" artist:"${artist}"`;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

function pickBestAlternative(candidates, wantedTitle, wantedArtist, excludeId) {
  // Score each candidate. Higher = better.
  // Required: hasPreview, no karaoke/cover/tribute markers, artist matches, title matches
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (String(c.id) === String(excludeId)) continue;
    if (!c.preview) continue;
    if (shouldReject(c.title)) continue;
    if (shouldReject(c.artist?.name)) continue;
    if (shouldReject(c.album?.title)) continue;
    if (!looselyMatches(c.title, wantedTitle)) continue;
    if (!looselyMatches(c.artist?.name, wantedArtist)) continue;

    // Score
    let score = 50; // base
    // Prefer exact title match
    if (normalize(c.title) === normalize(wantedTitle)) score += 30;
    // Prefer higher rank (more popular = probably the canonical version)
    if (typeof c.rank === 'number') score += c.rank / 100000; // 0-10 bonus
    // Slight penalty for live/remaster/deluxe in title (lower fidelity to original)
    if (/\blive\b/i.test(c.title)) score -= 15;
    if (/\bremaster/i.test(c.title)) score -= 5;
    if (/\bdeluxe\b/i.test(c.title)) score -= 5;
    if (/\bedited version\b/i.test(c.title)) score -= 5;
    // Bonus if it's the clean radio/single version (often better preview)
    if (/\bsingle version\b/i.test(c.title)) score += 5;
    if (/\bradio edit\b/i.test(c.title)) score += 5;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function toCsvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function main() {
  console.log('=== Find Preview Alternatives ===\n');
  if (!existsSync(inputPath)) {
    console.error(`✗ File not found: ${inputPath}`);
    process.exit(1);
  }

  const text = readFileSync(inputPath, 'utf8');
  const { headers, rows } = parseCsv(text);

  // Filter to no-preview tracks
  const noPreview = rows.filter(
    (r) => r.HasPreview === 'false' || r.HasPreview === false
  );
  console.log(`Total tracks: ${rows.length}`);
  console.log(`No-preview tracks: ${noPreview.length}\n`);

  if (noPreview.length === 0) {
    console.log('Nothing to do — no no-preview tracks in this CSV.');
    return;
  }

  console.log(`Searching for alternatives (${REQUEST_DELAY_MS}ms between calls)...\n`);

  const results = [];
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < noPreview.length; i++) {
    const track = noPreview[i];
    const candidates = await searchDeezer(track.Title, track.Artist);
    const alt = pickBestAlternative(
      candidates,
      track.Title,
      track.Artist,
      track.DeezerId
    );

    const mark = alt ? '✓' : '✗';
    const note = alt ? `→ ${alt.title} (${alt.album?.title || ''})` : '— no alt found';
    console.log(`[${i + 1}/${noPreview.length}] ${mark} ${track.Title} — ${track.Artist} ${note}`);

    if (alt) {
      found++;
      results.push({
        OriginalTitle: track.Title,
        OriginalArtist: track.Artist,
        OriginalDeezerId: track.DeezerId,
        OriginalRank: track.Rank,
        AlternativeTitle: alt.title,
        AlternativeArtist: alt.artist?.name || '',
        AlternativeAlbum: alt.album?.title || '',
        AlternativeDeezerId: alt.id,
        AlternativeRank: alt.rank ?? '',
        AlternativeDurationSec: alt.duration ?? '',
        // Deezer track page URL — opens in web player with a play button.
        // Use THIS to listen, not the raw MP3 URL (which browsers often
        // download instead of stream, or block as untrusted media).
        DeezerTrackUrl: `https://www.deezer.com/us/track/${alt.id}`,
        AlternativePreviewUrl: alt.preview, // raw MP3 — kept for use in app code
        ConfidenceNote: normalize(alt.title) === normalize(track.Title) ? 'Exact title match' : 'Loose match — listen before swapping',
      });
    } else {
      notFound++;
      results.push({
        OriginalTitle: track.Title,
        OriginalArtist: track.Artist,
        OriginalDeezerId: track.DeezerId,
        OriginalRank: track.Rank,
        AlternativeTitle: '',
        AlternativeArtist: '',
        AlternativeAlbum: '',
        AlternativeDeezerId: '',
        AlternativeRank: '',
        AlternativeDurationSec: '',
        DeezerTrackUrl: '',
        AlternativePreviewUrl: '',
        ConfidenceNote: 'NO ALTERNATIVE — keep cut',
      });
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Found alternatives: ${found}/${noPreview.length} (${Math.round((found / noPreview.length) * 100)}%)`);
  console.log(`  No alternative found: ${notFound}/${noPreview.length}\n`);

  // Write substitution CSV
  const inputBase = basename(inputPath, '.csv').replace(/^curation-/, '');
  const outPath = join(__dirname, `preview-substitutions-${inputBase}.csv`);
  const csvHeaders = [
    'OriginalTitle', 'OriginalArtist', 'OriginalDeezerId', 'OriginalRank',
    'AlternativeTitle', 'AlternativeArtist', 'AlternativeAlbum',
    'AlternativeDeezerId', 'AlternativeRank', 'AlternativeDurationSec',
    'DeezerTrackUrl', 'AlternativePreviewUrl', 'ConfidenceNote',
  ];
  let csv = csvHeaders.join(',') + '\n';
  for (const r of results) {
    csv += csvHeaders.map((h) => toCsvField(r[h])).join(',') + '\n';
  }
  writeFileSync(outPath, csv);
  console.log(`✓ Wrote ${outPath}\n`);

  console.log('=== NEXT STEPS ===');
  console.log(`1. Open the CSV in Sheets`);
  console.log(`2. Filter to rows where AlternativeDeezerId is not empty`);
  console.log(`3. For each row:`);
  console.log(`   a. Click the DeezerTrackUrl — opens in Deezer's web player, click ▶ to listen`);
  console.log(`   b. If it sounds like the right song → mark Approved`);
  console.log(`   c. If wrong song/version → mark Skip`);
  console.log(`4. For Approved rows: in Deezer, remove the OriginalDeezerId track, add AlternativeDeezerId`);
  console.log(`5. Re-run auto-curate.mjs on the updated playlist — your final pack count will jump`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
