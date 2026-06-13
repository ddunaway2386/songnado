#!/usr/bin/env node
/**
 * Build a thematic pack candidate set from N Deezer editorial playlists.
 *
 * Unlike decade packs (which start from one curator-owned kitchen-sink),
 * thematic packs (Wedding, Road Trip, Christmas, etc.) don't have an
 * obvious single source. This script aggregates multiple editorial
 * playlists and splits the result into:
 *
 *  - AUTO-KEEP: tracks that appear in 3+ source playlists OR (2 sources
 *    AND Deezer rank > 500000). These are high-confidence canonical
 *    picks for the theme — no review needed.
 *
 *  - REVIEW:   everything else. Output in preview-substitutions schema
 *    so the existing generate-preview-player.mjs renders it directly.
 *
 * The review CSV is what the curator passes through the HTML player.
 * Approved review tracks then get appended to the auto-keep CSV the
 * same way gap-track approvals were appended to the 80s pack.
 *
 * Usage:
 *   node scripts/build-thematic-pack.mjs <theme-slug> <source-id-1> [<source-id-2> ...]
 *
 * Theme slug is a kebab-case identifier used in output filenames:
 *   wedding, road-trip, christmas, workout, etc.
 *
 * Example:
 *   node scripts/build-thematic-pack.mjs wedding 10487541482 1368562205 2252328026 1156706861 11941081221 11951170981
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/build-thematic-pack.mjs <theme-slug> <source-id-1> [<source-id-2> ...]');
  process.exit(1);
}
const themeSlug = args[0];
const sourceIds = args.slice(1);

// Auto-keep thresholds. Tuned for thematic packs (Wedding, Road Trip) where
// editorial source playlists are small and overlap is naturally low, so a
// strict "3+ sources" rule would push too many obvious-fits into review.
const MIN_SOURCES_FOR_AUTOKEEP = 3;
const RANK_THRESHOLD_FOR_2_SOURCE_AUTOKEEP = 200000;
const RANK_THRESHOLD_FOR_1_SOURCE_AUTOKEEP = 700000;

const REQUEST_DELAY_MS = 100;

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[''']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*-\s*remaster.*$/i, '')
    .replace(/\s*-\s*live.*$/i, '')
    .replace(/\s*-\s*single version.*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getPlaylistMeta(playlistId) {
  try {
    const res = await fetch(`https://api.deezer.com/playlist/${playlistId}`);
    if (!res.ok) return { title: `Playlist ${playlistId}`, nb_tracks: 0 };
    const data = await res.json();
    return { title: data.title || `Playlist ${playlistId}`, nb_tracks: data.nb_tracks ?? 0 };
  } catch {
    return { title: `Playlist ${playlistId}`, nb_tracks: 0 };
  }
}

async function fetchPlaylistTracks(playlistId) {
  const tracks = [];
  let index = 0;
  const limit = 100;
  while (true) {
    const url = `https://api.deezer.com/playlist/${playlistId}/tracks?index=${index}&limit=${limit}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return tracks;
      const data = await res.json();
      if (data.error) return tracks;
      const batch = data.data || [];
      tracks.push(...batch);
      if (!data.next || batch.length < limit) break;
      index += limit;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    } catch {
      return tracks;
    }
  }
  return tracks;
}

async function main() {
  console.log(`=== Build Thematic Pack: ${themeSlug} ===\n`);
  console.log(`Source playlists: ${sourceIds.length}`);
  console.log(`Auto-keep rule: ${MIN_SOURCES_FOR_AUTOKEEP}+ sources OR (2 sources AND rank > ${RANK_THRESHOLD_FOR_2_SOURCE_AUTOKEEP}) OR (1 source AND rank > ${RANK_THRESHOLD_FOR_1_SOURCE_AUTOKEEP})\n`);

  const candidates = new Map();
  let totalFetched = 0;
  for (const sid of sourceIds) {
    const meta = await getPlaylistMeta(sid);
    process.stdout.write(`Fetching "${meta.title}" (id=${sid})... `);
    const tracks = await fetchPlaylistTracks(sid);
    process.stdout.write(`${tracks.length}\n`);
    totalFetched += tracks.length;
    for (const t of tracks) {
      if (!t || !t.id) continue;
      const key = normalize(t.title) + '|' + normalize(t.artist?.name);
      const existing = candidates.get(key);
      if (existing) {
        existing.sources.add(meta.title);
        if ((t.rank || 0) > (existing.track.rank || 0)) existing.track = t;
      } else {
        candidates.set(key, { track: t, sources: new Set([meta.title]) });
      }
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log(`\nTotal raw tracks fetched: ${totalFetched}`);
  console.log(`Unique tracks after dedup: ${candidates.size}\n`);

  const autokeep = [];
  const review = [];
  let droppedNoPreview = 0;
  for (const [, c] of candidates) {
    if (!c.track.preview) {
      droppedNoPreview++;
      continue;
    }
    const sourceCount = c.sources.size;
    const rank = c.track.rank || 0;
    const isAutoKeep =
      sourceCount >= MIN_SOURCES_FOR_AUTOKEEP ||
      (sourceCount >= 2 && rank > RANK_THRESHOLD_FOR_2_SOURCE_AUTOKEEP) ||
      (sourceCount >= 1 && rank > RANK_THRESHOLD_FOR_1_SOURCE_AUTOKEEP);
    if (isAutoKeep) autokeep.push(c);
    else review.push(c);
  }

  console.log(`Dropped (no preview):  ${droppedNoPreview}`);
  console.log(`AUTO-KEEP:             ${autokeep.length}`);
  console.log(`REVIEW (needs taste):  ${review.length}\n`);

  // Sort: more sources first, then by rank desc
  const sorter = (a, b) => {
    const d = b.sources.size - a.sources.size;
    if (d !== 0) return d;
    return (b.track.rank || 0) - (a.track.rank || 0);
  };
  autokeep.sort(sorter);
  review.sort(sorter);

  // Write auto-keep as final-pack schema (DeezerId, Title, Artist, Source)
  const autokeepHeaders = ['DeezerId', 'Title', 'Artist', 'Source'];
  let autokeepCsv = autokeepHeaders.join(',') + '\n';
  for (const c of autokeep) {
    const t = c.track;
    const sourceStr = `thematic-autokeep (${c.sources.size} editorial lists)`;
    autokeepCsv += [csvField(t.id), csvField(t.title), csvField(t.artist?.name || ''), csvField(sourceStr)].join(',') + '\n';
  }
  const autokeepPath = join(__dirname, `final-pack-theme-${themeSlug}.csv`);
  writeFileSync(autokeepPath, autokeepCsv);
  console.log(`✓ Wrote ${autokeepPath}`);

  // Write review CSV in preview-substitutions schema
  const reviewHeaders = [
    'OriginalTitle', 'OriginalArtist', 'OriginalDeezerId', 'OriginalRank',
    'AlternativeTitle', 'AlternativeArtist', 'AlternativeAlbum',
    'AlternativeDeezerId', 'AlternativeRank', 'AlternativeDurationSec',
    'AlternativeExplicit', 'DeezerTrackUrl', 'AlternativePreviewUrl',
    'ConfidenceNote',
  ];
  let reviewCsv = reviewHeaders.join(',') + '\n';
  for (const c of review) {
    const t = c.track;
    const note = c.sources.size > 1
      ? `On ${c.sources.size} editorial lists`
      : `On 1 list: ${Array.from(c.sources)[0]}`;
    const row = {
      OriginalTitle: '(thematic candidate)',
      OriginalArtist: '',
      OriginalDeezerId: '',
      OriginalRank: '',
      AlternativeTitle: t.title,
      AlternativeArtist: t.artist?.name || '',
      AlternativeAlbum: t.album?.title || '',
      AlternativeDeezerId: t.id,
      AlternativeRank: t.rank ?? '',
      AlternativeDurationSec: t.duration ?? '',
      AlternativeExplicit: t.explicit_lyrics ? 'true' : 'false',
      DeezerTrackUrl: `https://www.deezer.com/us/track/${t.id}`,
      AlternativePreviewUrl: t.preview || '',
      ConfidenceNote: note,
    };
    reviewCsv += reviewHeaders.map((h) => csvField(row[h])).join(',') + '\n';
  }
  const reviewPath = join(__dirname, `preview-substitutions-theme-${themeSlug}.csv`);
  writeFileSync(reviewPath, reviewCsv);
  console.log(`✓ Wrote ${reviewPath}`);

  console.log('\n=== TOP 15 AUTO-KEEP ===');
  for (const c of autokeep.slice(0, 15)) {
    console.log(`  [${c.sources.size}x src, rank ${c.track.rank || '?'}]  ${c.track.title} — ${c.track.artist?.name}`);
  }

  console.log('\n=== TOP 15 REVIEW CANDIDATES ===');
  for (const c of review.slice(0, 15)) {
    console.log(`  [${c.sources.size}x src, rank ${c.track.rank || '?'}]  ${c.track.title} — ${c.track.artist?.name}`);
  }

  console.log('\n=== NEXT STEPS ===');
  console.log(`1. node scripts/generate-preview-player.mjs ${reviewPath}`);
  console.log(`2. Open the HTML, review ${review.length} tracks, Export approved CSV`);
  console.log(`3. We append approved rows to ${autokeepPath} → final theme pack`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
