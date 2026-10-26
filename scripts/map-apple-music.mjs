#!/usr/bin/env node
/**
 * Map every song in the catalogue to an Apple Music catalog ID.
 *
 * Part of the MusicKit move (Oct 2026): v1.0 plays the host's own Apple Music
 * instead of Deezer previews, so every pack needs Apple song IDs. Input is
 * scripts/all-songs.csv (regenerate with export-all-songs.mjs); output is
 *
 *   scripts/apple-music-map.json     one entry per unique artist|title
 *   scripts/apple-music-review.csv   everything that isn't a confident match
 *
 * Matching is by Apple Music catalog search (title + artist, then fallbacks),
 * scored strictly: the spike's loose matcher counted "Blinding Lights (Live)"
 * as a hit, which in a trivia game is a wrong answer. Candidates carrying a
 * version tag ours doesn't (live, remix, karaoke, acoustic, sped up…) are
 * penalised hard, and covers lose on artist.
 *
 * Auth is an Apple Music developer token signed locally from the MusicKit key
 * (.p8). The key never enters the repo: it's read from outside it, by default
 * the first AuthKey_*.p8 in C:/Projects/Songster/secrets, and the key ID is
 * taken from the file name.
 *
 * Search responses are cached in scripts/.apple-cache.json (gitignored), so a
 * re-run after tuning the scorer costs no API calls.
 *
 * Usage:
 *   node scripts/map-apple-music.mjs                    # whole catalogue
 *   node scripts/map-apple-music.mjs --pack Broadway --limit 40
 *   node scripts/map-apple-music.mjs --key path/to/AuthKey_ABC.p8
 */
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAM_ID = 'FZWV79545H';
const STOREFRONT = 'us';
const DEFAULT_SECRETS_DIR = 'C:/Projects/Songster/secrets';
const CSV_IN = join(__dirname, 'all-songs.csv');
const MAP_OUT = join(__dirname, 'apple-music-map.json');
const REVIEW_OUT = join(__dirname, 'apple-music-review.csv');
const CACHE = join(__dirname, '.apple-cache.json');
const CONCURRENCY = 4;

/** Score at or above which a match is trusted without review. */
const OK_SCORE = 8;
/** Below this the best candidate is treated as not found. */
const REVIEW_SCORE = 4;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyPack = arg('pack');
const limit = arg('limit') ? Number(arg('limit')) : Infinity;

// ---------------------------------------------------------------------------
// Developer token
// ---------------------------------------------------------------------------

