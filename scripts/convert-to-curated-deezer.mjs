#!/usr/bin/env node
/**
 * Convert live Deezer playlists into bundled curated-Deezer JSON files.
 *
 * For each pack:
 *  1. Fetch the live playlist tracks
 *  2. Look up each track's `source` from assets/sources/all.json
 *  3. Apply optional excludes (crossover removal) and inserts (recovery adds)
 *  4. Write the result to assets/curated-deezer/<slug>.json
 *
 * Used to migrate Movie Classics + Modern Movies off Deezer-playlist
 * dependency. After this runs, lib/playlists.ts no longer points at the
 * Deezer playlist IDs — the bundled JSON is the source of truth.
 *
 * Modern Movies corrections baked in:
 *   - Exclude 14 crossover tracks (pre-2010 movies that ended up in Modern)
 *   - Insert recovery URLs that Soundiiz missed (with hand-coded sources)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SOURCES_PATH = join(PROJECT_ROOT, 'assets', 'sources', 'all.json');
const OUTPUT_DIR = join(PROJECT_ROOT, 'assets', 'curated-deezer');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));

async function fetchPlaylistTracks(playlistId) {
  const all = [];
  let index = 0;
  while (true) {
    const url = `https://api.deezer.com/playlist/${playlistId}/tracks?index=${index}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (data.error) break;
    const batch = data.data || [];
    all.push(...batch);
    if (!data.next || batch.length < 100) break;
    index += 100;
    await new Promise((r) => setTimeout(r, 50));
  }
  return all;
}

async function fetchTrack(id) {
  try {
    const res = await fetch(`https://api.deezer.com/track/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return data;
  } catch {
    return null;
  }
}

const CONFIGS = [
  {
    slug: 'movie-classics',
    id: 'songnado-movie-classics',
    name: 'Movie Classics',
    tier: 'free',
    sourcePlaylistId: '15450875301',
    excludeTrackIds: new Set(),
    insertTracks: [],
  },
  {
    slug: 'modern-movies',
    id: 'songnado-modern-movies',
    name: 'Modern Movies',
    tier: 'locked',
    sourcePlaylistId: '15461297081',
    // 14 crossover tracks identified as actually classic-era (already in Movie Classics)
    excludeTrackIds: new Set([
      '139138743',  // Stayin Alive — Bee Gees (Saturday Night Fever, 1977)
      '128547767',  // Ghostbusters — Ray Parker Jr. (1984)
      '134036426',  // Against All Odds — Phil Collins (1984)
      '14552280',   // My Heart Will Go On — Céline Dion (Titanic, 1997)
      '4715022',    // Maniac (Re-Recorded) — Michael Sembello (Flashdance, 1983)
      '696962792',  // You've Got a Friend in Me — Randy Newman (Toy Story, 1995)
      '139138751',  // Night Fever — Bee Gees (1977)
      '468253402',  // Unchained Melody — Righteous Brothers (Ghost, 1990)
      '78033230',   // Oh, Pretty Woman — Roy Orbison (1990)
      '646290952',  // You Never Can Tell — Chuck Berry (Pulp Fiction, 1994)
      '992937',     // 9 to 5 — Dolly Parton (1980)
      '2122407',    // Pure Imagination — Gene Wilder (Willy Wonka, 1971)
      '116348340',  // Twist And Shout — The Beatles (Ferris Bueller, 1986)
      '145425722',  // Accidentally In Love — Counting Crows (Shrek 2, 2004)
    ]),
    // 13 recovery URLs Soundiiz fuzzy-missed (skipped 2 classic-era: Imperial Attack + Raindrops)
    insertTracks: [
      { deezerId: '84165189',   source: 'Lone Survivor' },
      { deezerId: '440475822',  source: 'Star Wars: The Last Jedi' },
      { deezerId: '100598482',  source: '' },  // Want to Want Me — no specific movie tie
      { deezerId: '105708778',  source: 'Pitch Perfect 2' },
      { deezerId: '130871170',  source: 'Stranger Things' },
      { deezerId: '130871168',  source: 'Stranger Things' },
      { deezerId: '416643382',  source: 'Stranger Things' },
      { deezerId: '69838319',   source: 'Breaking Bad' },
      { deezerId: '130871180',  source: 'Stranger Things' },
      { deezerId: '63041541',   source: 'Les Misérables' },
      { deezerId: '1007284052', source: 'Pitch Perfect' },
    ],
  },
];

for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.name} (${cfg.slug}) ===`);
  console.log(`Fetching live playlist ${cfg.sourcePlaylistId}...`);
  const tracks = await fetchPlaylistTracks(cfg.sourcePlaylistId);
  console.log(`Got ${tracks.length} tracks`);

  const kept = tracks.filter((t) => !cfg.excludeTrackIds.has(String(t.id)));
  const excludedCount = tracks.length - kept.length;
  if (excludedCount > 0) console.log(`Excluded crossover/classic-era tracks: ${excludedCount}`);

  const result = kept.map((t) => ({
    deezerId: String(t.id),
    title: t.title || '',
    artist: t.artist?.name || '',
    source: sources[String(t.id)] || '',
  }));

  // Insert recovery tracks
  if (cfg.insertTracks.length > 0) {
    console.log(`Inserting ${cfg.insertTracks.length} recovery tracks...`);
    for (const ins of cfg.insertTracks) {
      const meta = await fetchTrack(ins.deezerId);
      if (!meta) {
        console.log(`  ✗ ${ins.deezerId} — could not fetch`);
        continue;
      }
      result.push({
        deezerId: String(meta.id),
        title: meta.title_short || meta.title,
        artist: meta.artist?.name || '',
        source: ins.source || sources[String(ins.id)] || '',
      });
      // Also write the source into all.json if we have one
      if (ins.source) sources[String(ins.deezerId)] = ins.source;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  const withSource = result.filter((r) => r.source).length;
  console.log(`Final tracks: ${result.length} (${withSource} with source = ${Math.round(withSource / result.length * 100)}%)`);

  const data = {
    id: cfg.id,
    name: cfg.name,
    imageUrl: '',
    tier: cfg.tier,
    version: 1,
    tracks: result,
  };
  const outPath = join(OUTPUT_DIR, `${cfg.slug}.json`);
  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Wrote ${outPath}`);
}

// Persist any new source entries we added during insert
writeFileSync(SOURCES_PATH, JSON.stringify(sources, (k, v) => v, 2) + '\n');
console.log(`\n✓ Updated ${SOURCES_PATH}`);
