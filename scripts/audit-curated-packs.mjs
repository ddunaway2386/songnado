#!/usr/bin/env node
/**
 * Quality audit across every curated-Deezer pack.
 *
 * Catches the failure modes that matter for a shipping product and that
 * listening through 2,900 tracks would NOT reliably catch:
 *
 *   1. DEAD PREVIEW  — Deezer no longer returns a preview URL for the track
 *      ID. At runtime this burns a retry and can stall a round. Invisible
 *      until it happens mid-party.
 *   2. EXPLICIT      — Deezer's explicit_lyrics flag. Songnado is pitched as
 *      a family party game; an explicit track landing in a round with kids
 *      present is a product problem, not a taste problem.
 *   3. JUNK VERSION  — karaoke / tribute / "made famous by" / cover-band
 *      pressings that slipped past the import filter.
 *   4. ODD CUT       — live / remix / instrumental / edit variants, which
 *      often make a song unrecognizable in a 30s window.
 *   5. DUPLICATE     — same title+artist twice in one pack (different
 *      recordings), which reads as a bug to players.
 *
 * Read-only. Writes a CSV of everything flagged; changes nothing.
 *
 * Usage: node scripts/audit-curated-packs.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');
const OUT_CSV = join(__dirname, 'audit-findings.csv');

const JUNK_RE = /karaoke|tribute|made famous|in the style of|cover band|backing track|instrumental version/i;
const ODD_CUT_RE = /\b(live|remix|instrumental|edit|rerecorded|re-recorded|demo|acoustic)\b/i;

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Deezer rate-limits around 50 requests / 5s and answers with a quota error
 * rather than an HTTP failure. The first run of this audit fired batches of
 * 12 with no delay and 80% of responses came back throttled, which silently
 * looked like "API errors" rather than "we went too fast." Batches are small
 * and paced now, and quota errors retry with backoff instead of counting as
 * findings.
 */
async function fetchTrack(id, attempt = 0) {
  try {
    const res = await fetch(`https://api.deezer.com/track/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const isQuota =
      json?.error &&
      /quota|limit/i.test(json.error.type ?? json.error.message ?? '');
    if (isQuota) throw new Error('rate limited');
    return json;
  } catch (e) {
    if (attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return fetchTrack(id, attempt + 1);
    }
    return { __error: String(e) };
  }
}

const packFiles = readdirSync(CURATED_DIR).filter((f) => f.endsWith('.json'));
const findings = [];
const summary = [];

for (const file of packFiles) {
  const pack = JSON.parse(readFileSync(join(CURATED_DIR, file), 'utf8'));
  const tracks = pack.tracks;
  let dead = 0;
  let explicit = 0;
  let junk = 0;
  let oddCut = 0;
  let dupes = 0;
  let apiErrors = 0;

  // Intra-pack duplicates (local check, no API needed)
  const seen = new Map();
  for (const t of tracks) {
    const key = `${norm(t.title)}|${norm(t.artist)}`;
    if (seen.has(key)) {
      dupes++;
      findings.push({
        pack: pack.name,
        issue: 'DUPLICATE',
        title: t.title,
        artist: t.artist,
        deezerId: t.deezerId,
        detail: `also present as "${seen.get(key)}"`,
      });
    } else {
      seen.set(key, t.title);
    }

    if (JUNK_RE.test(t.title) || JUNK_RE.test(t.artist)) {
      junk++;
      findings.push({
        pack: pack.name,
        issue: 'JUNK VERSION',
        title: t.title,
        artist: t.artist,
        deezerId: t.deezerId,
        detail: 'karaoke/tribute/cover keyword',
      });
    } else if (ODD_CUT_RE.test(t.title)) {
      oddCut++;
      findings.push({
        pack: pack.name,
        issue: 'ODD CUT',
        title: t.title,
        artist: t.artist,
        deezerId: t.deezerId,
        detail: 'live/remix/instrumental/edit variant',
      });
    }
  }

  // API checks, batched and paced under Deezer's ~50-per-5s ceiling.
  const BATCH = 8;
  for (let i = 0; i < tracks.length; i += BATCH) {
    if (i > 0) await sleep(1100);
    const batch = tracks.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((t) => fetchTrack(t.deezerId)));
    for (let j = 0; j < batch.length; j++) {
      const t = batch[j];
      const r = results[j];
      if (!r || r.__error || r.error) {
        apiErrors++;
        findings.push({
          pack: pack.name,
          issue: 'API ERROR',
          title: t.title,
          artist: t.artist,
          deezerId: t.deezerId,
          detail: r?.__error || JSON.stringify(r?.error ?? 'unknown'),
        });
        continue;
      }
      if (!r.preview) {
        dead++;
        findings.push({
          pack: pack.name,
          issue: 'DEAD PREVIEW',
          title: t.title,
          artist: t.artist,
          deezerId: t.deezerId,
          detail: 'Deezer returns no preview URL — round would stall',
        });
      }
      if (r.explicit_lyrics) {
        explicit++;
        findings.push({
          pack: pack.name,
          issue: 'EXPLICIT',
          title: t.title,
          artist: t.artist,
          deezerId: t.deezerId,
          detail: 'Deezer explicit_lyrics = true',
        });
      }
    }
    process.stdout.write(
      `  ${pack.name}: ${Math.min(i + BATCH, tracks.length)}/${tracks.length}\r`
    );
  }

  summary.push({ name: pack.name, total: tracks.length, dead, explicit, junk, oddCut, dupes, apiErrors });
  console.log(
    `\n${pack.name.padEnd(22)} ${String(tracks.length).padStart(4)} tracks | dead ${dead} | explicit ${explicit} | junk ${junk} | odd-cut ${oddCut} | dupes ${dupes}${apiErrors ? ` | api-err ${apiErrors}` : ''}`
  );
}

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
writeFileSync(
  OUT_CSV,
  ['pack,issue,title,artist,deezerId,detail']
    .concat(
      findings.map((f) =>
        [f.pack, f.issue, f.title, f.artist, f.deezerId, f.detail].map(esc).join(',')
      )
    )
    .join('\n') + '\n'
);

console.log('\n=========================================');
console.log('TOTALS');
const tot = (k) => summary.reduce((a, s) => a + s[k], 0);
console.log(`  Tracks audited:  ${tot('total')}`);
console.log(`  Dead previews:   ${tot('dead')}`);
console.log(`  Explicit:        ${tot('explicit')}`);
console.log(`  Junk versions:   ${tot('junk')}`);
console.log(`  Odd cuts:        ${tot('oddCut')}`);
console.log(`  Duplicates:      ${tot('dupes')}`);
console.log(`  API errors:      ${tot('apiErrors')}`);
console.log(`\nWrote ${OUT_CSV} (${findings.length} rows)`);
