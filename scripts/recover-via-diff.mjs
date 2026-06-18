#!/usr/bin/env node
/**
 * Recover missing tracks by diffing the Soundiiz import CSV against
 * the actual Deezer playlist contents.
 *
 * Bypass for when Soundiiz has archived a batch and the error CSV is
 * no longer accessible. Output is the same as recover-missing-tracks.mjs
 * — a manual-add URL list for the curator to paste into Deezer.
 *
 * Usage:
 *   node scripts/recover-via-diff.mjs <soundiiz-import-csv> <deezer-playlist-id>
 *
 * Example:
 *   node scripts/recover-via-diff.mjs scripts/soundiiz-import-theme-movie-classics.csv 15427798341
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const importPath = process.argv[2];
const playlistId = process.argv[3];
if (!importPath || !playlistId) {
  console.error('Usage: node scripts/recover-via-diff.mjs <soundiiz-import-csv> <deezer-playlist-id>');
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

async function fetchPlaylistTracks(playlistId) {
  const all = [];
  let index = 0;
  const limit = 100;
  while (true) {
    const url = `https://api.deezer.com/playlist/${playlistId}/tracks?index=${index}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (data.error) break;
    const batch = data.data || [];
    all.push(...batch);
    if (!data.next || batch.length < limit) break;
    index += limit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return all;
}

async function searchDeezer(title, artist) {
  const q = `track:"${title}" artist:"${artist}"`;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Recover Via Diff ===\n');
  console.log(`Import CSV:  ${importPath}`);
  console.log(`Playlist ID: ${playlistId}\n`);

  const sent = parseCsv(readFileSync(importPath, 'utf8'));
  console.log(`Tracks in import CSV: ${sent.length}`);

  console.log(`Fetching live Deezer playlist...`);
  const live = await fetchPlaylistTracks(playlistId);
  console.log(`Tracks in Deezer playlist: ${live.length}\n`);

  const liveKeys = new Set(
    live.map((t) => norm(t.title) + '|' + norm(t.artist?.name))
  );

  const missing = sent.filter(
    (r) => !liveKeys.has(norm(r.Title) + '|' + norm(r.Artist))
  );
  console.log(`Missing: ${missing.length}\n`);

  console.log('Searching Deezer for each missing track...');
  const recovered = [];
  const unfound = [];
  for (let i = 0; i < missing.length; i++) {
    const m = missing[i];
    const found = await searchDeezer(m.Title, m.Artist);
    if (found && found.id) {
      const url = `https://www.deezer.com/track/${found.id}`;
      recovered.push({ title: m.Title, artist: m.Artist, deezerId: found.id, url });
      console.log(`  ✓ [${i + 1}/${missing.length}] ${m.Title} — ${m.Artist}`);
      console.log(`    ${url}`);
    } else {
      unfound.push(m);
      console.log(`  ✗ [${i + 1}/${missing.length}] ${m.Title} — ${m.Artist}  (no search hit)`);
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  console.log(`\nRecovered: ${recovered.length}/${missing.length}`);
  if (unfound.length > 0) console.log(`Unfound:   ${unfound.length}`);

  const slug = basename(importPath, '.csv').replace(/^soundiiz-import-theme-/, '');
  const outPath = join(__dirname, `manual-add-theme-${slug}.txt`);
  let txt = `# Manual recovery list for playlist ${playlistId}\n`;
  txt += `# Soundiiz batch archived; recovered ${recovered.length}/${missing.length} via diff + Deezer search.\n`;
  txt += `# For each URL: paste in Deezer.com address bar → ... → Add to playlist.\n\n`;
  for (const r of recovered) {
    txt += `${r.url}   # ${r.title} — ${r.artist}\n`;
  }
  if (unfound.length > 0) {
    txt += '\n# Could not find these in Deezer search (would need manual lookup):\n';
    for (const u of unfound) txt += `# ${u.Title} — ${u.Artist}\n`;
  }
  writeFileSync(outPath, txt);
  console.log(`\n✓ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
