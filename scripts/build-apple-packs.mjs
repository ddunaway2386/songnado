#!/usr/bin/env node
/**
 * Build the Apple Music packs the v1.0 app ships with.
 *
 * Inputs:
 *   scripts/all-songs.csv          the catalogue, one row per pack × song
 *   scripts/apple-music-map.json   Apple Music matches (map-apple-music.mjs)
 *
 * Outputs:
 *   assets/curated-apple/<pack>.json
 *   lib/curated/apple-packs.generated.ts   static requires + display order
 *
 * Rules:
 *   - Only confident matches ship ('ok'). 'review' songs wait for a human
 *     decision, so a wrong recording never reaches a round unchecked.
 *   - Explicit: a song we already hide as explicit (our `explicit` column)
 *     comes back only if Apple has a version explicitly rated clean. Any
 *     song whose Apple match is rated explicit is swapped for its clean twin
 *     when one exists, otherwise left out.
 *   - Every pack is free: v1.0 has no purchases.
 *   - Pack IDs are new ('am-…'): rotation state is stored by index, so a
 *     phone updating from a Deezer build must not apply Deezer-era played
 *     indices to Apple pack arrays.
 *
 * Usage: node scripts/build-apple-packs.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV_IN = join(__dirname, 'all-songs.csv');
const MAP_IN = join(__dirname, 'apple-music-map.json');
const OUT_DIR = join(ROOT, 'assets', 'curated-apple');
const REGISTRY = join(ROOT, 'lib', 'curated', 'apple-packs.generated.ts');

/** Picker order. Names must match the Deezer-era names (categories key on them). */
const PACK_ORDER = [
  "70's Mega Hits",
  "80's Mega Hits",
  "90's Mega Hits",
  "2000's Mega Hits",
  "2010's Mega Hits",
  "2020's Mega Hits",
  'All-Time Hits',
  'Songs from Movies',
  'Movie Soundtracks',
  'Classic TV Themes',
  'Modern TV Themes',
  'Broadway',
  'Road Trip',
  'Wedding',
  'Christmas Hits',
];

function parseCsvLine(l) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) {
      if (ch === '"' && l[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const slug = (name) =>
  'am-' +
  name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const lines = readFileSync(CSV_IN, 'utf8').trim().split(/\r?\n/);
const hdr = parseCsvLine(lines[0]);
const col = (n) => hdr.indexOf(n);
const map = JSON.parse(readFileSync(MAP_IN, 'utf8')).entries;

const packs = new Map();
const stats = new Map();
for (const l of lines.slice(1)) {
  const r = parseCsvLine(l);
  const name = r[col('pack')];
  const artist = r[col('artist')];
  const title = r[col('title')];
  const ourExplicit = r[col('explicit')] !== '';
  const st = stats.get(name) ?? { rows: 0, deezerPlayable: 0, shipped: 0, review: 0, missing: 0, explicitOut: 0, cleanSwaps: 0 };
  stats.set(name, st);
  st.rows++;
  if (r[col('plays_in_game')] === 'yes') st.deezerPlayable++;

  const m = map[`${artist}|${title}`];
  if (!m || m.status === 'missing' || m.status === 'error') {
    st.missing++;
    continue;
  }
  if (m.status !== 'ok') {
    st.review++;
    continue;
  }

  let pick = { appleId: m.appleId, durationMs: m.durationMs, artworkUrl: m.artworkUrl };
  const appleExplicit = m.contentRating === 'explicit';
  if (appleExplicit || ourExplicit) {
    const cleanVersion =
      m.contentRating === 'clean'
        ? pick
        : m.clean
          ? { appleId: m.clean.id, durationMs: m.clean.durationMs, artworkUrl: m.clean.artworkUrl }
          : null;
    if (!cleanVersion) {
      st.explicitOut++;
      continue;
    }
    if (cleanVersion !== pick) st.cleanSwaps++;
    pick = cleanVersion;
  }
  if (!pick.appleId || !pick.durationMs) {
    st.missing++;
    continue;
  }

  const tracks = packs.get(name) ?? [];
  packs.set(name, tracks);
  if (tracks.some((t) => t.appleId === pick.appleId)) continue;
  tracks.push({
    appleId: pick.appleId,
    title,
    artist,
    source: r[col('from_movie_show')] ?? '',
    durationMs: pick.durationMs,
    artworkUrl: pick.artworkUrl ?? '',
  });
  st.shipped++;
}

const unknown = [...packs.keys()].filter((n) => !PACK_ORDER.includes(n));
if (unknown.length) throw new Error(`Packs missing from PACK_ORDER: ${unknown.join(', ')}`);

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.json')) unlinkSync(join(OUT_DIR, f));

const order = [];
const loaders = [];
for (const name of PACK_ORDER) {
  const tracks = packs.get(name);
  if (!tracks?.length) continue;
  const id = slug(name);
  const file = `${id.slice(3)}.json`;
  writeFileSync(
    join(OUT_DIR, file),
    JSON.stringify({ id, name, tier: 'free', version: 1, tracks }, null, 1) + '\n'
  );
  order.push(id);
  loaders.push(`  '${id}': () => require('../../assets/curated-apple/${file}'),`);
}

writeFileSync(
  REGISTRY,
  `// AUTO-GENERATED by scripts/build-apple-packs.mjs — do not edit by hand.
// Static requires so Metro can bundle each pack; regenerate after remapping.
/* eslint-disable @typescript-eslint/no-require-imports */

export const APPLE_PACK_LOADERS: Record<string, () => unknown> = {
${loaders.join('\n')}
};

/** Display order of the Apple Music packs in the picker. */
export const APPLE_PACK_ORDER: string[] = ${JSON.stringify(order, null, 2).replace(/"/g, "'")};
`
);

console.log('pack                  rows  deezer-play  SHIPPED  review  missing  explicit-out  clean-swaps');
let total = 0;
let totalDeezer = 0;
for (const name of PACK_ORDER) {
  const s = stats.get(name);
  if (!s) continue;
  total += s.shipped;
  totalDeezer += s.deezerPlayable;
  console.log(
    `${name.padEnd(20)} ${String(s.rows).padStart(5)} ${String(s.deezerPlayable).padStart(11)} ${String(s.shipped).padStart(8)} ${String(s.review).padStart(7)} ${String(s.missing).padStart(8)} ${String(s.explicitOut).padStart(13)} ${String(s.cleanSwaps).padStart(12)}`
  );
}
console.log(`\n${total} songs ship on Apple Music (Deezer build plays ${totalDeezer}).`);
console.log(`Wrote ${order.length} packs to assets/curated-apple/ and ${REGISTRY}`);
if (!existsSync(MAP_IN)) console.warn('apple-music-map.json missing');
