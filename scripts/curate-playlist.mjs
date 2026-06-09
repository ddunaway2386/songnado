#!/usr/bin/env node
/**
 * Songnado curation assistant — pre-sorts a Deezer playlist for the curator.
 *
 * Pulls every track from a Deezer playlist via the public API, then for each
 * track:
 *  - Records Deezer's `rank` (popularity score 0-1M; higher = more mainstream)
 *  - Detects exact and near-duplicate tracks
 *  - Counts per-artist concentration (catches "we have 28 Garth Brooks tracks")
 *  - Pre-recommends Auto-keep / Auto-cut / Manual review based on rank quartile
 *  - Flags tracks with very short previews (likely problematic preview windows)
 *
 * Outputs:
 *  - scripts/curation-<id>.csv (sortable spreadsheet, open in Sheets/Excel)
 *  - Console summary with top-level stats
 *
 * Usage:
 *   node scripts/curate-playlist.mjs <deezer-playlist-id>
 *
 * Example:
 *   node scripts/curate-playlist.mjs 13707544281
 *
 * This is a curation AID, not a final-say. The CSV gives you a starting
 * point — you still make taste-based decisions on the 'Manual review' band.
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const playlistId = process.argv[2];
if (!playlistId) {
  console.error('Usage: node scripts/curate-playlist.mjs <deezer-playlist-id>');
  console.error('  e.g.   node scripts/curate-playlist.mjs 13707544281');
  process.exit(1);
}

const REQUEST_DELAY_MS = 100;
const PAGE_SIZE = 100; // Deezer max per page

/** Normalize a string for fuzzy comparison — lowercase, strip punctuation. */
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/\(.*?\)/g, '')   // strip parenthetical e.g. "(Remastered 2009)"
    .replace(/\[.*?\]/g, '')   // strip bracketed e.g. "[Live Version]"
    .replace(/\s*-\s*remaster.*$/i, '')
    .replace(/\s*-\s*live.*$/i, '')
    .replace(/\s*-\s*single version.*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPlaylistMeta(id) {
  const url = `https://api.deezer.com/playlist/${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Playlist fetch failed: ${res.status}`);
  return res.json();
}

async function fetchPlaylistTracks(id) {
  let allTracks = [];
  let index = 0;
  while (true) {
    const url = `https://api.deezer.com/playlist/${id}/tracks?limit=${PAGE_SIZE}&index=${index}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tracks fetch failed at index ${index}: ${res.status}`);
    const json = await res.json();
    if (!json.data || json.data.length === 0) break;
    allTracks.push(...json.data);
    if (json.data.length < PAGE_SIZE) break;
    index += PAGE_SIZE;
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  return allTracks;
}

function analyze(tracks) {
  // Step 1: build artist concentration map
  const artistCounts = new Map();
  for (const t of tracks) {
    const name = t.artist?.name || '(unknown)';
    artistCounts.set(name, (artistCounts.get(name) || 0) + 1);
  }
  const total = tracks.length;
  const fivePercentThreshold = Math.ceil(total * 0.05);

  // Step 2: build duplicate detection
  // - exact: same Deezer track ID
  // - near: same normalized title + same normalized artist
  const seenIds = new Set();
  const titleArtistMap = new Map(); // normalized key → first occurrence
  const enriched = tracks.map((t, idx) => {
    const titleKey = normalize(t.title || '');
    const artistKey = normalize(t.artist?.name || '');
    const key = `${titleKey}|||${artistKey}`;

    const isExactDup = seenIds.has(t.id);
    const nearDupOf = titleArtistMap.get(key);
    seenIds.add(t.id);
    if (!nearDupOf) titleArtistMap.set(key, idx + 1);

    return {
      position: idx + 1,
      title: t.title,
      artist: t.artist?.name || '',
      deezerId: t.id,
      rank: t.rank || 0,
      durationSec: t.duration || 0,
      previewUrl: t.preview || '',
      hasPreview: !!t.preview,
      explicit: !!t.explicit_lyrics,
      album: t.album?.title || '',
      artistCount: artistCounts.get(t.artist?.name) || 1,
      artistOverConcentrated: (artistCounts.get(t.artist?.name) || 0) > fivePercentThreshold,
      isExactDup,
      nearDupOfPosition: nearDupOf || '',
    };
  });

  // Step 3: rank quartiles
  const sortedRanks = [...enriched].map((e) => e.rank).sort((a, b) => b - a);
  const top25Cutoff = sortedRanks[Math.floor(sortedRanks.length * 0.25)];
  const bottom25Cutoff = sortedRanks[Math.floor(sortedRanks.length * 0.75)];

  // Step 4: recommendation
  for (const e of enriched) {
    if (e.isExactDup) {
      e.recommendation = 'Auto-cut';
      e.reason = 'Exact duplicate of an earlier track in playlist';
    } else if (e.nearDupOfPosition) {
      e.recommendation = 'Manual review';
      e.reason = `Likely duplicate of position ${e.nearDupOfPosition} (different version)`;
    } else if (!e.hasPreview) {
      e.recommendation = 'Auto-cut';
      e.reason = 'No preview URL — unplayable in game';
    } else if (e.durationSec < 60) {
      e.recommendation = 'Auto-cut';
      e.reason = `Very short track (${e.durationSec}s) — likely interlude or intro`;
    } else if (e.artistOverConcentrated && e.rank < top25Cutoff) {
      e.recommendation = 'Manual review';
      e.reason = `Artist over-represented (${e.artistCount} tracks, ${Math.round(e.artistCount / total * 100)}% of playlist) and this is not their biggest hit`;
    } else if (e.rank >= top25Cutoff) {
      e.recommendation = 'Auto-keep';
      e.reason = 'Top 25% by popularity — defining track for the era';
    } else if (e.rank <= bottom25Cutoff) {
      e.recommendation = 'Manual review';
      e.reason = 'Bottom 25% by popularity — probably deeper cut, listen and decide';
    } else {
      e.recommendation = 'Manual review';
      e.reason = 'Mid-tier popularity — listen to preview and decide';
    }
  }

  return { enriched, artistCounts, total, top25Cutoff, bottom25Cutoff };
}

