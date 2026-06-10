#!/usr/bin/env node
/**
 * Auto-curate: takes a curation CSV, applies hard cuts, then takes the
 * top N tracks by Deezer popularity rank. Outputs a Keep list ready
 * for second-opinion review by family curators.
 *
 * Hard cuts (always applied, non-configurable):
 *  - No-preview tracks (unplayable in game)
 *  - Exact duplicates (same Deezer track ID appears twice)
 *  - Near duplicates (same title + artist, different version) —
 *    keeps the higher-rank version
 *  - Very short tracks (under 60 seconds) — usually interludes
 *
 * Soft selection:
 *  - Sort by rank descending
 *  - Take top N (default 400)
 *  - Optional: enforce artist concentration cap (default 5% max per artist)
 *
 * Output files:
 *  - scripts/keep-list-<id>.csv — your auto-curated pack (sorted by rank desc)
 *  - scripts/cut-list-<id>.csv  — everything removed, with reason
 *
 * Family curator workflow:
 *  - Each son/DiL opens keep-list-<id>.csv in Sheets
 *  - Adds a column "[Their name] - cut?"
 *  - Goes through the ~400 tracks, marks anything they'd cut with a Y
 *  - Sends back to Daniel
 *  - Daniel aggregates: cut anything 2+ family members vote against
 *
 * Usage:
 *   node scripts/auto-curate.mjs <input-csv> [--target N] [--artist-cap PCT]
 *
 * Examples:
 *   node scripts/auto-curate.mjs scripts/curation-13707544281.csv
 *   node scripts/auto-curate.mjs scripts/curation-13707544281.csv --target 350
 *   node scripts/auto-curate.mjs scripts/curation-13707544281.csv --target 500 --artist-cap 3
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Parse args ----
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/auto-curate.mjs <input-csv> [--target N] [--artist-cap PCT]');
  process.exit(1);
}
const inputPath = args[0];
let TARGET_COUNT = 400;
let ARTIST_CAP_PCT = 5;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--target') TARGET_COUNT = parseInt(args[++i], 10);
  else if (args[i] === '--artist-cap') ARTIST_CAP_PCT = parseFloat(args[++i]);
}

// ---- CSV parser (handles quoted fields) ----
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === ',') {
        result.push(current);
        current = '';
      } else if (c === '"' && current.length === 0) {
        inQuotes = true;
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j] ?? '';
    }
    rows.push(row);
  }
  return { headers, rows };
}

function toCsvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function writeCsv(rows, headers, path) {
  let csv = headers.join(',') + '\n';
  for (const row of rows) {
    csv += headers.map((h) => toCsvField(row[h])).join(',') + '\n';
  }
  writeFileSync(path, csv);
}

// ---- Main ----
function main() {
  console.log('=== Songnado Auto-Curate ===\n');
  console.log(`Input: ${inputPath}`);
  console.log(`Target track count: ${TARGET_COUNT}`);
  console.log(`Artist cap: ${ARTIST_CAP_PCT}%\n`);

  if (!existsSync(inputPath)) {
    console.error(`✗ File not found: ${inputPath}`);
    process.exit(1);
  }

  const text = readFileSync(inputPath, 'utf8');
  const { headers, rows } = parseCsv(text);
  console.log(`Loaded ${rows.length} tracks from CSV.\n`);

  // Validate required columns
  for (const required of ['Title', 'Artist', 'DeezerId', 'Rank', 'HasPreview', 'DurationSec', 'IsExactDup', 'NearDupOfPosition']) {
    if (!headers.includes(required)) {
      console.error(`✗ Required column missing: ${required}`);
      console.error(`  Available: ${headers.join(', ')}`);
      process.exit(1);
    }
  }

  // Step 1: apply hard cuts
  console.log('=== HARD CUTS ===');
  const cuts = [];
  const keeps = [];
  let noPreview = 0, exactDup = 0, nearDup = 0, tooShort = 0;

  // For near-dup detection: build a map of normalized title+artist
  // → all positions. Keep the highest-rank version.
  const dupGroups = new Map();
  for (const row of rows) {
    const key = (row.Title || '').trim().toLowerCase()
      .replace(/['']/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s*-\s*remaster.*$/i, '')
      .replace(/\s*-\s*live.*$/i, '')
      .replace(/\s*-\s*single version.*$/i, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      + '|||' +
      (row.Artist || '').trim().toLowerCase();
    if (!dupGroups.has(key)) dupGroups.set(key, []);
    dupGroups.get(key).push(row);
  }

  // For each dup group, keep highest rank, mark others for cut
  const dupCutIds = new Set();
  for (const group of dupGroups.values()) {
    if (group.length === 1) continue;
    group.sort((a, b) => parseInt(b.Rank, 10) - parseInt(a.Rank, 10));
    // First is winner; rest get marked
    for (let i = 1; i < group.length; i++) {
      dupCutIds.add(group[i].DeezerId);
    }
  }

  for (const row of rows) {
    const hasPreview = row.HasPreview === 'true' || row.HasPreview === true;
    const isExactDup = row.IsExactDup === 'true' || row.IsExactDup === true;
    const duration = parseInt(row.DurationSec, 10) || 0;
    const rank = parseInt(row.Rank, 10) || 0;

    let cutReason = null;
    if (!hasPreview) {
      cutReason = 'No preview URL';
      noPreview++;
    } else if (isExactDup) {
      cutReason = 'Exact duplicate (same Deezer ID)';
      exactDup++;
    } else if (dupCutIds.has(row.DeezerId)) {
      cutReason = 'Near duplicate (different version, kept higher-rank copy)';
      nearDup++;
    } else if (duration < 60) {
      cutReason = `Too short (${duration}s, likely interlude/intro)`;
      tooShort++;
    }

    if (cutReason) {
      cuts.push({ ...row, CutReason: cutReason, CutStage: 'Hard cut' });
    } else {
      keeps.push({ ...row, Rank: rank });
    }
  }

  console.log(`  No preview:       ${noPreview}`);
  console.log(`  Exact duplicates: ${exactDup}`);
  console.log(`  Near duplicates:  ${nearDup}`);
  console.log(`  Too short:        ${tooShort}`);
  console.log(`  → ${cuts.length} cut, ${keeps.length} remain\n`);

  // Step 2: sort by rank descending
  keeps.sort((a, b) => b.Rank - a.Rank);

  // Step 3: artist concentration cap
  console.log('=== ARTIST CAP ===');
  const maxPerArtist = Math.max(1, Math.ceil(TARGET_COUNT * (ARTIST_CAP_PCT / 100)));
  console.log(`  Max ${maxPerArtist} tracks per artist (cap = ${ARTIST_CAP_PCT}% of ${TARGET_COUNT})\n`);

  const artistCounts = new Map();
  const afterCap = [];
  const cappedCuts = [];
  for (const row of keeps) {
    const artist = (row.Artist || '').trim();
    const current = artistCounts.get(artist) || 0;
    if (current >= maxPerArtist) {
      cappedCuts.push({
        ...row,
        CutReason: `Artist over cap (${artist} already has ${maxPerArtist} tracks, this is rank ${row.Rank})`,
        CutStage: 'Artist cap',
      });
    } else {
      artistCounts.set(artist, current + 1);
      afterCap.push(row);
    }
  }
  console.log(`  ${cappedCuts.length} cut by artist cap, ${afterCap.length} remain\n`);

  // Step 4: take top N
  console.log('=== TOP N SELECTION ===');
  const finalKeeps = afterCap.slice(0, TARGET_COUNT);
  const tailCuts = afterCap.slice(TARGET_COUNT).map((row) => ({
    ...row,
    CutReason: `Below rank cutoff (target ${TARGET_COUNT}, this was rank-position ${afterCap.indexOf(row) + 1})`,
    CutStage: 'Tail cut',
  }));
  console.log(`  Top ${finalKeeps.length} by rank kept`);
  console.log(`  ${tailCuts.length} cut as tail (below rank cutoff)\n`);

  const allCuts = [...cuts, ...cappedCuts, ...tailCuts];

  // Summary
  console.log('=== FINAL ===');
  console.log(`  Started with: ${rows.length} tracks`);
  console.log(`  Auto-curated to: ${finalKeeps.length} tracks`);
  console.log(`  Removed:       ${allCuts.length} tracks\n`);

  // Top artists in final
  const finalArtistCounts = new Map();
  for (const row of finalKeeps) {
    const a = row.Artist;
    finalArtistCounts.set(a, (finalArtistCounts.get(a) || 0) + 1);
  }
  const topFinalArtists = [...finalArtistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('Top 10 artists in final list:');
  for (const [name, count] of topFinalArtists) {
    const pct = ((count / finalKeeps.length) * 100).toFixed(1);
    console.log(`  ${name.padEnd(35)} ${count.toString().padStart(3)} tracks (${pct}%)`);
  }
  console.log('');

  // Write outputs
  const inputBase = basename(inputPath, '.csv').replace(/^curation-/, '');
  const keepPath = join(__dirname, `keep-list-${inputBase}.csv`);
  const cutPath = join(__dirname, `cut-list-${inputBase}.csv`);

  const keepHeaders = ['Title', 'Artist', 'Album', 'DeezerId', 'Rank', 'DurationSec', 'Explicit', 'PreviewUrl'];
  writeCsv(finalKeeps, keepHeaders, keepPath);
  console.log(`✓ Wrote ${keepPath} — ${finalKeeps.length} tracks (your auto-curated pack)`);

  // For cut list, sort alphabetically by title for easier "find in Deezer" workflow
  allCuts.sort((a, b) => (a.Title || '').toLowerCase().localeCompare((b.Title || '').toLowerCase()));
  const cutHeaders = ['Title', 'Artist', 'DeezerId', 'Rank', 'CutReason', 'CutStage'];
  writeCsv(allCuts, cutHeaders, cutPath);
  console.log(`✓ Wrote ${cutPath} — ${allCuts.length} tracks (sorted A-Z by title for trimming in Deezer)`);

  console.log('\n=== NEXT STEPS ===');
  console.log(`1. Send keep-list-${inputBase}.csv to each son/DiL for second-opinion review`);
  console.log(`   - They add a column 'Their initials - cut?' and mark Y for any they'd cut`);
  console.log(`   - You aggregate: tracks with 2+ family votes against → final cut`);
  console.log(`2. To trim the existing playlist in Deezer:`);
  console.log(`   - Open cut-list-${inputBase}.csv (sorted alphabetically)`);
  console.log(`   - Open your existing playlist on deezer.com`);
  console.log(`   - For each cut row, find + remove from playlist`);
  console.log(`3. Or: Soundiiz Pro path → upload keep-list-${inputBase}.csv → creates a new Deezer playlist`);
}

main();
