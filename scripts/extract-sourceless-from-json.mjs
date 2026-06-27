#!/usr/bin/env node
/**
 * Find tracks with empty `source` in a curated-Deezer JSON file. Outputs
 * a CSV in the same shape as sources-unmatched-*.csv so the existing
 * propose-sources.mjs can pick it up directly.
 *
 * Usage:
 *   node scripts/extract-sourceless-from-json.mjs <curated-deezer-json-path>
 *
 * Example:
 *   node scripts/extract-sourceless-from-json.mjs assets/curated-deezer/modern-movies.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/extract-sourceless-from-json.mjs <curated-deezer-json-path>');
  process.exit(1);
}

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const data = JSON.parse(readFileSync(inputPath, 'utf8'));
const tracks = data.tracks || [];
const sourceless = tracks.filter((t) => !t.source || t.source.trim() === '');

console.log(`Pack: ${data.name || data.id}`);
console.log(`Total tracks:        ${tracks.length}`);
console.log(`With source:         ${tracks.length - sourceless.length}`);
console.log(`Without source:      ${sourceless.length}`);

const slug = basename(inputPath, '.json');
const outPath = join(__dirname, `sources-unmatched-${slug}.csv`);
const headers = ['DeezerId', 'Title', 'Artist', 'Album', 'Source'];
let csv = headers.join(',') + '\n';
for (const t of sourceless) {
  csv +=
    [
      csvField(t.deezerId),
      csvField(t.title),
      csvField(t.artist),
      csvField(''), // album not stored in JSON; LLM still gets title+artist
      csvField(''),
    ].join(',') + '\n';
}
writeFileSync(outPath, csv);
console.log(`\n✓ Wrote ${outPath}`);
console.log(`\nNext: node scripts/propose-sources.mjs ${outPath} --strict`);
