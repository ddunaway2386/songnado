#!/usr/bin/env node
/**
 * Merge a curator-confirmed sources CSV into assets/sources/all.json.
 *
 * Takes a CSV with columns DeezerId, Source (and ignores all others).
 * For each row where Source is non-empty, writes/overwrites the mapping
 * in the bundled JSON. Existing entries for the same Deezer ID are kept
 * if the new row's Source is empty (curator left it blank intentionally).
 *
 * Usage:
 *   node scripts/apply-sources.mjs <confirmed-sources-csv>
 *
 * Example:
 *   node scripts/apply-sources.mjs scripts/proposed-sources-movie-classics.csv
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const JSON_PATH = join(PROJECT_ROOT, 'assets', 'sources', 'all.json');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/apply-sources.mjs <confirmed-sources-csv>');
  process.exit(1);
}

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

if (!existsSync(inputPath)) {
  console.error(`✗ File not found: ${inputPath}`);
  process.exit(1);
}

const rows = parseCsv(readFileSync(inputPath, 'utf8'));
const existing = existsSync(JSON_PATH)
  ? JSON.parse(readFileSync(JSON_PATH, 'utf8'))
  : {};

let added = 0;
let updated = 0;
let skipped = 0;
for (const r of rows) {
  const id = String(r.DeezerId || '').trim();
  const src = String(r.Source || '').trim();
  if (!id) {
    skipped++;
    continue;
  }
  if (!src) {
    // Empty Source — curator deliberately left blank, don't overwrite existing
    skipped++;
    continue;
  }
  if (id in existing) {
    if (existing[id] !== src) updated++;
  } else {
    added++;
  }
  existing[id] = src;
}

// Sort keys numerically for deterministic JSON output
const sorted = {};
for (const k of Object.keys(existing).sort((a, b) => Number(a) - Number(b))) {
  sorted[k] = existing[k];
}
writeFileSync(JSON_PATH, JSON.stringify(sorted, null, 2) + '\n');

console.log(`=== Applied sources from ${inputPath} ===`);
console.log(`  Added:   ${added}`);
console.log(`  Updated: ${updated}`);
console.log(`  Skipped: ${skipped} (empty source or no DeezerId)`);
console.log(`  Total entries in ${JSON_PATH}: ${Object.keys(sorted).length}`);
