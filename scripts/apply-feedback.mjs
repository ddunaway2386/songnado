#!/usr/bin/env node
/**
 * Apply family-test feedback JSON exports to the curated-Deezer JSON packs.
 *
 * Usage:
 *   node scripts/apply-feedback.mjs feedback/<person1>.json feedback/<person2>.json ...
 *
 * Where each input file is a JSON export from a family member's phone
 * (via the /feedback screen's Share button). Aggregates all inputs, then:
 *
 *  - For each 'remove' flag: removes the matching track from the curated
 *    JSON pack (matched by title + artist, case-insensitive, ignoring
 *    parenthesized suffixes).
 *  - For each 'bad-version' flag: writes to
 *    scripts/needs-better-version.csv so Daniel can search Deezer for a
 *    better recording and manually swap.
 *
 * Requires at least 1 vote per flag to act (single family member can
 * force a decision). If you want a threshold (e.g. 2+ people agreed),
 * add a --min-votes N flag.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CURATED_DIR = join(PROJECT_ROOT, 'assets', 'curated-deezer');
const BAD_VERSION_CSV = join(__dirname, 'needs-better-version.csv');

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[’‘'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const args = process.argv.slice(2);
let minVotes = 1;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-votes') { minVotes = parseInt(args[++i], 10); continue; }
  files.push(args[i]);
}

if (files.length === 0) {
  console.error('Usage: node apply-feedback.mjs <exported-feedback.json> [more.json ...]');
  console.error('Optional: --min-votes N (default 1)');
  process.exit(1);
}

// Vote tally: key = pack:title:artist:kind -> { count, entry }
const votes = new Map();

for (const file of files) {
  const source = basename(file, '.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`Reading ${file}: ${(data.remove?.length || 0) + (data.badVersion?.length || 0)} flags`);
  for (const kind of ['remove', 'badVersion']) {
    for (const e of data[kind] || []) {
      const key = `${e.packId}::${norm(e.title)}::${norm(e.artist)}::${kind}`;
      const cur = votes.get(key) || { count: 0, entry: e, kind, voters: [] };
      cur.count += 1;
      cur.voters.push(source);
      votes.set(key, cur);
    }
  }
}

console.log(`\nAggregated ${votes.size} unique flag entries. Applying with min-votes=${minVotes}...\n`);

// Load all curated-deezer JSON packs into memory, keyed by packId
const packs = new Map();
for (const packSlug of [
  'movie-soundtracks', 'movie-songs',
  'classic-tv-themes', 'modern-tv-themes',
  'wedding', 'broadway', 'road-trip',
]) {
  const path = join(CURATED_DIR, `${packSlug}.json`);
  if (!existsSync(path)) continue;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  packs.set(data.id, { path, data, dirty: false });
}

// Apply removes
const badVersionRows = ['pack_name,pack_id,title,artist,source,voters,previewUrl'];
let removeCount = 0, badVersionCount = 0, notFound = 0;

for (const { count, entry, kind, voters } of votes.values()) {
  if (count < minVotes) continue;
  const pack = packs.get(entry.packId);
  if (!pack) {
    console.log(`  ⚠ ${entry.title} — ${entry.artist}: pack '${entry.packName}' (${entry.packId}) not in curated-Deezer catalog. Skipping.`);
    continue;
  }
  if (kind === 'remove') {
    const beforeCount = pack.data.tracks.length;
    pack.data.tracks = pack.data.tracks.filter(
      (t) => norm(t.title) !== norm(entry.title) || norm(t.artist) !== norm(entry.artist)
    );
    const removed = beforeCount - pack.data.tracks.length;
    if (removed > 0) {
      pack.dirty = true;
      removeCount += removed;
      console.log(`  🗑 ${entry.title} — ${entry.artist} (${entry.packName}) [voters: ${voters.join(', ')}]`);
    } else {
      notFound++;
      console.log(`  ⚠ Not in pack: ${entry.title} — ${entry.artist} (${entry.packName})`);
    }
  } else {
    // bad-version: log to CSV for manual replacement
    const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
    badVersionRows.push([
      escape(entry.packName), escape(entry.packId),
      escape(entry.title), escape(entry.artist),
      escape(entry.source), escape(voters.join(';')),
      escape(entry.previewUrl),
    ].join(','));
    badVersionCount++;
    console.log(`  🎵 ${entry.title} — ${entry.artist} (${entry.packName}) [needs better version]`);
    // Also remove the bad version so it stops playing
    const beforeCount = pack.data.tracks.length;
    pack.data.tracks = pack.data.tracks.filter(
      (t) => norm(t.title) !== norm(entry.title) || norm(t.artist) !== norm(entry.artist)
    );
    if (beforeCount !== pack.data.tracks.length) pack.dirty = true;
  }
}

// Write dirty packs
for (const [id, pack] of packs) {
  if (pack.dirty) {
    writeFileSync(pack.path, JSON.stringify(pack.data, null, 2) + '\n');
    console.log(`\n✓ Wrote ${pack.path} (${pack.data.tracks.length} tracks)`);
  }
}

// Write bad-version CSV
if (badVersionCount > 0) {
  writeFileSync(BAD_VERSION_CSV, badVersionRows.join('\n') + '\n');
  console.log(`\n✓ Wrote ${BAD_VERSION_CSV} — ${badVersionCount} tracks need manual better-version lookup`);
}

console.log('\n=========================================');
console.log(`  Removed:              ${removeCount}`);
console.log(`  Bad versions flagged: ${badVersionCount}`);
console.log(`  Not found in packs:   ${notFound}`);
console.log('=========================================');
