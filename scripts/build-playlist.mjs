#!/usr/bin/env node
/**
 * Build a clean Deezer playlist from a curated CSV.
 *
 * Reads a CSV with Deezer track IDs + a "Keep" column, creates a new
 * Deezer playlist with the user-provided name, and adds all the Keep
 * tracks. Outputs the new playlist's Deezer ID for you to paste into
 * `lib/playlists.ts`.
 *
 * Prerequisites:
 *  1. Run scripts/deezer-auth.mjs ONCE to capture access token
 *  2. The input CSV must have at least: a DeezerId column + a Keep
 *     decision column (default 'Final decision' = 'Keep')
 *
 * Usage:
 *   node scripts/build-playlist.mjs <csv-path> <new-playlist-name>
 *
 * Examples:
 *   node scripts/build-playlist.mjs scripts/curation-13707544281.csv "90s Mega Hits"
 *   node scripts/build-playlist.mjs scripts/wedding-songs.csv "Wedding Reception Bangers"
 *
 * Custom column / value:
 *   node scripts/build-playlist.mjs <csv> <name> --keep-column "My decision" --keep-value "Yes"
 *
 * Quick-test mode (use the Auto-keep tier from curate-playlist.mjs without manual decisions):
 *   node scripts/build-playlist.mjs scripts/curation-13707544281.csv "90s Test" --keep-column Recommendation --keep-value "Auto-keep"
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');

const TRACKS_PER_BATCH = 50;
const RATE_LIMIT_DELAY_MS = 200;

// ---- Parse args ----
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/build-playlist.mjs <csv-path> <new-playlist-name> [--keep-column COL] [--keep-value VAL]');
  process.exit(1);
}
const csvPath = args[0];
const playlistName = args[1];
let keepColumn = 'Final decision';
let keepValue = 'Keep';
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--keep-column') keepColumn = args[++i];
  else if (args[i] === '--keep-value') keepValue = args[++i];
}

// ---- Load env ----
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
const ACCESS_TOKEN = env.DEEZER_ACCESS_TOKEN || process.env.DEEZER_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('Missing DEEZER_ACCESS_TOKEN in .env.local.');
  console.error('Run scripts/deezer-auth.mjs first to obtain one.');
  process.exit(1);
}

// ---- CSV parser (handles quoted fields with commas and embedded quotes) ----
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

// ---- Deezer API helpers ----
async function createPlaylist(title) {
  const url = `https://api.deezer.com/user/me/playlists?title=${encodeURIComponent(title)}&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Playlist create failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Deezer error: ${JSON.stringify(json.error)}`);
  if (!json.id) throw new Error(`No playlist ID in response: ${JSON.stringify(json)}`);
  return json.id;
}

async function addTracksToPlaylist(playlistId, trackIds) {
  const songs = trackIds.join(',');
  const url = `https://api.deezer.com/playlist/${playlistId}/tracks?songs=${songs}&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Add tracks failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Deezer error: ${JSON.stringify(json.error)}`);
  return json === true || json.id !== undefined;
}

// ---- Main ----
async function main() {
  console.log('=== Songnado Playlist Builder ===\n');

  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Reading CSV: ${csvPath}`);
  const csvText = readFileSync(csvPath, 'utf8');
  const { headers, rows } = parseCsv(csvText);
  console.log(`  Total rows: ${rows.length}`);
  console.log(`  Columns:    ${headers.join(', ')}`);

  if (!headers.includes(keepColumn)) {
    console.error(`\n✗ Column '${keepColumn}' not found in CSV.`);
    console.error(`  Available: ${headers.join(', ')}`);
    console.error(`  Use --keep-column to specify a different column name.`);
    process.exit(1);
  }
  if (!headers.includes('DeezerId')) {
    console.error(`\n✗ Column 'DeezerId' required (case-sensitive). Found columns: ${headers.join(', ')}`);
    process.exit(1);
  }

  // Filter to Keep rows
  const keepRows = rows.filter(
    (r) => r[keepColumn]?.trim().toLowerCase() === keepValue.trim().toLowerCase()
  );
  console.log(`\nFiltered to '${keepColumn}' = '${keepValue}': ${keepRows.length} tracks\n`);

  if (keepRows.length === 0) {
    console.error(`✗ No rows match '${keepColumn}' = '${keepValue}'. Nothing to do.`);
    process.exit(1);
  }

  // Extract Deezer IDs
  const trackIds = keepRows
    .map((r) => r.DeezerId?.trim())
    .filter((id) => id && /^\d+$/.test(id));

  const skippedCount = keepRows.length - trackIds.length;
  if (skippedCount > 0) {
    console.log(`⚠  Skipping ${skippedCount} rows with missing/invalid DeezerId.\n`);
  }

  console.log(`Creating Deezer playlist: "${playlistName}"...`);
  const playlistId = await createPlaylist(playlistName);
  console.log(`✓ Created playlist ID: ${playlistId}\n`);

  console.log(`Adding ${trackIds.length} tracks in batches of ${TRACKS_PER_BATCH}...`);
  let added = 0;
  let batchCount = 0;
  for (let i = 0; i < trackIds.length; i += TRACKS_PER_BATCH) {
    const batch = trackIds.slice(i, i + TRACKS_PER_BATCH);
    batchCount++;
    try {
      await addTracksToPlaylist(playlistId, batch);
      added += batch.length;
      process.stdout.write(`  Batch ${batchCount}: +${batch.length} (total ${added}/${trackIds.length})\r`);
    } catch (err) {
      console.error(`\n  Batch ${batchCount} failed: ${err.message}`);
      console.error(`  Track IDs in failing batch: ${batch.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }
  console.log(`\n\n✓ Done! Added ${added}/${trackIds.length} tracks.\n`);

  console.log('=== NEXT STEPS ===');
  console.log(`1. Visit your new playlist: https://www.deezer.com/us/playlist/${playlistId}`);
  console.log(`2. Make it public: Playlist Settings → Public ON`);
  console.log(`3. Add the playlist to lib/playlists.ts:\n`);
  console.log(`   { id: '${playlistId}', name: '${playlistName}', totalTracks: ${added}, tier: 'free' },\n`);
  console.log(`4. Commit & push.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
