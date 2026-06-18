#!/usr/bin/env node
/**
 * Propose source labels for the tracks extract-sources.mjs couldn't
 * auto-extract, by asking Claude Haiku to identify the movie / show /
 * musical / brand each song is associated with.
 *
 * The output CSV gets a `ProposedSource` column and a `Confidence` column;
 * the curator opens it in Sheets, validates each row, and edits anything
 * Claude got wrong. The final approved sources are merged into
 * assets/sources/all.json via apply-sources.mjs.
 *
 * Cost: ~1000 tracks × ~150 output tokens × Haiku 4.5 pricing ≈ $0.20
 * end-to-end. The pricing window is small enough that running this on a
 * full pack costs less than a coffee.
 *
 * Requires ANTHROPIC_API_KEY in .env.local (gitignored) or shell env.
 *
 * Usage:
 *   node scripts/propose-sources.mjs <sources-unmatched-csv>
 *
 * Example:
 *   node scripts/propose-sources.mjs scripts/sources-unmatched-movie-classics.csv
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/propose-sources.mjs <sources-unmatched-csv>');
  process.exit(1);
}

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

const MODEL = 'claude-haiku-4-5-20251001';
const BATCH_DELAY_MS = 80;

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
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
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

const SYSTEM_PROMPT = `You identify the movie, TV show, musical, video game, or commercial brand that a song is most strongly associated with — the answer a host would credit in a music-trivia game.

Reply with a single JSON object:
{ "source": "<name>", "confidence": "high" | "medium" | "low" | "unknown" }

Rules:
- "source" is the short canonical name only (e.g. "Star Wars", "Stranger Things", "Hamilton", "Pulp Fiction"). No "(soundtrack)", no year, no episode info.
- For pop songs with a strong single-movie/show association, use that source even if the album metadata doesn't reference it (e.g. "Eye of the Tiger" → "Rocky III"; "I Will Always Love You" by Whitney → "The Bodyguard").
- For commercial jingles or songs known for one specific brand campaign, use the brand (e.g. "Like a Rock" → "Chevrolet").
- For instrumental film/TV scores, use the work title (e.g. "Throne Room and End Title" → "Star Wars").
- For pure pop songs with no notable media association, return "source": "", confidence: "unknown".
- If you're unsure between two options, pick the one a casual trivia host would credit, and mark confidence "low".

Reply with ONLY the JSON object, no prose, no markdown fences.`;

async function callClaude(title, artist, album) {
  const userPrompt = `Title: ${title}\nArtist: ${artist}\nAlbum: ${album}`;
  const body = {
    model: MODEL,
    max_tokens: 200,
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
  try {
    const parsed = JSON.parse(text);
    return {
      source: typeof parsed.source === 'string' ? parsed.source.trim() : '',
      confidence: parsed.confidence || 'unknown',
    };
  } catch {
    return { source: '', confidence: 'unknown' };
  }
}

async function main() {
  console.log(`=== Propose Sources ===`);
  console.log(`Input: ${inputPath}`);
  console.log(`Model: ${MODEL}\n`);

  if (!existsSync(inputPath)) {
    console.error(`✗ File not found: ${inputPath}`);
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(inputPath, 'utf8'));
  console.log(`Tracks to propose sources for: ${rows.length}\n`);

  const out = [];
  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;
  let unknownCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let proposal = { source: '', confidence: 'unknown' };
    try {
      proposal = await callClaude(r.Title, r.Artist, r.Album);
    } catch (e) {
      console.error(`  ✗ [${i + 1}/${rows.length}] ${r.Title} — ${e.message.slice(0, 80)}`);
    }
    if (proposal.confidence === 'high') highCount++;
    else if (proposal.confidence === 'medium') medCount++;
    else if (proposal.confidence === 'low') lowCount++;
    else unknownCount++;
    out.push({ ...r, ProposedSource: proposal.source, Confidence: proposal.confidence });
    if ((i + 1) % 20 === 0 || i === rows.length - 1) {
      process.stdout.write(
        `  [${i + 1}/${rows.length}]  H:${highCount} M:${medCount} L:${lowCount} ?:${unknownCount}\n`
      );
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`  High confidence:    ${highCount}`);
  console.log(`  Medium confidence:  ${medCount}`);
  console.log(`  Low confidence:     ${lowCount}`);
  console.log(`  Unknown/no match:   ${unknownCount}`);

  const outName = basename(inputPath, '.csv').replace(/^sources-unmatched-/, 'proposed-sources-');
  const outPath = join(__dirname, `${outName}.csv`);
  const headers = ['DeezerId', 'Title', 'Artist', 'Album', 'Source', 'ProposedSource', 'Confidence'];
  let csv = headers.join(',') + '\n';
  for (const r of out) {
    csv += headers.map((h) => csvField(r[h] ?? '')).join(',') + '\n';
  }
  writeFileSync(outPath, csv);
  console.log(`\n✓ Wrote ${outPath}`);
  console.log('\n=== NEXT STEPS ===');
  console.log('1. Open the CSV in Sheets');
  console.log('2. Review the ProposedSource column — for each row:');
  console.log('   - Correct? copy it to the empty Source column');
  console.log('   - Wrong?   type the right answer in Source');
  console.log('   - Pure pop song no media tie? leave Source empty');
  console.log('3. Save the CSV');
  console.log('4. Run: node scripts/apply-sources.mjs <edited-csv>');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
