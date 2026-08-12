#!/usr/bin/env node
/**
 * Export every song across all 14 packs to one reviewable CSV.
 *
 * Two very different sources have to be merged:
 *
 *   CURATED  Nine packs stored as JSON in assets/curated-deezer/. Full
 *            detail available offline, including the `source` label
 *            (which movie/show/musical a track belongs to) and our
 *            explicit flag.
 *
 *   LIVE     Five packs (80s, 90s, 2000s, 2010s, All-Time Hits) that
 *            aren't stored locally at all — they're Deezer playlists we
 *            reference by ID and fetch at play time. Those have to be
 *            pulled from the API here.
 *
 * The CSV carries an `explicit` and a `plays_in_game` column so a
 * reviewer can see not just what's in the catalogue but what actually
 * reaches players.
 *
 * The first run of this export is what revealed that live packs were
 * never explicit-filtered — 462 flagged tracks were reaching rounds,
 * because the filter lived in the curated-Deezer loader that live packs
 * never pass through. Fixed in deezerProvider.getTrackAtIndex.
 *
 * Usage: node scripts/export-all-songs.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');
const OUT = join(__dirname, 'all-songs.csv');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Live Deezer packs, mirrored from DEEZER_SEEDS in lib/playlists.ts. */
const LIVE_PACKS = [
  { id: '15401958123', name: "80's Mega Hits", tier: 'free' },
  { id: '15386355463', name: "90's Mega Hits", tier: 'free' },
  { id: '13700823101', name: "2000's Mega Hits", tier: 'free' },
  { id: '13700823021', name: "2010's Mega Hits", tier: 'free' },
  { id: '13700822301', name: 'All-Time Hits', tier: 'locked' },
];

async function deezer(url, attempt = 0) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const quota =
      json?.error && /quota|limit/i.test(json.error.type ?? json.error.message ?? '');
    if (quota) throw new Error('rate limited');
    return json;
  } catch (e) {
    if (attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return deezer(url, attempt + 1);
    }
    return null;
  }
}

async function fetchLivePack(id) {
  const out = [];
  let url = `https://api.deezer.com/playlist/${id}/tracks?limit=100&index=0`;
  while (url) {
    const data = await deezer(url);
    if (!data) break;
    out.push(...(data.data ?? []));
    url = data.next ?? null;
    if (url) await sleep(900);
  }
  return out;
}

const rows = [];

// ── Curated packs ──────────────────────────────────────────────────
for (const file of readdirSync(CURATED_DIR).filter((f) => f.endsWith('.json'))) {
  const pack = JSON.parse(readFileSync(join(CURATED_DIR, file), 'utf8'));
  for (const t of pack.tracks) {
    rows.push({
      pack: pack.name,
      tier: pack.tier === 'locked' ? 'Unlockable' : 'Free',
      title: t.title,
      artist: t.artist,
      source: t.source ?? '',
      explicit: t.explicit ? 'YES' : '',
      plays: t.explicit ? 'no - explicit' : 'yes',
      deezerId: t.deezerId,
    });
  }
}
console.log(`curated: ${rows.length} tracks from 9 packs`);

// ── Live packs ─────────────────────────────────────────────────────
let liveExplicit = 0;
for (const pack of LIVE_PACKS) {
  const tracks = await fetchLivePack(pack.id);
  let ex = 0;
  for (const t of tracks) {
    // Explicit tracks in live packs are now skipped at fetch time by
    // deezerProvider.getTrackAtIndex, so they never reach a round.
    const isEx = t.explicit_lyrics === true;
    if (isEx) ex++;
    rows.push({
      pack: pack.name,
      tier: pack.tier === 'locked' ? 'Unlockable' : 'Free',
      title: t.title,
      artist: t.artist?.name ?? '',
      source: '',
      explicit: isEx ? 'YES' : '',
      plays: isEx ? 'no - explicit' : 'yes',
      deezerId: t.id,
    });
  }
  liveExplicit += ex;
  console.log(
    `${pack.name.padEnd(20)} ${String(tracks.length).padStart(4)} tracks (${ex} explicit, filtered out)`
  );
  await sleep(900);
}

// ── Write ──────────────────────────────────────────────────────────
rows.sort(
  (a, b) =>
    a.pack.localeCompare(b.pack) ||
    a.artist.localeCompare(b.artist) ||
    a.title.localeCompare(b.title)
);

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const header = [
  'pack',
  'tier',
  'artist',
  'title',
  'from_movie_show',
  'explicit',
  'plays_in_game',
  'deezer_id',
  'verdict_keep_or_cut',
  'notes',
];
writeFileSync(
  OUT,
  [header.join(',')]
    .concat(
      rows.map((r) =>
        [
          r.pack,
          r.tier,
          r.artist,
          r.title,
          r.source,
          r.explicit,
          r.plays,
          r.deezerId,
          '',
          '',
        ]
          .map(esc)
          .join(',')
      )
    )
    .join('\n') + '\n'
);

const playable = rows.filter((r) => r.plays === 'yes').length;
console.log('\n=========================================');
console.log(`  Total tracks:    ${rows.length}`);
console.log(`  Playable today:  ${playable}`);
console.log(`  Hidden explicit: ${rows.length - playable}`);
console.log(`  Of which live-pack explicit: ${liveExplicit}`);
console.log(`\nWrote ${OUT}`);
