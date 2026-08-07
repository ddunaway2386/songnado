#!/usr/bin/env node
/**
 * Mark explicit tracks in the curated packs with `explicit: true`.
 *
 * Deliberately does NOT delete them. The loader filters flagged tracks out
 * at load time (see lib/curated/deezer-loader.ts), so shipping behaviour is
 * identical to deletion — but the curation work survives, and turning them
 * back on later is a one-line flag flip rather than re-sourcing 100+ songs.
 *
 * Source of truth is the EXPLICIT rows in scripts/audit-findings.csv,
 * produced by audit-curated-packs.mjs against Deezer's explicit_lyrics.
 *
 * Usage:
 *   node scripts/flag-explicit.mjs            (dry run)
 *   node scripts/flag-explicit.mjs --apply
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');
const AUDIT_CSV = join(__dirname, 'audit-findings.csv');
const APPLY = process.argv.includes('--apply');

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

const explicitIds = new Set(
  readFileSync(AUDIT_CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((r) => r[1] === 'EXPLICIT')
    .map((r) => String(r[4]))
);

console.log(`${explicitIds.size} explicit track IDs from the audit\n`);

let totalFlagged = 0;
let totalPlayable = 0;

for (const file of readdirSync(CURATED_DIR).filter((f) => f.endsWith('.json'))) {
  const path = join(CURATED_DIR, file);
  const pack = JSON.parse(readFileSync(path, 'utf8'));

  let flagged = 0;
  pack.tracks = pack.tracks.map((t) => {
    if (explicitIds.has(String(t.deezerId))) {
      flagged++;
      return { ...t, explicit: true };
    }
    // Drop any stale flag so re-runs stay idempotent.
    if (t.explicit) {
      const { explicit: _drop, ...rest } = t;
      return rest;
    }
    return t;
  });

  const playable = pack.tracks.length - flagged;
  totalFlagged += flagged;
  totalPlayable += playable;

  console.log(
    `${pack.name.padEnd(22)} ${String(pack.tracks.length).padStart(4)} total` +
      ` → ${String(playable).padStart(4)} playable (${flagged} hidden)`
  );

  if (APPLY) {
    pack.version = (pack.version ?? 1) + 1;
    writeFileSync(path, JSON.stringify(pack, null, 2) + '\n');
  }
}

console.log('\n=========================================');
console.log(`  Flagged (kept, hidden): ${totalFlagged}`);
console.log(`  Playable:               ${totalPlayable}`);
console.log(
  APPLY ? '\n✓ Packs rewritten' : '\n(dry run — pass --apply to rewrite)'
);
