#!/usr/bin/env node
/**
 * Find clean (non-explicit) Deezer releases to replace explicit tracks in a
 * curated pack.
 *
 * Most chart singles ship an "edited"/radio version alongside the explicit
 * one. Swapping the Deezer track ID keeps the song in the pack — same title,
 * same artist, same answer for trivia purposes — while the 30s preview we
 * actually play comes from the clean master.
 *
 * We swap ONLY the deezerId and leave the stored title/artist untouched, so
 * the reveal screen keeps showing the canonical song name rather than
 * something like "WAP (Clean Version)".
 *
 * Reads the EXPLICIT rows for the pack out of scripts/audit-findings.csv
 * (produced by audit-curated-packs.mjs), so run that first.
 *
 * Usage:
 *   node scripts/find-clean-versions.mjs <pack-slug> [--apply]
 *
 * Without --apply it only reports. With --apply it rewrites the pack JSON
 * (swapping what it found) and writes the still-explicit remainder to
 * scripts/still-explicit-<slug>.csv for a removal pass.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');
const AUDIT_CSV = join(__dirname, 'audit-findings.csv');

const slug = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!slug) {
  console.error('Usage: node scripts/find-clean-versions.mjs <pack-slug> [--apply]');
  process.exit(1);
}

const JUNK_RE = /karaoke|tribute|made famous|in the style of|cover band|backing track/i;

/**
 * Markers that mean "different recording," not "same song without swears."
 *
 * Critical because norm() strips parentheticals before comparing titles — so
 * without this, "Victoria's Secret (The Metal Version)" and "On My Mama
 * (Christmas Medley)" both match their originals and look like clean swaps.
 * They are much worse than the explicit versions: an instrumental or metal
 * cover is unrecognizable as trivia. Only accept a candidate whose variant
 * markers the ORIGINAL also had.
 */
const VARIANT_RE =
  /\b(instrumental|remix|mix|live|acoustic|version|medley|cover|sped ?up|slowed|reverb|demo|rerecorded|re-recorded|orchestral|piano|lo-?fi|8d|edit)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Variant words present in the decorated parts of a title. */
function variantMarkers(title) {
  const decorations = (title.match(/\((.*?)\)|\[(.*?)\]/g) ?? []).join(' ');
  const found = decorations.match(new RegExp(VARIANT_RE, 'gi')) ?? [];
  return new Set(found.map((s) => s.toLowerCase()));
}

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\bfeat\..*$/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function deezer(url, attempt = 0) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const quota =
      json?.error && /quota|limit/i.test(json.error.type ?? json.error.message ?? '');
    if (quota) throw new Error('rate limited');
    return json;
  } catch (e) {
    if (attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return deezer(url, attempt + 1);
    }
    return { __error: String(e) };
  }
}

// ── Parse the audit CSV for this pack's explicit rows ──────────────
function parseCsvLine(l) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') {
      if (q && l[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const packPath = join(CURATED_DIR, `${slug}.json`);
const pack = JSON.parse(readFileSync(packPath, 'utf8'));

const explicitIds = new Set(
  readFileSync(AUDIT_CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((r) => r[1] === 'EXPLICIT' && r[0] === pack.name)
    .map((r) => r[4])
);

const targets = pack.tracks.filter((t) => explicitIds.has(String(t.deezerId)));
console.log(`${pack.name}: ${pack.tracks.length} tracks, ${targets.length} explicit\n`);

const swapped = [];
const notFound = [];

for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  if (i > 0) await sleep(1100);

  const q = `artist:"${t.artist.replace(/"/g, '')}" track:"${t.title
    .replace(/\(.*?\)/g, '')
    .replace(/"/g, '')
    .trim()}"`;
  const res = await deezer(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`);
  const candidates = (res?.data ?? []).filter((c) => {
    if (!c || c.explicit_lyrics !== false || !c.preview) return false;
    if (JUNK_RE.test(c.title) || JUNK_RE.test(c.artist?.name ?? '')) return false;
    // Must be the same song by the same artist — search is fuzzy enough to
    // return covers and unrelated tracks with similar words.
    if (norm(c.artist?.name) !== norm(t.artist)) return false;
    if (norm(c.title) !== norm(t.title)) return false;
    // Reject different recordings dressed up as the same song. Any variant
    // marker the candidate has that the original didn't disqualifies it.
    const origMarkers = variantMarkers(t.title);
    for (const m of variantMarkers(c.title)) {
      if (!origMarkers.has(m)) return false;
    }
    return true;
  });

  // Prefer the most popular clean pressing — usually the official radio edit
  // rather than an obscure compilation appearance.
  candidates.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  const pick = candidates[0];

  if (pick) {
    swapped.push({ track: t, cleanId: String(pick.id), cleanTitle: pick.title });
    console.log(`  ✓ ${t.title} — ${t.artist}\n      -> clean id ${pick.id} ("${pick.title}")`);
  } else {
    notFound.push(t);
    console.log(`  ✗ ${t.title} — ${t.artist}  (no clean release found)`);
  }
}

console.log('\n=========================================');
console.log(`  Clean version found: ${swapped.length}`);
console.log(`  No clean version:    ${notFound.length}`);

if (APPLY) {
  const byId = new Map(swapped.map((s) => [String(s.track.deezerId), s.cleanId]));
  let changed = 0;
  pack.tracks = pack.tracks.map((t) => {
    const clean = byId.get(String(t.deezerId));
    if (!clean) return t;
    changed++;
    // Keep title/artist as-is: the trivia answer is the canonical song name.
    return { ...t, deezerId: clean };
  });
  pack.version = (pack.version ?? 1) + 1;
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
  console.log(`\n✓ Rewrote ${packPath} — ${changed} track IDs swapped to clean releases`);

  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  writeFileSync(
    join(__dirname, `still-explicit-${slug}.csv`),
    ['title,artist,deezerId']
      .concat(notFound.map((t) => [t.title, t.artist, t.deezerId].map(esc).join(',')))
      .join('\n') + '\n'
  );
  console.log(`✓ Wrote scripts/still-explicit-${slug}.csv (${notFound.length} rows)`);
} else {
  console.log('\n(dry run — pass --apply to rewrite the pack)');
}