function findKeyFile() {
  const explicit = arg('key');
  if (explicit) return explicit;
  if (!existsSync(DEFAULT_SECRETS_DIR)) return null;
  const f = readdirSync(DEFAULT_SECRETS_DIR).find((n) => /^AuthKey_[A-Z0-9]+\.p8$/.test(n));
  return f ? join(DEFAULT_SECRETS_DIR, f) : null;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function developerToken(keyFile) {
  const kid = /AuthKey_([A-Z0-9]+)\.p8$/.exec(keyFile)?.[1] ?? arg('key-id');
  if (!kid) throw new Error(`Can't read the key ID from ${keyFile}; pass --key-id`);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid }));
  const payload = b64url(JSON.stringify({ iss: TEAM_ID, iat: now, exp: now + 12 * 3600 }));
  const key = createPrivateKey(readFileSync(keyFile));
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return { token: `${header}.${payload}.${b64url(sig)}`, kid };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsvLine(l) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) {
      if (ch === '"' && l[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------
// Normalisation and scoring
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title without parentheticals, " - …" suffixes or featured artists. */
function coreTitle(t) {
  return norm(
    String(t)
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\s[-–—]\s.*$/, ' ')
      .replace(/\b(feat|ft|featuring)\b\.?.*$/i, ' ')
  );
}

function artistNames(a) {
  return String(a)
    .split(/,|&|\band\b|\bfeat\.?|\bft\.?|\bx\b|\bwith\b|\//i)
    .map((s) => norm(s.replace(/\(.*?\)/g, ' ')))
    .filter((s) => s.length > 1);
}

const VERSION_TAGS = [
  'live', 'remix', 'acoustic', 'karaoke', 'instrumental', 'demo', 'cover', 'tribute',
  'sped up', 'slowed', 'reprise', 'a cappella', 'acapella', 'unplugged', 'lullaby',
  '8 bit', 'extended', 'made famous', 'originally performed', 'in the style of', 'piano version',
];

function tags(s) {
  const n = ` ${norm(s)} `;
  return new Set(VERSION_TAGS.filter((t) => n.includes(` ${t} `)));
}

function score(ours, cand) {
  const a = cand.attributes ?? {};
  const t = coreTitle(ours.title);
  const ct = coreTitle(a.name);
  let s = 0;
  if (t === ct) s += 4;
  else if (t.length >= 4 && ct.length >= 4 && (ct.includes(t) || t.includes(ct))) s += 2;
  else return -99;

  // Whole-word containment: plain substring matching let "Kiss" match
  // "Kissing the Pink".
  const ourArtists = artistNames(ours.artist);
  const candArtist = norm(a.artistName);
  const ourArtist = norm(ours.artist);
  if (ourArtists[0] && hasWords(candArtist, ourArtists[0])) s += 4;
  else if (ourArtists.some((x) => hasWords(candArtist, x))) s += 3;
  else if (artistNames(a.artistName).some((x) => hasWords(ourArtist, x))) s += 3;
  else s -= 3;

  const ourTags = tags(`${ours.title}`);
  for (const tag of tags(`${a.name} ${a.albumName}`)) if (!ourTags.has(tag)) s -= 4;

  // Generic titles ("Main Title Theme") collide across shows and films: the
  // first sample matched our Simpsons theme to Elfman's Beetlejuice theme.
  // When Apple's title names a work (From "X"), it has to be ours.
  const ourWork = ours.source || quotedWork(ours.title);
  const candWork = quotedWork(a.name);
  if (ourWork && candWork && !sharesWords(ourWork, candWork)) s -= 6;
  else if (ourWork && norm(`${a.name} ${a.albumName}`).includes(norm(ourWork))) s += 2;

  if (!a.playParams) s -= 10; // not playable in this storefront
  return s;
}

/** True if `needle` appears in `hay` as whole words (both already normalised). */
function hasWords(hay, needle) {
  return needle.length > 0 && ` ${hay} `.includes(` ${needle} `);
}

/** The quoted work in titles like `Main Title Theme (From "The Simpsons")`. */
function quotedWork(title) {
  return /\bfrom\s+["“]([^"”]+)["”]/i.exec(String(title ?? ''))?.[1] ?? '';
}

function sharesWords(x, y) {
  const stop = new Set(['the', 'and', 'of', 'a', 'an', 'original', 'soundtrack', 'series', 'tv', 'theme', 'music']);
  const wx = new Set(norm(x).split(' ').filter((w) => w.length > 1 && !stop.has(w)));
  return norm(y)
    .split(' ')
    .some((w) => wx.has(w));
}

// ---------------------------------------------------------------------------
// Apple Music API
// ---------------------------------------------------------------------------

let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let cacheDirty = 0;
let token = null;
let apiCalls = 0;

async function search(term, lim = 10) {
  const url = `https://api.music.apple.com/v1/catalog/${STOREFRONT}/search?types=songs&limit=${lim}&term=${encodeURIComponent(term)}`;
  if (cache[url]) return cache[url];
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    apiCalls++;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Apple Music API refused the token (${res.status}). Is MusicKit enabled on the key's Media ID?`);
    }
    if (!res.ok) throw new Error(`search ${res.status} for "${term}"`);
    const json = await res.json();
    const songs = json?.results?.songs?.data ?? [];
    cache[url] = songs;
    if (++cacheDirty >= 50) flushCache();
    return songs;
  }
  throw new Error(`gave up on "${term}" after repeated 429/5xx`);
}

function flushCache() {
  writeFileSync(CACHE, JSON.stringify(cache));
  cacheDirty = 0;
}

async function mapOne(song) {
  const title = String(song.title).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
  const artist = artistNames(song.artist)[0] ?? song.artist;
  const queries = [`${title} ${artist}`];
  if (song.source) queries.push(`${title} ${song.source}`);
  queries.push(title);

  const seen = new Map();
  let best = null;
  for (const [i, q] of queries.entries()) {
    for (const c of await search(q, i === queries.length - 1 ? 25 : 10)) {
      if (seen.has(c.id)) continue;
      const s = score(song, c);
      seen.set(c.id, { c, s });
      if (!best || s > best.s) best = { c, s };
    }
    if (best && best.s >= OK_SCORE) break;
  }

  const status = !best || best.s < REVIEW_SCORE ? 'missing' : best.s >= OK_SCORE ? 'ok' : 'review';
  const a = best?.c.attributes ?? {};

  // An explicit best match often has a clean twin; record it so explicit songs
  // we hide today could come back as their clean versions.
  let clean = null;
  if (a.contentRating === 'explicit') {
    for (const { c, s } of seen.values()) {
      if (c.attributes?.contentRating === 'clean' && s >= best.s - 1) {
        clean = {
          id: c.id,
          durationMs: c.attributes.durationInMillis ?? null,
          artworkUrl: artwork(c.attributes),
        };
        break;
      }
    }
  }

  return {
    status,
    score: best?.s ?? null,
    appleId: status === 'missing' ? null : best.c.id,
    candidateId: best?.c.id ?? null,
    appleTitle: a.name ?? null,
    appleArtist: a.artistName ?? null,
    album: a.albumName ?? null,
    contentRating: a.contentRating ?? null,
    cleanId: clean?.id ?? null,
    clean,
    isrc: a.isrc ?? null,
    durationMs: a.durationInMillis ?? null,
    artworkUrl: artwork(a),
  };
}

/** Apple artwork URLs are templates ({w}x{h}); size them for the reveal card. */
function artwork(attrs) {
  const url = attrs?.artwork?.url;
  return url ? url.replace('{w}', '600').replace('{h}', '600') : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const keyFile = findKeyFile();
  if (!keyFile) {
    console.error(`No MusicKit key found. Put AuthKey_<KEYID>.p8 in ${DEFAULT_SECRETS_DIR} or pass --key.`);
    process.exit(1);
  }
  const dev = developerToken(keyFile);
  token = dev.token;
  console.log(`Using key ${dev.kid} (team ${TEAM_ID}), storefront ${STOREFRONT}`);

  const lines = readFileSync(CSV_IN, 'utf8').trim().split(/\r?\n/);
  const hdr = parseCsvLine(lines[0]);
  const col = (n) => hdr.indexOf(n);
  const rows = lines.slice(1).map((l) => {
    const r = parseCsvLine(l);
    return {
      pack: r[col('pack')],
      artist: r[col('artist')],
      title: r[col('title')],
      source: r[col('from_movie_show')],
      explicit: r[col('explicit')],
      plays: r[col('plays_in_game')],
    };
  });

  const unique = new Map();
  for (const r of rows) {
    if (onlyPack && r.pack !== onlyPack) continue;
    const k = `${r.artist}|${r.title}`;
    const u = unique.get(k) ?? { ...r, packs: new Set() };
    u.packs.add(r.pack);
    if (!u.source && r.source) u.source = r.source;
    unique.set(k, u);
  }
  const todo = [...unique.entries()].slice(0, limit);
  console.log(`${rows.length} rows → ${unique.size} unique songs; mapping ${todo.length}`);

  const existing = existsSync(MAP_OUT) ? JSON.parse(readFileSync(MAP_OUT, 'utf8')).entries ?? {} : {};
  const results = { ...existing };
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const [k, song] = todo[next++];
      try {
        results[k] = { ...(await mapOne(song)), packs: [...song.packs] };
      } catch (e) {
        if (String(e.message).includes('refused the token')) throw e;
        results[k] = { status: 'error', error: e.message, packs: [...song.packs] };
      }
      if (++done % 100 === 0) console.log(`  ${done}/${todo.length} (${apiCalls} API calls)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  flushCache();

  writeFileSync(
    MAP_OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), storefront: STOREFRONT, entries: results }, null, 1)
  );

  // Per-pack summary over this run's songs.
  const perPack = {};
  for (const [k, song] of todo) {
    const r = results[k];
    for (const p of song.packs) {
      const s = (perPack[p] ??= { ok: 0, review: 0, missing: 0, error: 0, explicitWithClean: 0 });
      s[r.status]++;
      if (r.cleanId) s.explicitWithClean++;
    }
  }
  console.log('\npack                    ok  review  missing  error  (explicit w/ clean twin)');
  for (const [p, s] of Object.entries(perPack)) {
    const total = s.ok + s.review + s.missing + s.error;
    console.log(
      `${p.padEnd(22)} ${String(s.ok).padStart(4)} ${String(s.review).padStart(7)} ${String(s.missing).padStart(8)} ${String(s.error).padStart(6)}   ${s.explicitWithClean}   (${Math.round((100 * s.ok) / total)}% ok)`
    );
  }

  const review = Object.entries(results).filter(([, r]) => r.status !== 'ok');
  const out = [
    'status,score,packs,artist,title,source,apple_title,apple_artist,apple_album,content_rating,apple_link',
    ...review.map(([k, r]) => {
      const [artist, ...t] = k.split('|');
      const u = unique.get(k);
      return [
        r.status,
        r.score,
        (r.packs ?? []).join(' / '),
        artist,
        t.join('|'),
        u?.source ?? '',
        r.appleTitle,
        r.appleArtist,
        r.album,
        r.contentRating,
        r.candidateId ? `https://music.apple.com/${STOREFRONT}/song/${r.candidateId}` : '',
      ]
        .map(csvCell)
        .join(',');
    }),
  ];
  writeFileSync(REVIEW_OUT, out.join('\n') + '\n');
  console.log(`\n${review.length} songs need a look → ${REVIEW_OUT}`);
  console.log(`${apiCalls} API calls this run`);
}

main().catch((e) => {
  flushCache();
  console.error(e.message);
  process.exit(1);
});
