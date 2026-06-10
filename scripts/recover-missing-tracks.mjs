#!/usr/bin/env node
/**
 * Cross-reference Soundiiz "not found" CSV with our final-pack CSV.
 *
 * When Soundiiz's fuzzy match fails on a track, we already have the
 * canonical Deezer track ID for it in our final-pack-*.csv. This script
 * matches them up and prints a Deezer URL for each, so the curator can
 * manually add the missing handful via Deezer's web UI.
 *
 * Usage:
 *   node scripts/recover-missing-tracks.mjs <errors-csv> <final-pack-csv>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const errorsPath = process.argv[2];
const finalPath = process.argv[3];
if (!errorsPath || !finalPath) {
  console.error('Usage: node scripts/recover-missing-tracks.mjs <errors-csv> <final-pack-csv>');
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

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[''']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*-\s*remaster.*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const errors = parseCsv(readFileSync(errorsPath, 'utf8'));
const finalPack = parseCsv(readFileSync(finalPath, 'utf8'));

const byTitle = {};
for (const r of finalPack) {
  const k = norm(r.Title);
  (byTitle[k] = byTitle[k] || []).push(r);
}

console.log(`=== Recovering ${errors.length} missing tracks ===\n`);

const recovered = [];
let unmatched = 0;
for (const e of errors) {
  const titleNorm = norm(e.title);
  const candidates = byTitle[titleNorm] || [];
  let pick = null;
  if (candidates.length === 1) {
    pick = candidates[0];
  } else if (candidates.length > 1 && e.artist) {
    const artNorm = norm(e.artist);
    pick = candidates.find((c) => norm(c.Artist) === artNorm) || candidates[0];
  } else if (candidates.length > 1) {
    pick = candidates[0];
  }
  if (pick) {
    const url = `https://www.deezer.com/track/${pick.DeezerId}`;
    console.log(`✓ ${pick.Title} — ${pick.Artist}`);
    console.log(`  ${url}`);
    recovered.push({ title: pick.Title, artist: pick.Artist, deezerId: pick.DeezerId, url });
  } else {
    unmatched++;
    console.log(`✗ ${e.title} — ${e.artist}  (not found in final-pack)`);
  }
  console.log('');
}

console.log(`Matched: ${recovered.length}/${errors.length}`);
if (unmatched > 0) console.log(`Unmatched: ${unmatched}`);

const playlistName = `90s Mega Hits`;
let txt = `# Manual recovery list for ${playlistName}\n`;
txt += `# Soundiiz could not fuzzy-match these ${errors.length} tracks; we already have\n`;
txt += `# their canonical Deezer IDs from our final-pack CSV.\n`;
txt += `#\n`;
txt += `# For each URL: paste in Deezer.com search → click the track → ... menu →\n`;
txt += `#   Add to playlist → 90's Mega Hits\n\n`;
for (const r of recovered) {
  txt += `${r.url}   # ${r.title} — ${r.artist}\n`;
}
const outPath = join(__dirname, `manual-add-${basename(finalPath, '.csv').replace(/^final-pack-/, '')}.txt`);
writeFileSync(outPath, txt);
console.log(`\n✓ Wrote ${outPath}`);