function statusBadge(rec) {
  if (rec === 'Auto-keep') return '✅';
  if (rec === 'Auto-cut') return '❌';
  return '👁️';
}

function writeCsv(enriched, outPath) {
  const headers = [
    'Position', 'Title', 'Artist', 'Album', 'DeezerId', 'Rank',
    'PopularityTier', 'ArtistCount', 'ArtistOverRepresented', 'DurationSec',
    'HasPreview', 'Explicit', 'IsExactDup', 'NearDupOfPosition',
    'Recommendation', 'Reason', 'PreviewUrl',
  ];
  let csv = headers.join(',') + '\n';
  // Sort by recommendation (Auto-keep first, then Manual review by rank desc, then Auto-cut)
  const order = { 'Auto-keep': 1, 'Manual review': 2, 'Auto-cut': 3 };
  const sorted = [...enriched].sort((a, b) => {
    const oa = order[a.recommendation], ob = order[b.recommendation];
    if (oa !== ob) return oa - ob;
    return b.rank - a.rank; // within tier, sort by rank desc
  });
  for (const e of sorted) {
    const tier = e.rank > 500000 ? 'Top 25%' : e.rank > 200000 ? 'Mid 50%' : 'Bottom 25%';
    const fields = [
      e.position, e.title, e.artist, e.album, e.deezerId, e.rank,
      tier, e.artistCount, e.artistOverConcentrated, e.durationSec,
      e.hasPreview, e.explicit, e.isExactDup, e.nearDupOfPosition,
      e.recommendation, e.reason, e.previewUrl,
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
    csv += fields.join(',') + '\n';
  }
  writeFileSync(outPath, csv);
}

async function main() {
  console.log(`Songnado curation assistant\n=== Playlist ${playlistId} ===\n`);

  console.log('Fetching playlist metadata...');
  const meta = await fetchPlaylistMeta(playlistId);
  console.log(`  Name: ${meta.title}`);
  console.log(`  Tracks: ${meta.nb_tracks}`);
  console.log(`  Creator: ${meta.creator?.name || '(unknown)'}\n`);

  console.log('Fetching tracks...');
  const tracks = await fetchPlaylistTracks(playlistId);
  console.log(`  Pulled ${tracks.length} tracks\n`);

  console.log('Analyzing...');
  const { enriched, artistCounts, total } = analyze(tracks);

  // Summary stats
  const byRec = enriched.reduce((acc, e) => {
    acc[e.recommendation] = (acc[e.recommendation] || 0) + 1;
    return acc;
  }, {});

  console.log('\n=== RECOMMENDATIONS ===');
  for (const rec of ['Auto-keep', 'Manual review', 'Auto-cut']) {
    const count = byRec[rec] || 0;
    const pct = Math.round((count / total) * 100);
    console.log(`  ${statusBadge(rec)} ${rec.padEnd(15)} ${count.toString().padStart(4)} tracks  (${pct}%)`);
  }

  // Top concentrated artists
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('\n=== TOP 10 ARTISTS BY TRACK COUNT ===');
  for (const [name, count] of topArtists) {
    const pct = ((count / total) * 100).toFixed(1);
    const flag = count > Math.ceil(total * 0.05) ? '⚠️  over-rep' : '';
    console.log(`  ${name.padEnd(35)} ${count.toString().padStart(3)} tracks  (${pct}%)  ${flag}`);
  }

  // Duplicate stats
  const exactDups = enriched.filter((e) => e.isExactDup).length;
  const nearDups = enriched.filter((e) => e.nearDupOfPosition && !e.isExactDup).length;
  console.log('\n=== DUPLICATES ===');
  console.log(`  Exact duplicates: ${exactDups}`);
  console.log(`  Likely duplicates (different version): ${nearDups}`);

  // No-preview stats
  const noPreview = enriched.filter((e) => !e.hasPreview).length;
  console.log(`\n=== NO-PREVIEW TRACKS: ${noPreview} ===`);

  // Write CSV
  const outPath = join(__dirname, `curation-${playlistId}.csv`);
  writeCsv(enriched, outPath);
  console.log(`\nWrote ${outPath}`);

  console.log(`\n=== SUGGESTED WORKFLOW ===`);
  console.log(`1. Open the CSV in Google Sheets`);
  console.log(`2. Sort by Recommendation (Auto-keep first)`);
  console.log(`3. Top section: ${byRec['Auto-keep'] || 0} tracks pre-greenlit (just glance to confirm)`);
  console.log(`4. Middle section: ${byRec['Manual review'] || 0} tracks need your taste call`);
  console.log(`   - Click each row's PreviewUrl to hear the 30s clip in browser`);
  console.log(`   - Mark Keep/Cut in a new column`);
  console.log(`5. Bottom section: ${byRec['Auto-cut'] || 0} tracks pre-flagged for cut`);
  console.log(`   - Quick scan; restore any you disagree with`);
  console.log(`6. Apply final keep/cut by opening playlist on Deezer.com and removing rejected tracks`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
