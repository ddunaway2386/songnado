#!/usr/bin/env node
/**
 * Find candidate tracks NOT in our final-pack CSV by aggregating from
 * Deezer editorial / curated source playlists.
 *
 * Used after the curate + auto-curate + substitute workflow when the
 * curator suspects the source kitchen-sink missed canonical tracks.
 * Aggregates multiple Deezer editorial playlists, dedupes by normalized
 * title+artist, cross-references against final-pack, and emits CSV in
 * the same schema as preview-substitutions-*.csv so the existing HTML
 * player renders it without modification.
 *
 * Output is sorted by source-popularity:
 *  - Tracks appearing on multiple editorial lists rank highest
 *  - Within same source-count, sorted by Deezer rank desc
 *
 * Usage:
 *   node scripts/find-gap-tracks.mjs <target-pack-id> <source-id-1> [<source-id-2> ...]
 *
 * Example (80s pack vs 7 Deezer editorial 80s playlists):
 *   node scripts/find-gap-tracks.mjs 13700820281 867825522 11798808421 1913763402 8512471762 8621268482 8403360702 1276784581
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/find-gap-tracks.mjs <target-pack-id> <source-id-1> [<source-id-2> ...]');
  process.exit(1);
}
const targetPackId = args[0];
const sourceIds = args.slice(1);

const finalPackPath = join(__dirname, `final-pack-${targetPackId}.csv`);
if (!existsSync(finalPackPath)) {
  console.error(`✗ Missing final-pack: ${finalPackPath}`);
  process.exit(1);
}

const REQUEST_DELAY_MS = 100;

function parseCsvLine(line) {
  const r = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        r.push(cur);
        cur = '';
      } else if (c === '"' && cur.length === 0) {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  r.push(cur);
  return r;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    const o = {};
    headers.forEach((h, j) => (o[h] = f[j] ?? ''));
    return o;
  });
}

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
      if (!res.ok) {
        console.error(`  ✗ HTTP ${res.status} fetching ${playlistId}`);
        return tracks;
      }
      const data = await res.json();
      if (data.error) {
        console.error(`  ✗ Deezer error: ${data.error.message}`);
        return tracks;
      }
      const batch = data.data || [];
      tracks.push(...batch);
      if (!data.next || batch.length < limit) break;
      index += limit;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    } catch (e) {
      console.error(`  ✗ Fetch error: ${e.message}`);
      return tracks;
    }
  }
  return tracks;
}

async function main() {
  console.log('=== Find Gap Tracks ===\n');

  const packRows = parseCsv(readFileSync(finalPackPath, 'utf8'));
  const haveKeys = new Set(packRows.map((r) => normalize(r.Title) + '|' + normalize(r.Artist)));
  console.log(`Final pack: ${packRows.length} tracks already in`);
  console.log(`Source playlists to scan: ${sourceIds.length}\n`);

  const candidates = new Map();
  for (const sid of sourceIds) {
    const meta = await getPlaylistMeta(sid);
    console.log(`Fetching "${meta.title}" (id=${sid}, ${meta.nb_tracks} tracks)...`);
    const tracks = await fetchPlaylistTracks(sid);
    console.log(`  got ${tracks.length}`);
    for (const t of tracks) {
      if (!t || !t.id) continue;
      const key = normalize(t.title) + '|' + normalize(t.artist?.name);
      const existing = candidates.get(key);
      if (existing) {
        existing.sources.add(meta.title);
        if ((t.rank || 0) > (existing.track.rank || 0)) {
          existing.track = t;
        }
      } else {
        candidates.set(key, { track: t, sources: new Set([meta.title]) });
      }
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log(`\nUnique candidates across all sources: ${candidates.size}`);

  const gaps = [];
  let droppedAlreadyIn = 0;
  let droppedNoPreview = 0;
  for (const [key, c] of candidates) {
    if (haveKeys.has(key)) {
      droppedAlreadyIn++;
      continue;
    }
    if (!c.track.preview) {
      droppedNoPreview++;
      continue;
    }
    gaps.push(c);
  }
  console.log(`  Already in pack:   ${droppedAlreadyIn}`);
  console.log(`  No preview:        ${droppedNoPreview}`);
  console.log(`  Gap candidates:    ${gaps.length}\n`);

  // Sort: more sources first, then by Deezer rank desc
  gaps.sort((a, b) => {
    const diff = b.sources.size - a.sources.size;
    if (diff !== 0) return diff;
    return (b.track.rank || 0) - (a.track.rank || 0);
  });

  const headers = [
    'OriginalTitle', 'OriginalArtist', 'OriginalDeezerId', 'OriginalRank',
    'AlternativeTitle', 'AlternativeArtist', 'AlternativeAlbum',
    'AlternativeDeezerId', 'AlternativeRank', 'AlternativeDurationSec',
    'AlternativeExplicit', 'DeezerTrackUrl', 'AlternativePreviewUrl',
    'ConfidenceNote',
  ];

  let csv = headers.join(',') + '\n';
  for (const g of gaps) {
    const t = g.track;
    const sourceCount = g.sources.size;
    const note = sourceCount > 1
      ? `On ${sourceCount} editorial lists`
      : `On: ${Array.from(g.sources)[0]}`;
    const row = {
      OriginalTitle: '(gap)',
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
    csv += headers.map((h) => csvField(row[h])).join(',') + '\n';
  }
  const outPath = join(__dirname, `gap-candidates-${targetPackId}.csv`);
  writeFileSync(outPath, csv);
  console.log(`✓ Wrote ${outPath}`);

  console.log('\n=== TOP 20 GAP TRACKS ===');
  for (const g of gaps.slice(0, 20)) {
    const t = g.track;
    console.log(`  [${g.sources.size}x src, rank ${t.rank || '?'}]  ${t.title} — ${t.artist?.name}`);
  }
  if (gaps.length > 20) console.log(`  ... and ${gaps.length - 20} more`);

  console.log('\n=== NEXT STEPS ===');
  console.log(`1. node scripts/generate-preview-player.mjs scripts/gap-candidates-${targetPackId}.csv`);
  console.log(`2. Open the HTML, review gap tracks, Export approved CSV`);
  console.log(`3. Append approved rows to scripts/soundiiz-import-${targetPackId}.csv`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
