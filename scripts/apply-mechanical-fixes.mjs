#!/usr/bin/env node
/**
 * Apply the audit's non-judgment-call fixes to the curated packs.
 *
 * Three categories, all mechanical — no taste required:
 *
 *   DUPLICATES  Same title+artist twice in one pack (different recordings).
 *               Reads as a bug to players. Keeps the FIRST occurrence unless
 *               the first is a variant cut and a plain one exists later, in
 *               which case the plain recording wins.
 *
 *   JUNK        Karaoke / tribute / cover-band pressings that slipped the
 *               import filter. Always removed.
 *
 *   BROKEN CUT  Live medleys, demos, acapellas, instrumentals, sped-up and
 *               meme edits — recordings that are unrecognizable in a 30s
 *               window. Removed.
 *
 *               NOT removed: remasters and single/radio edits. "Sweet Home
 *               Alabama (2008 Remaster)" is just the normal recording, and
 *               "(Single Version)" is usually the canonical one. Removing
 *               those would gut the 70s pack for no benefit.
 *
 * Usage:
 *   node scripts/apply-mechanical-fixes.mjs            (dry run)
 *   node scripts/apply-mechanical-fixes.mjs --apply
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');
const APPLY = process.argv.includes('--apply');

const JUNK_RE =
  /karaoke|tribute|made famous|in the style of|cover band|backing track/i;

/** Recordings that don't work as trivia in a 30-second window. */
const BROKEN_CUT_RE =
  /\b(live|instrumental|acapella|a cappella|medley|demo|rerecorded|re-recorded|sped ?up|slowed|reverb|8d|lo-?fi|metal version|christmas medley|stripped|bedroom sessions|but .* is silent)\b/i;

/**
 * Variants that are fine — the recording people know. Checked BEFORE
 * BROKEN_CUT_RE so "(2004 Remaster)" survives and "(Live)" doesn't.
 */
const SAFE_VARIANT_RE =
  /\b(remaster|remastered|single version|album version|radio edit|single edit|mono|stereo|original|from ["'])\b/i;

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

/** Does the title carry decoration suggesting a non-canonical cut? */
function isVariantTitle(title) {
  const decorations = (title.match(/\((.*?)\)|\[(.*?)\]/g) ?? []).join(' ');
  if (!decorations) return false;
  if (SAFE_VARIANT_RE.test(decorations)) return false;
  return BROKEN_CUT_RE.test(decorations);
}

/**
 * Only ever inspect the DECORATED parts of a title — never the bare song
 * name. "Live And Let Die", "How Do I Live", "Live Your Life" and "I Don't
 * Wanna Live Forever" are all songs whose names contain the word "live";
 * testing the raw title flagged every one of them as a live recording.
 *
 * The one shape that carries no parentheses is a medley, so that's matched
 * explicitly.
 */
function isBrokenCut(title) {
  if (/\bmedley\b\s*:|\bmedley:/i.test(title)) return true;
  const decorations = (title.match(/\((.*?)\)|\[(.*?)\]/g) ?? []).join(' ');
  if (!decorations) return false;
  if (SAFE_VARIANT_RE.test(decorations)) return false;
  return BROKEN_CUT_RE.test(decorations);
}

const report = [];
let totalRemoved = 0;

for (const file of readdirSync(CURATED_DIR).filter((f) => f.endsWith('.json'))) {
  const path = join(CURATED_DIR, file);
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  const before = pack.tracks.length;
  const removed = { dupes: [], junk: [], broken: [] };

  // Pass 1 — junk and broken cuts.
  let kept = pack.tracks.filter((t) => {
    if (JUNK_RE.test(t.title) || JUNK_RE.test(t.artist)) {
      removed.junk.push(t);
      return false;
    }
    if (isBrokenCut(t.title)) {
      removed.broken.push(t);
      return false;
    }
    return true;
  });

  // Pass 2 — duplicates. Prefer the non-variant recording when there's a
  // choice, otherwise keep the first.
  const byKey = new Map();
  for (const t of kept) {
    const key = `${norm(t.title)}|${norm(t.artist)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, t);
      continue;
    }
    const existingIsVariant = isVariantTitle(existing.title);
    const currentIsVariant = isVariantTitle(t.title);
    if (existingIsVariant && !currentIsVariant) {
      removed.dupes.push(existing);
      byKey.set(key, t);
    } else {
      removed.dupes.push(t);
    }
  }
  kept = kept.filter((t) => byKey.get(`${norm(t.title)}|${norm(t.artist)}`) === t);

  const cut = removed.dupes.length + removed.junk.length + removed.broken.length;
  totalRemoved += cut;
  report.push({ name: pack.name, before, after: kept.length, ...removed });

  if (APPLY && cut > 0) {
    pack.tracks = kept;
    pack.version = (pack.version ?? 1) + 1;
    writeFileSync(path, JSON.stringify(pack, null, 2) + '\n');
  }
}

for (const r of report) {
  const cut = r.dupes.length + r.junk.length + r.broken.length;
  console.log(
    `\n=== ${r.name} === ${r.before} -> ${r.after}  (${cut === 0 ? 'no change' : `-${cut}`})`
  );
  for (const [label, list] of [
    ['dupe', r.dupes],
    ['junk', r.junk],
    ['broken cut', r.broken],
  ]) {
    for (const t of list) console.log(`   -${label.padEnd(11)} ${t.title} — ${t.artist}`);
  }
}

console.log('\n=========================================');
console.log(`  Tracks removed: ${totalRemoved}`);
console.log(`  Packs:          ${report.length}`);
console.log(
  APPLY ? '\n✓ Packs rewritten' : '\n(dry run — pass --apply to rewrite the packs)'
);
