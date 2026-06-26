#!/usr/bin/env node
/**
 * Classify every unique source in assets/sources/all.json as:
 *   MOVIE | TV | MUSICAL | BRAND | OTHER
 * plus its original release year (for era splits).
 *
 * Output: scripts/source-classification.csv
 *
 * Used to identify which Movie Classics / Modern Movies tracks actually
 * belong in TV / Musical / Brand packs instead, and which TV tracks split
 * Classic-era vs Modern-era.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const JSON_PATH = join(PROJECT_ROOT, 'assets', 'sources', 'all.json');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');

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

const SYSTEM_PROMPT = `You classify entertainment-property names. For each input, return:
- "kind": "MOVIE" | "TV" | "MUSICAL" | "BRAND" | "OTHER"
- "year": canonical original release year as integer, or null if unknown
- "title": the canonical short name (strip subtitles, year qualifiers)

Definitions:
- MOVIE = feature film or animated film
- TV = scripted TV series (broadcast, cable, streaming) OR documentary series
- MUSICAL = stage musical (Broadway/West End/touring) — NOT movie adaptations of musicals (those are MOVIE)
- BRAND = commercial advertiser (Coca-Cola, Chevy)
- OTHER = anything else (album, song, event, etc.)

For TV: use the year the series premiered.
For MOVIE: year of original theatrical release.
For MUSICAL: year of original Broadway premiere.

Reply with ONLY a JSON array, one object per input source in order:
[
  { "source": "Stranger Things", "kind": "TV", "year": 2016, "title": "Stranger Things" },
  { "source": "Forrest Gump", "kind": "MOVIE", "year": 1994, "title": "Forrest Gump" }
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

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const sources = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const idsBySource = {};
for (const [id, src] of Object.entries(sources)) {
  if (!src) continue;
  (idsBySource[src] = idsBySource[src] || []).push(id);
}
const uniqueSources = Object.keys(idsBySource).sort();
console.log(`Classifying ${uniqueSources.length} unique sources via ${MODEL}...\n`);

const results = {};
for (let i = 0; i < uniqueSources.length; i += BATCH_SIZE) {
  const batch = uniqueSources.slice(i, i + BATCH_SIZE);
  process.stdout.write(`  [${i + batch.length}/${uniqueSources.length}]`);
  try {
    const classifications = await classifyBatch(batch);
    for (const c of classifications) {
      if (c && c.source) results[c.source] = c;
    }
    process.stdout.write(' ok\n');
  } catch (e) {
    process.stdout.write(' ERR ' + e.message.slice(0, 80) + '\n');
  }
  await new Promise((r) => setTimeout(r, 200));
}

const headers = ['Source', 'Kind', 'Year', 'CanonicalTitle', 'TrackCount'];
let csv = headers.join(',') + '\n';
for (const src of uniqueSources) {
  const c = results[src] || {};
  csv += [
    csvField(src),
    csvField(c.kind || 'UNKNOWN'),
    csvField(c.year ?? ''),
    csvField(c.title || src),
    csvField(idsBySource[src].length),
  ].join(',') + '\n';
}
writeFileSync(join(__dirname, 'source-classification.csv'), csv);
console.log('\n✓ Wrote scripts/source-classification.csv');

const buckets = {};
for (const src of uniqueSources) {
  const k = results[src]?.kind || 'UNKNOWN';
  buckets[k] = (buckets[k] || 0) + 1;
}
console.log('\n=== KIND SUMMARY ===');
for (const [k, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${n}`);
}

const tvSources = uniqueSources.filter((s) => results[s]?.kind === 'TV');
console.log('\n=== TV SOURCES FOUND (' + tvSources.length + ') ===');
tvSources.sort((a, b) => (results[a].year || 9999) - (results[b].year || 9999));
let classicTvTracks = 0;
let modernTvTracks = 0;
for (const s of tvSources) {
  const c = results[s];
  const era = (c.year || 0) >= 2010 ? 'MODERN' : 'CLASSIC';
  const n = idsBySource[s].length;
  if (era === 'CLASSIC') classicTvTracks += n;
  else modernTvTracks += n;
  console.log(`  ${era}  ${String(c.year || '?').padStart(4)}  ×${String(n).padStart(2)}  ${s}`);
}
console.log(`\nClassic TV tracks to extract: ${classicTvTracks}`);
console.log(`Modern TV tracks to extract:  ${modernTvTracks}`);
