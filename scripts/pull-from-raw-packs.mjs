#!/usr/bin/env node
/**
 * Pull tracks from the raw kitchen-sink Deezer playlists (Broadway,
 * TV Themes) into their curated-Deezer JSON counterparts.
 *
 * For Broadway (raw playlist 13889425981, 450 tracks):
 *   - Dedupe against current broadway.json (259 tracks)
 *   - Add anything missing (skip obvious covers/karaoke)
 *
 * For TV Themes (raw playlist 13889467621, 249 tracks):
 *   - Dedupe against classic-tv-themes.json (10) + modern-tv-themes.json (43)
 *   - For each new track, Sonnet classifies its era (pre-2010 → Classic,
 *     2010+ → Modern) via TV show name inference
 *   - Add to appropriate JSON
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

const REJECT_RE = /karaoke|tribute|made\s*famous|in the style|glee cast|cover of\b/i;
const CUTOFF_YEAR = 2010;

async function fetchAllTracks(playlistId) {
  const all = [];
  let index = 0;
  while (true) {
    const url = `https://api.deezer.com/playlist/${playlistId}/tracks?index=${index}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (!data.data || data.data.length === 0) break;
    all.push(...data.data);
    if (data.next) index += 100;
    else break;
  }
  return all;
}

function looksReal(track) {
  const s = (track.title || '') + ' ' + (track.artist?.name || '');
  return !REJECT_RE.test(s) && track.preview;
}

async function classifyTvBatch(titles) {
  const systemPrompt = `You classify song titles that are TV show themes.

For each input, infer the TV show it comes from (may be the song title itself or the album title if I include it), and the show's premiere year.

Reply with ONLY a JSON array, one object per input in input order:
[
  { "show": "Stranger Things", "year": 2016 },
  { "show": "The Munsters", "year": 1964 }
]

If you can't identify the show, use { "show": "unknown", "year": null }.
No prose, no markdown.`;

  const userPrompt = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
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

// ─── BROADWAY ──────────────────────────────────────────────────────

async function pullBroadway() {
  console.log('\n=== BROADWAY ===');
  const rawTracks = await fetchAllTracks('13889425981');
  console.log(`  Raw playlist: ${rawTracks.length} tracks`);

  const jsonPath = join(CURATED_DIR, 'broadway.json');
  const pack = JSON.parse(readFileSync(jsonPath, 'utf8'));
  console.log(`  Curated JSON: ${pack.tracks.length} tracks`);

  const existingIds = new Set(pack.tracks.map((t) => String(t.deezerId)));
  const additions = rawTracks.filter(
    (t) => !existingIds.has(String(t.id)) && looksReal(t)
  );
  console.log(`  Adding ${additions.length} new Broadway tracks from raw`);

  for (const t of additions) {
    pack.tracks.push({
      deezerId: String(t.id),
      title: t.title,
      artist: t.artist?.name || '',
      source: '',
    });
  }
  writeFileSync(jsonPath, JSON.stringify(pack, null, 2) + '\n');
  console.log(`  New total: ${pack.tracks.length} tracks`);
  return pack.tracks.length;
}

// ─── TV THEMES ─────────────────────────────────────────────────────

async function pullTvThemes() {
  console.log('\n=== TV THEMES ===');
  const rawTracks = await fetchAllTracks('13889467621');
  console.log(`  Raw playlist: ${rawTracks.length} tracks`);

  const classicPath = join(CURATED_DIR, 'classic-tv-themes.json');
  const modernPath = join(CURATED_DIR, 'modern-tv-themes.json');
  const classic = JSON.parse(readFileSync(classicPath, 'utf8'));
  const modern = JSON.parse(readFileSync(modernPath, 'utf8'));
  console.log(`  Classic TV: ${classic.tracks.length} tracks`);
  console.log(`  Modern TV:  ${modern.tracks.length} tracks`);

  const existingIds = new Set([
    ...classic.tracks.map((t) => String(t.deezerId)),
    ...modern.tracks.map((t) => String(t.deezerId)),
  ]);
  const additions = rawTracks.filter(
    (t) => !existingIds.has(String(t.id)) && looksReal(t)
  );
  console.log(`  New candidate tracks: ${additions.length}`);

  // Batch classify via Sonnet — inputs are "Title — Artist (album)"
  const BATCH = 25;
  const classifications = [];
  for (let i = 0; i < additions.length; i += BATCH) {
    const batch = additions.slice(i, i + BATCH);
    const prompts = batch.map((t) => `${t.title} — ${t.artist?.name || ''} (album: ${t.album?.title || ''})`);
    process.stdout.write(`  Classifying ${i + batch.length}/${additions.length}...`);
    try {
      const result = await classifyTvBatch(prompts);
      classifications.push(...result);
      process.stdout.write(' ok\n');
    } catch (e) {
      process.stdout.write(' ERR ' + e.message.slice(0, 80) + '\n');
      // fill in unknowns for this batch
      for (let j = 0; j < batch.length; j++) classifications.push({ show: 'unknown', year: null });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  let classicAdds = 0, modernAdds = 0, skipped = 0;
  for (let i = 0; i < additions.length; i++) {
    const t = additions[i];
    const c = classifications[i] || {};
    const year = c.year;
    const source = c.show && c.show !== 'unknown' ? c.show : '';
    const trackEntry = {
      deezerId: String(t.id),
      title: t.title,
      artist: t.artist?.name || '',
      source,
    };
    if (year != null && year < CUTOFF_YEAR) {
      classic.tracks.push(trackEntry);
      classicAdds++;
    } else if (year != null && year >= CUTOFF_YEAR) {
      modern.tracks.push(trackEntry);
      modernAdds++;
    } else {
      // Unknown year — bucket into Modern by default (more likely to be recent)
      modern.tracks.push(trackEntry);
      modernAdds++;
      skipped++;
    }
  }

  writeFileSync(classicPath, JSON.stringify(classic, null, 2) + '\n');
  writeFileSync(modernPath, JSON.stringify(modern, null, 2) + '\n');
  console.log(`  Added ${classicAdds} to Classic TV Themes (total ${classic.tracks.length})`);
  console.log(`  Added ${modernAdds} to Modern TV Themes (total ${modern.tracks.length}) [${skipped} unknown year defaulted to Modern]`);
  return { classic: classic.tracks.length, modern: modern.tracks.length };
}

// ─── RUN ───────────────────────────────────────────────────────────

if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — needed for TV era classification');
  process.exit(1);
}

const broadwayTotal = await pullBroadway();
const tvTotals = await pullTvThemes();

console.log('\n=========================================');
console.log('SUMMARY');
console.log('=========================================');
console.log(`  Broadway:          ${broadwayTotal} tracks`);
console.log(`  Classic TV Themes: ${tvTotals.classic} tracks`);
console.log(`  Modern TV Themes:  ${tvTotals.modern} tracks`);
console.log('\nNext: commit + eas update');
