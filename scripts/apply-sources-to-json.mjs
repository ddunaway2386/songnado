#!/usr/bin/env node
/**
 * Apply curator-confirmed sources from a CSV directly into a curated-Deezer
 * JSON file. Matches by DeezerId. Only writes non-empty Source values
 * (empty source = curator deliberately left blank for "no media tie").
 *
 * Usage:
 *   node scripts/apply-sources-to-json.mjs <confirmed-sources-csv> <curated-deezer-json-path>
 *
 * Example:
 *   node scripts/apply-sources-to-json.mjs scripts/proposed-sources-modern-movies.csv assets/curated-deezer/modern-movies.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const csvPath = process.argv[2];
const jsonPath = process.argv[3];
if (!csvPath || !jsonPath) {
  console.error('Usage: node scripts/apply-sources-to-json.mjs <csv> <curated-deezer-json>');
  process.exit(1);
}
if (!existsSync(csvPath)) {
  console.error(`✗ CSV not found: ${csvPath}`);
  process.exit(1);
}
if (!existsSync(jsonPath)) {
  console.error(`✗ JSON not found: ${jsonPath}`);
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

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));

const newSourceById = {};
for (const r of rows) {
  const id = String(r.DeezerId || '').trim();
  const src = String(r.Source || '').trim();
  if (!id || !src) continue;
  newSourceById[id] = src;
}

let updated = 0;
let skipped = 0;
for (const t of data.tracks) {
  const newSrc = newSourceById[String(t.deezerId)];
  if (newSrc && !t.source) {
    t.source = newSrc;
    updated++;
  } else {
    skipped++;
  }
}

writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

const withSource = data.tracks.filter((t) => t.source).length;
console.log(`=== Applied sources to ${jsonPath} ===`);
console.log(`  Tracks updated:     ${updated}`);
console.log(`  Tracks unchanged:   ${skipped}`);
console.log(`  Final coverage:     ${withSource}/${data.tracks.length} (${Math.round(withSource / data.tracks.length * 100)}%)`);
