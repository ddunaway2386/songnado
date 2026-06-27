#!/usr/bin/env node
/**
 * Split TV-show tracks out of the Movie Classics + Modern Movies JSON
 * packs into era-appropriate TV Themes packs.
 *
 *  1. Collect unique sources across both movie JSONs
 *  2. Ask Claude Sonnet to classify each source: MOVIE | TV | MUSICAL | OTHER + year
 *  3. For TV sources: split by year (pre-2010 → Classic TV, 2010+ → Modern TV)
 *  4. Build classic-tv-themes.json + modern-tv-themes.json
 *  5. Remove the TV-source tracks from the movie JSONs
 *  6. Print summary; caller runs convert + commit
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');
const CURATED_DIR = join(PROJECT_ROOT, 'assets', 'curated-deezer');

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = loadEnv();
const API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 25;
const CUTOFF = 2010;

const SYSTEM_PROMPT = `You classify entertainment-property names. For each input return:
- "kind": "MOVIE" | "TV" | "MUSICAL" | "OTHER"
- "year": original release year as integer, or null

Definitions:
- MOVIE = feature film or animated film (including any movie adaptation of a musical, novel, or TV show)
- TV = scripted or unscripted TV series — broadcast, cable, streaming, or documentary series. Premier year, not finale.
- MUSICAL = stage musical (Broadway/West End/touring) — NOT the film adaptation
- OTHER = anything else

Reply with ONLY a JSON array, one object per input source in input order:
[
  { "source": "Stranger Things", "kind": "TV", "year": 2016 },
  { "source": "Forrest Gump", "kind": "MOVIE", "year": 1994 }
]

No prose, no markdown fences.`;

async function classifyBatch(sources) {
  const userPrompt = sources.map((s) => `- ${s}`).join('\n');
  const body = {
    model: MODEL,
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

const movieClassics = JSON.parse(readFileSync(join(CURATED_DIR, 'movie-classics.json'), 'utf8'));
const modernMovies = JSON.parse(readFileSync(join(CURATED_DIR, 'modern-movies.json'), 'utf8'));

const allSources = new Set();
for (const t of movieClassics.tracks) if (t.source) allSources.add(t.source);
for (const t of modernMovies.tracks) if (t.source) allSources.add(t.source);
const unique = [...allSources].sort();
console.log(`Classifying ${unique.length} unique sources via ${MODEL}...\n`);

const classification = {};
for (let i = 0; i < unique.length; i += BATCH_SIZE) {
  const batch = unique.slice(i, i + BATCH_SIZE);
  process.stdout.write(`  [${i + batch.length}/${unique.length}]`);
  try {
    const result = await classifyBatch(batch);
    for (const r of result) {
      if (r && r.source) classification[r.source] = r;
    }
    process.stdout.write(' ok\n');
  } catch (e) {
    process.stdout.write(' ERR ' + e.message.slice(0, 80) + '\n');
  }
  await new Promise((r) => setTimeout(r, 200));
}

// Categorize sources
const tvSources = unique.filter((s) => classification[s]?.kind === 'TV');
console.log(`\nTV sources found: ${tvSources.length}`);

const classicTvTracks = [];
const modernTvTracks = [];

function extractTvFromPack(pack) {
  const kept = [];
  const movedOut = [];
  for (const t of pack.tracks) {
    if (t.source && classification[t.source]?.kind === 'TV') {
      const year = classification[t.source]?.year;
      if (year != null && year < CUTOFF) classicTvTracks.push(t);
      else modernTvTracks.push(t);
      movedOut.push(t);
    } else {
      kept.push(t);
    }
  }
  pack.tracks = kept;
  return { kept: kept.length, movedOut: movedOut.length };
}

const mc = extractTvFromPack(movieClassics);
const mm = extractTvFromPack(modernMovies);
console.log(`Movie Classics:  ${mc.kept} kept, ${mc.movedOut} moved to TV`);
console.log(`Modern Movies:   ${mm.kept} kept, ${mm.movedOut} moved to TV`);
console.log(`Classic TV (pre-${CUTOFF}): ${classicTvTracks.length} tracks`);
console.log(`Modern TV (${CUTOFF}+):    ${modernTvTracks.length} tracks`);

// Write the new TV pack JSONs
const classicTv = {
  id: 'songnado-classic-tv-themes',
  name: 'Classic TV Themes',
  imageUrl: '',
  tier: 'locked',
  version: 1,
  tracks: classicTvTracks,
};
const modernTv = {
  id: 'songnado-modern-tv-themes',
  name: 'Modern TV Themes',
  imageUrl: '',
  tier: 'locked',
  version: 1,
  tracks: modernTvTracks,
};

writeFileSync(join(CURATED_DIR, 'movie-classics.json'), JSON.stringify(movieClassics, null, 2) + '\n');
writeFileSync(join(CURATED_DIR, 'modern-movies.json'), JSON.stringify(modernMovies, null, 2) + '\n');
writeFileSync(join(CURATED_DIR, 'classic-tv-themes.json'), JSON.stringify(classicTv, null, 2) + '\n');
writeFileSync(join(CURATED_DIR, 'modern-tv-themes.json'), JSON.stringify(modernTv, null, 2) + '\n');

console.log('\n✓ Wrote movie-classics.json, modern-movies.json, classic-tv-themes.json, modern-tv-themes.json');
console.log('\n=== TV sources extracted (by era) ===');
const tvByEra = { classic: [], modern: [] };
for (const s of tvSources) {
  const y = classification[s]?.year;
  if (y != null && y < CUTOFF) tvByEra.classic.push({ source: s, year: y });
  else tvByEra.modern.push({ source: s, year: y });
}
tvByEra.classic.sort((a, b) => (a.year || 9999) - (b.year || 9999));
tvByEra.modern.sort((a, b) => (a.year || 9999) - (b.year || 9999));
console.log('\nClassic TV:');
for (const e of tvByEra.classic) console.log(`  ${e.year || '?'}  ${e.source}`);
console.log('\nModern TV:');
for (const e of tvByEra.modern) console.log(`  ${e.year || '?'}  ${e.source}`);
