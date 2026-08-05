#!/usr/bin/env node
/**
 * Sort the audit's EXPLICIT findings into three review tiers.
 *
 * Deezer's explicit_lyrics flag is binary and noisy in both directions: it
 * catches "Totally Fucked" and "You're Beautiful" with equal confidence.
 * Listening to all 174 distinct flagged songs is ~90 minutes of work that
 * decays (Deezer re-picks preview windows), so the goal here is to shrink
 * the pile that actually needs human ears.
 *
 *   HARD  — the profanity is in the title, or the artist/track is famously
 *           built around it. Filter without listening.
 *   SOFT  — flagged, but plausibly incidental: a single word buried in a
 *           verse. Worth a 30s listen; if the preview is clean it can stay.
 *   LIKELY-CLEAN — flagged, but from artists/genres where the flag is
 *           usually a stray album-level marker (show tunes, soft rock,
 *           older catalogue). Lowest priority to review.
 *
 * Dedupes across packs — the same song in Road Trip and 2020's is one
 * decision, not two.
 *
 * Read-only. Writes scripts/explicit-review.csv sorted HARD -> SOFT ->
 * LIKELY-CLEAN, plus a per-tier count so the size of the job is obvious.
 *
 * Usage: node scripts/tier-explicit.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_CSV = join(__dirname, 'audit-findings.csv');
const OUT_CSV = join(__dirname, 'explicit-review.csv');

/** Profanity visible in the title — no listening required to rule these out. */
const TITLE_PROFANITY =
  /\b(fuck|fucked|fuckin|shit|bitch|nigga|niggas|pussy|whore|cunt|dick|cock|ass\b|asshole|damn\b|hell\b|hoe|slut|thot|wap)\b/i;

/**
 * Songs whose explicit content IS the hook — filtering these is not a
 * judgment call even though the title is clean. Kept deliberately short and
 * specific rather than trying to encode a whole taste model.
 */
const HOOK_IS_EXPLICIT = [
  /^wap$/i,
  /^not like us$/i,
  /^kill bill$/i,
  /^the box$/i,
  /^savage/i,
  /^whats poppin/i,
  /^super freaky girl$/i,
  /^princess diana$/i,
  /^rich baby daddy$/i,
  /^squabble up$/i,
  /^no broke boys$/i,
  /^lovin on me$/i,
  /^gnarly$/i,
  /^anxiety$/i,
  /^nokia$/i,
];

/**
 * Contexts where Deezer's flag is usually an album-level artifact rather
 * than a lyric a family would notice in a 30s hook.
 */
const LIKELY_CLEAN_ARTIST =
  /^(james blunt|green day|outkast|ne-yo|the who|bob dylan|pink floyd|maroon 5|fun\.|mgmt|beck|chvrches|adam lambert|tom odell|noah kahan|zach bryan|the vaccines|tame impala|gorillaz|calvin harris|magic man|cautious clay|king princess|steve lacy|amber mark|quinnie|lin-manuel miranda|joel hatch|anna kendrick|andrew rannells)$/i;

const BROADWAY_PACKS = /broadway/i;

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

function tierFor(title, artist, packs) {
  const bareTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  if (TITLE_PROFANITY.test(title)) return 'HARD';
  if (HOOK_IS_EXPLICIT.some((re) => re.test(bareTitle))) return 'HARD';
  // Broadway cast recordings flagged explicit are usually one line in a
  // show tune — but the shows that get flagged (Spring Awakening, Hamilton,
  // Book of Mormon) do earn it, so they go to SOFT rather than LIKELY-CLEAN.
  if (packs.some((p) => BROADWAY_PACKS.test(p))) return 'SOFT';
  if (LIKELY_CLEAN_ARTIST.test(artist.trim())) return 'LIKELY-CLEAN';
  return 'SOFT';
}

