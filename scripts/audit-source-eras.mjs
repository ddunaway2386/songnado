#!/usr/bin/env node
/**
 * Audit `assets/sources/all.json` for source-era mismatches relative to
 * the Movie Classics / Modern Movies split (2010 cutoff).
 *
 * For each unique source value in the JSON, ask Claude Sonnet for the
 * canonical release year. Flag sources whose year crosses the cutoff
 * relative to the pack the source's tracks landed in. The curator decides
 * per row whether to:
 *   - leave it (cross-pack source is intentional / fine)
 *   - blank it (track keeps no source label in this pack)
 *   - move the track to the other pack (manual Deezer UI work)
 *
 * Usage:
 *   node scripts/audit-source-eras.mjs
 *
 * Output:
 *   scripts/source-era-audit.csv  — one row per unique source with year + verdict
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
  console.error('Missing ANTHROPIC_API_KEY in .env.local or environment.');
  process.exit(1);
}

const MODEL = 'claude-sonnet-4-6';
const CUTOFF_YEAR = 2010;
const BATCH_SIZE = 25; // sources per Sonnet call

const SYSTEM_PROMPT = `You return the canonical original release year for each source (movie, TV show, musical, video game, brand). For franchises, give the year of the specific work named. For TV shows, the year the show premiered. For musicals, the original Broadway/West End premiere year.

Reply with ONLY a JSON array of objects, one per source in the input order:
[
  { "source": "Star Wars", "year": 1977 },
  { "source": "Stranger Things", "year": 2016 }
]

If you genuinely don't know or can't determine the year, use { "year": null }.

No prose, no markdown fences.`;

async function classifyBatch(sources) {
  const userPrompt = sources.map((s) => `- ${s}`).join('\n');
  const body = {
    model: MODEL,
    max_tokens: 4000,
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function main() {
  console.log('=== Audit Source Eras ===\n');
  const sources = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  const idsBySource = {};
  for (const [id, src] of Object.entries(sources)) {
    if (!src) continue;
    (idsBySource[src] = idsBySource[src] || []).push(id);
  }
  const uniqueSources = Object.keys(idsBySource).sort();
  console.log(`Unique sources to classify: ${uniqueSources.length}`);
  console.log(`Calling ${MODEL} in batches of ${BATCH_SIZE}...\n`);

  const yearBySource = {};
  for (let i = 0; i < uniqueSources.length; i += BATCH_SIZE) {
    const batch = uniqueSources.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  [${i + batch.length}/${uniqueSources.length}]`);
    try {
      const result = await classifyBatch(batch);
      for (const r of result) {
        if (r && r.source) yearBySource[r.source] = r.year;
      }
      process.stdout.write(' ok\n');
    } catch (e) {
      process.stdout.write(' ERR ' + e.message.slice(0, 80) + '\n');
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const rows = [];
  for (const src of uniqueSources) {
    const year = yearBySource[src];
    const trackCount = idsBySource[src].length;
    let verdict;
    if (year == null) verdict = 'UNKNOWN';
    else if (year < CUTOFF_YEAR) verdict = 'pre-2010 (Classics)';
    else verdict = `${year} — MODERN (mismatched in Movie Classics)`;
    rows.push({ Source: src, Year: year ?? '', TrackCount: trackCount, Verdict: verdict });
  }

  // Write CSV
  const headers = ['Source', 'Year', 'TrackCount', 'Verdict'];
  let csv = headers.join(',') + '\n';
  for (const r of rows) csv += headers.map((h) => csvField(r[h])).join(',') + '\n';
  const outPath = join(__dirname, 'source-era-audit.csv');
  writeFileSync(outPath, csv);
  console.log(`\n✓ Wrote ${outPath}`);

  // Print summary
  const modern = rows.filter((r) => typeof r.Year === 'number' && r.Year >= CUTOFF_YEAR);
  const unknown = rows.filter((r) => r.Year === '');
  console.log('\n=== ERA MISMATCH SUMMARY ===');
  console.log(`  Pre-2010 sources (fit Classics):    ${rows.length - modern.length - unknown.length}`);
  console.log(`  Post-2010 sources (era mismatch):   ${modern.length}`);
  console.log(`  Unknown (Sonnet couldn't classify): ${unknown.length}\n`);

  if (modern.length > 0) {
    console.log('=== MODERN SOURCES FOUND IN MOVIE CLASSICS ===');
    modern.sort((a, b) => b.TrackCount - a.TrackCount);
    for (const r of modern) {
      console.log(`  ${String(r.Year)}  ×${r.TrackCount.toString().padStart(2)}  ${r.Source}`);
    }
  }
  if (unknown.length > 0) {
    console.log('\n=== UNCLASSIFIED (review manually) ===');
    for (const r of unknown) console.log(`  ${r.Source}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
