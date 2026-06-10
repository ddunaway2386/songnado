#!/usr/bin/env node
/**
 * Merge a keep-list (auto-curate output) with approved substitutions
 * (preview-player export) into a final pack CSV, deduping along the way.
 *
 * Inputs:
 *   keep-list-<id>.csv               (from auto-curate.mjs)
 *   approved-substitutions-<id>.csv  (from preview-player Export button)
 *
 * Output:
 *   final-pack-<id>.csv  (DeezerId + Title + Artist columns, deduped)
 *
 * Dedup rules:
 *  1. If an approved substitution's (title, artist) — normalized — already
 *     exists in the keep-list, drop the substitution (the keep-list copy
 *     already has a preview).
 *  2. If two approved substitutions normalize to the same song, keep only
 *     the FIRST occurrence (curator already vetted both — first is fine).
 *
 * Usage:
 *   node scripts/merge-final-pack.mjs <playlist-id>
 *
 * Example:
 *   node scripts/merge-final-pack.mjs 13707544281
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const playlistId = process.argv[2];
if (!playlistId) {
  console.error('Usage: node scripts/merge-final-pack.mjs <playlist-id>');
  process.exit(1);
}

const keepPath = join(__dirname, `keep-list-${playlistId}.csv`);
const subsPath = join(__dirname, `approved-substitutions-${playlistId}.csv`);
const outPath = join(__dirname, `final-pack-${playlistId}.csv`);

for (const p of [keepPath, subsPath]) {
  if (!existsSync(p)) {
    console.error(`✗ Missing input: ${p}`);
    process.exit(1);
  }
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
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
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

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[''']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*-\s*remaster.*$/i, '')
    .replace(/\s*-\s*live.*$/i, '')
    .replace(/\s*-\s*single version.*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('=== Merge Final Pack ===\n');

const keep = parseCsv(readFileSync(keepPath, 'utf8'));
const subs = parseCsv(readFileSync(subsPath, 'utf8'));

console.log(`Keep-list:           ${keep.length} tracks`);
console.log(`Approved subs:       ${subs.length} tracks\n`);

const keepKeys = new Set(keep.map((r) => normalize(r.Title) + '|' + normalize(r.Artist)));

const finalRows = [];
const droppedAsDupOfKeep = [];
const droppedAsInternalDup = [];
const seenSubKeys = new Set();

for (const r of keep) {
  finalRows.push({
    DeezerId: r.DeezerId,
    Title: r.Title,
    Artist: r.Artist,
    Source: 'keep-list',
  });
}

for (const s of subs) {
  const k = normalize(s.AlternativeTitle) + '|' + normalize(s.AlternativeArtist);
  if (keepKeys.has(k)) {
    droppedAsDupOfKeep.push(s);
    continue;
  }
  if (seenSubKeys.has(k)) {
    droppedAsInternalDup.push(s);
    continue;
  }
  seenSubKeys.add(k);
  finalRows.push({
    DeezerId: s.AlternativeDeezerId,
    Title: s.AlternativeTitle,
    Artist: s.AlternativeArtist,
    Source: 'substitution',
  });
}

const headers = ['DeezerId', 'Title', 'Artist', 'Source'];
let csv = headers.join(',') + '\n';
for (const r of finalRows) {
  csv += headers.map((h) => csvField(r[h])).join(',') + '\n';
}
writeFileSync(outPath, csv);

console.log('=== DEDUP REPORT ===');
console.log(`  Final pack size:                ${finalRows.length}`);
console.log(`  ├ From keep-list:               ${keep.length}`);
console.log(`  └ From substitutions (net new): ${finalRows.length - keep.length}`);
console.log(`  Dropped — dup of keep-list:     ${droppedAsDupOfKeep.length}`);
console.log(`  Dropped — internal dup:         ${droppedAsInternalDup.length}\n`);

if (droppedAsDupOfKeep.length > 0) {
  console.log('Substitutions dropped (already in keep-list):');
  for (const d of droppedAsDupOfKeep) {
    console.log(`  - ${d.AlternativeTitle} — ${d.AlternativeArtist}`);
  }
  console.log('');
}
if (droppedAsInternalDup.length > 0) {
  console.log('Substitutions dropped (kept first of pair):');
  for (const d of droppedAsInternalDup) {
    console.log(`  - ${d.AlternativeTitle} — ${d.AlternativeArtist}`);
  }
  console.log('');
}

console.log(`✓ Wrote ${outPath}`);
console.log('\n=== NEXT STEPS ===');
console.log('1. Build the Deezer playlist from this CSV (build-playlist.mjs or Soundiiz)');
console.log('2. Make it public on deezer.com');
console.log('3. Update lib/playlists.ts with the new ID + name + track count');