const rows = readFileSync(AUDIT_CSV, 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map(parseCsvLine)
  .filter((r) => r[1] === 'EXPLICIT');

// Dedupe by song, collecting every pack it appears in.
const bySong = new Map();
for (const r of rows) {
  const [pack, , title, artist, deezerId] = r;
  const key = `${norm(title)}|${norm(artist)}`;
  if (!bySong.has(key)) {
    bySong.set(key, { title, artist, packs: [], ids: new Set() });
  }
  const entry = bySong.get(key);
  if (!entry.packs.includes(pack)) entry.packs.push(pack);
  entry.ids.add(deezerId);
}

const tiered = [...bySong.values()].map((s) => ({
  ...s,
  tier: tierFor(s.title, s.artist, s.packs),
}));

// Popularity pass. A flat "listen to 124 songs" list wastes attention on
// tracks nobody would miss. Deezer's `rank` lets us split the judgment calls
// into the hits whose absence would be felt (worth 30 seconds of a human's
// time) and the long tail (cut by default; redeem later if anyone notices).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const soft = tiered.filter((s) => s.tier === 'SOFT');
console.log(`Fetching popularity for ${soft.length} SOFT songs...`);
for (let i = 0; i < soft.length; i += 8) {
  if (i > 0) await sleep(1100);
  const batch = soft.slice(i, i + 8);
  await Promise.all(
    batch.map(async (s) => {
      const id = [...s.ids][0];
      try {
        const r = await fetch(`https://api.deezer.com/track/${id}`).then((x) => x.json());
        s.rank = typeof r?.rank === 'number' ? r.rank : 0;
      } catch {
        s.rank = 0;
      }
    })
  );
  process.stdout.write(`  ${Math.min(i + 8, soft.length)}/${soft.length}\r`);
}
console.log('');

// Top 40 by popularity get the human listen; the rest default to cut.
const PRIORITY_N = 40;
soft.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
soft.forEach((s, i) => {
  s.tier = i < PRIORITY_N ? 'SOFT-LISTEN' : 'SOFT-TAIL';
});

const ORDER = {
  HARD: 0,
  'SOFT-LISTEN': 1,
  'SOFT-TAIL': 2,
  'LIKELY-CLEAN': 3,
};
tiered.sort(
  (a, b) => ORDER[a.tier] - ORDER[b.tier] || a.artist.localeCompare(b.artist)
);

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
writeFileSync(
  OUT_CSV,
  ['tier,title,artist,packs,deezer_ids,verdict_keep_or_cut']
    .concat(
      tiered.map((s) =>
        [
          s.tier,
          s.title,
          s.artist,
          s.packs.join(' + '),
          [...s.ids].join(' '),
          '',
        ]
          .map(esc)
          .join(',')
      )
    )
    .join('\n') + '\n'
);

const count = (t) => tiered.filter((s) => s.tier === t).length;
console.log('=========================================');
console.log(`  Distinct flagged songs: ${tiered.length}  (${rows.length} flags across packs)`);
console.log('');
console.log(`  HARD          ${String(count('HARD')).padStart(3)}  cut without listening`);
console.log(`  SOFT-LISTEN   ${String(count('SOFT-LISTEN')).padStart(3)}  popular — worth a 30s listen`);
console.log(`  SOFT-TAIL     ${String(count('SOFT-TAIL')).padStart(3)}  long tail — cut by default`);
console.log(`  LIKELY-CLEAN  ${String(count('LIKELY-CLEAN')).padStart(3)}  flag likely incidental`);
console.log('');
console.log(
  `  Listening job: ${count('SOFT-LISTEN')} songs ≈ ${Math.round(
    (count('SOFT-LISTEN') * 30) / 60
  )} min`
);
console.log('=========================================\n');

for (const t of ['HARD', 'SOFT-LISTEN', 'SOFT-TAIL', 'LIKELY-CLEAN']) {
  console.log(`--- ${t} ---`);
  for (const s of tiered.filter((x) => x.tier === t)) {
    console.log(`  ${s.title} — ${s.artist}   [${s.packs.join(' + ')}]`);
  }
  console.log('');
}
console.log(`Wrote ${OUT_CSV}`);
