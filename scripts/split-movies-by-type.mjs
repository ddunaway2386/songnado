#!/usr/bin/env node
/**
 * Reorganize the two era-split movie packs (Movie Classics + Modern
 * Movies) into two type-split packs:
 *
 *   * Movie Soundtracks — instrumental score music (John Williams,
 *     Hans Zimmer, Danny Elfman, Ramin Djawadi, etc. — themes,
 *     motifs, main titles, credits music). Trivia challenge is the
 *     movie, not the artist.
 *   * Songs from Movies — pop / rock / musical songs that appeared
 *     in movies (Skyfall / Shallow / Purple Rain / Circle of Life /
 *     Live and Let Die / Ghostbusters). Trivia challenge is the
 *     song + artist + which movie.
 *
 * Family-test feedback: era-split (Classic vs Modern) didn't feel as
 * natural as type-split. Movies span decades; users don't sort
 * memories by 2010 cutoff.
 *
 * Uses Sonnet to classify each track. Batches of 25 for cost + speed.
 * Writes two new JSON files. Old classic-movies + modern-movies JSONs
 * will be deregistered separately in lib/curated/deezer-loader.ts.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CURATED_DIR = join(PROJECT_ROOT, 'assets', 'curated-deezer');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
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

const SYSTEM_PROMPT = `You classify movie music. For each input, decide:

  * "SONG" — a song with vocals featured in a movie (pop / rock / R&B /
    hip-hop / country / musical song). Examples: "Shallow" by Lady Gaga,
    "Skyfall" by Adele, "Purple Rain" by Prince, "Circle of Life" by
    Carmen Twillie, "Let It Go" by Idina Menzel, "Live and Let Die" by
    Paul McCartney, "I Will Always Love You" by Whitney Houston.
  * "SCORE" — instrumental score / soundtrack cue composed for a film.
    Usually orchestral or electronic, no vocals (or minimal). Examples:
    Any John Williams theme, Hans Zimmer "Time" (Inception), Alan
    Silvestri "Back to the Future Theme", Danny Elfman "Batman Theme",
    Bear McCreary main title, Ludwig Göransson "The Mandalorian".

Reply with ONLY a JSON array, one string per input in order:
["SONG", "SCORE", "SONG", ...]

Rules:
- Musical numbers WITH vocals from film musicals = SONG (Frozen, Aladdin,
  Grease, Mamma Mia, La La Land solo tracks).
- Instrumental main titles / suites / medleys / motifs = SCORE.
- Composer-credited instrumental cues (regardless of era) = SCORE.
- Cover versions of existing songs used in a movie = SONG.

No prose, no markdown fences.`;

async function classifyBatch(entries) {
  const userPrompt = entries.map((e, i) => `${i + 1}. "${e.title}" — ${e.artist}`).join('\n');
  const body = {
    model: MODEL,
    max_tokens: 2000,
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

const classic = JSON.parse(readFileSync(join(CURATED_DIR, 'movie-classics.json'), 'utf8'));
const modern = JSON.parse(readFileSync(join(CURATED_DIR, 'modern-movies.json'), 'utf8'));
const all = [...classic.tracks, ...modern.tracks];
console.log(`Combined tracks: ${all.length} (${classic.tracks.length} classic + ${modern.tracks.length} modern)`);

// De-dupe by Deezer ID (in case both packs share tracks)
const seen = new Set();
const unique = [];
for (const t of all) {
  const id = String(t.deezerId);
  if (seen.has(id)) continue;
  seen.add(id);
  unique.push(t);
}
console.log(`Unique tracks after dedup: ${unique.length}`);

const classifications = [];
for (let i = 0; i < unique.length; i += BATCH_SIZE) {
  const batch = unique.slice(i, i + BATCH_SIZE);
  process.stdout.write(`  Batch ${i + batch.length}/${unique.length}... `);
  try {
    const result = await classifyBatch(batch);
    classifications.push(...result);
    process.stdout.write('ok\n');
  } catch (e) {
    process.stdout.write('ERR ' + e.message.slice(0, 80) + '\n');
    for (let j = 0; j < batch.length; j++) classifications.push('SONG'); // default to SONG on error
  }
  await new Promise((r) => setTimeout(r, 200));
}

const songs = [];
const scores = [];
for (let i = 0; i < unique.length; i++) {
  const label = (classifications[i] || 'SONG').toUpperCase();
  if (label === 'SCORE') scores.push(unique[i]);
  else songs.push(unique[i]);
}

const soundtracksPack = {
  id: 'songnado-movie-soundtracks',
  name: 'Movie Soundtracks',
  imageUrl: '',
  tier: 'free',
  version: 1,
  tracks: scores,
};

const songsPack = {
  id: 'songnado-movie-songs',
  name: 'Songs from Movies',
  imageUrl: '',
  tier: 'free',
  version: 1,
  tracks: songs,
};

writeFileSync(join(CURATED_DIR, 'movie-soundtracks.json'), JSON.stringify(soundtracksPack, null, 2) + '\n');
writeFileSync(join(CURATED_DIR, 'movie-songs.json'), JSON.stringify(songsPack, null, 2) + '\n');

console.log('\n=========================================');
console.log('SPLIT SUMMARY');
console.log('=========================================');
console.log(`  Movie Soundtracks (score/instrumental): ${scores.length}`);
console.log(`  Songs from Movies (vocal / musical):    ${songs.length}`);
console.log(`  Total:                                  ${scores.length + songs.length}`);

console.log('\nSample SOUNDTRACKS:');
for (const t of scores.slice(0, 10)) console.log(`  - ${t.title} — ${t.artist}${t.source ? '  (' + t.source + ')' : ''}`);

console.log('\nSample SONGS:');
for (const t of songs.slice(0, 10)) console.log(`  - ${t.title} — ${t.artist}${t.source ? '  (' + t.source + ')' : ''}`);

console.log('\nWrote:');
console.log('  assets/curated-deezer/movie-soundtracks.json');
console.log('  assets/curated-deezer/movie-songs.json');
console.log('\nNext:');
console.log('  1. Update lib/curated/deezer-loader.ts: swap old movie IDs for new');
console.log('  2. Delete old movie-classics.json + modern-movies.json (or keep as backup)');
console.log('  3. Run cap-curated-packs.mjs to apply per-source caps');
