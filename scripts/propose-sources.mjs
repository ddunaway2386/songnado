#!/usr/bin/env node
/**
 * Propose source labels for the tracks extract-sources.mjs couldn't
 * auto-extract, by asking Claude Haiku to identify the movie / show /
 * musical / brand each song is associated with.
 *
 * The output CSV gets a `ProposedSource` column and a `Confidence` column;
 * the curator opens it in Sheets, validates each row, and edits anything
 * Claude got wrong. The final approved sources are merged into
 * assets/sources/all.json via apply-sources.mjs.
 *
 * Cost: ~1000 tracks × ~150 output tokens × Haiku 4.5 pricing ≈ $0.20
 * end-to-end. The pricing window is small enough that running this on a
 * full pack costs less than a coffee.
 *
 * Requires ANTHROPIC_API_KEY in .env.local (gitignored) or shell env.
 *
 * Usage:
 *   node scripts/propose-sources.mjs <sources-unmatched-csv>
 *
 * Example:
 *   node scripts/propose-sources.mjs scripts/sources-unmatched-movie-classics.csv
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/propose-sources.mjs <sources-unmatched-csv> [--strict]');
  process.exit(1);
}
const STRICT = process.argv.includes('--strict');

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
const API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local or environment.');
  process.exit(1);
}

// Default to Sonnet for accuracy. Haiku punted "unknown" on 74% of Movie
// Classics including obvious ones ("Pocahontas" album → "unknown"); not
// worth the ~$0.20 saved. Override with --model haiku for cost-sensitive runs.
const modelArg = process.argv.find((a) => a.startsWith('--model='));
const MODEL = modelArg
  ? (modelArg.split('=')[1] === 'haiku'
      ? 'claude-haiku-4-5-20251001'
      : modelArg.split('=')[1] === 'sonnet'
        ? 'claude-sonnet-4-6'
        : modelArg.split('=')[1])
  : 'claude-sonnet-4-6';
const BATCH_DELAY_MS = 80;

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

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const SYSTEM_PROMPT = `You identify the movie, TV show, musical, video game, or commercial brand a song is most associated with — the answer a music-trivia host would credit.

These tracks come from a Movies/TV/Broadway/Commercials pack. Default to identifying a source; "unknown" should be RARE, used only for pop hits with no real media tie.

Reply with a single JSON object:
{ "source": "<name>", "confidence": "high" | "medium" | "low" | "unknown" }

ALBUM is the strongest signal. Extract the proper noun from the album title — strip "(Soundtrack)", "(OST)", "(Original Motion Picture Soundtrack)", "(Music From the HBO Series)", "(Original Broadway Cast Recording)", "(Deluxe Edition)", year, "Vol. N", episode info:
  Album "Jaws (The Collector's Edition Soundtrack)" → "Jaws"
  Album "Pocahontas" → "Pocahontas"
  Album "Casino Royale - Original Motion Picture Soundtrack" → "Casino Royale"
  Album "The Lion King: Special Edition Original Soundtrack" → "The Lion King"
  Album "Hamilton: An American Musical" → "Hamilton"
  Album "Requiem for a Dream / OST" → "Requiem for a Dream"

TITLE patterns also work: "(From X)", "Theme from X", "X Main Title". Extract X.

SONG-MEDIA MEMORY: When the album is a generic compilation/best-of but the song has a famous single-media tie, use that media:
  "Eye of the Tiger" → "Rocky III"
  "I Will Always Love You" (Whitney) → "The Bodyguard"
  "Stayin' Alive" → "Saturday Night Fever"
  "My Heart Will Go On" → "Titanic"
  "Don't You (Forget About Me)" → "The Breakfast Club"
  "Footloose" → "Footloose"
  "Lose Yourself" → "8 Mile"
  "Take My Breath Away" → "Top Gun"
  "Goldfinger" → "Goldfinger"
  "When You Say Nothing At All" (Ronan Keating) → "Notting Hill"
  "Lust for Life" → "Trainspotting"
  "Streets of Philadelphia" → "Philadelphia"

For instrumental scores, use the work title (e.g. "Imperial March" → "Star Wars", "Throne Room" → "Star Wars").

For commercials, use the brand (e.g. "Like a Rock" → "Chevrolet").

The "source" value MUST be just the short canonical name — no parens, no qualifiers, no edition info. Strip franchise subtitles ("Pirates of the Caribbean: At World's End" → "Pirates of the Caribbean").

ONLY return "source": "" with confidence "unknown" if you genuinely don't recognize a media tie — e.g. an obscure pop song on the artist's own album with no famous film/TV placement. This should be rare.

Confidence:
- "high": album clearly names the source OR you're certain of a famous single-media tie.
- "medium": album is generic but song is widely recognized from one source.
- "low": uncertain but you're picking the most likely.
- "unknown": no media tie you can identify; "source" must be empty.

Reply with ONLY the JSON object. No prose, no markdown fences.`;

const SYSTEM_PROMPT_STRICT = `You answer one question per song: what movie, TV show, musical, or commercial brand is it MOST associated with — the answer a trivia host would credit?

These tracks are in a "Movie Classics" pack where every track is expected to tie to a movie or show. Your job is to find that tie. The pool of possible answers is large (any film, TV series, musical, or commercial campaign in history).

Reply with a single JSON object:
{ "source": "<name>", "confidence": "high" | "medium" | "low" | "no_tie" }

Rules:
- DEFAULT: propose your best guess. Reach into your knowledge — songs end up on "movie soundtrack" compilation playlists because they appeared in films, even if the album metadata doesn't show it.
- If the album title contains a movie/show/musical/brand name (with or without "Soundtrack"/"OST"/"Music From" suffix), use it. Strip qualifiers.
- For famous song-media ties, use them even when the album is generic:
    "Eye of the Tiger" → "Rocky III"
    "I Will Always Love You" (Whitney) → "The Bodyguard"
    "Stayin' Alive" → "Saturday Night Fever"
    "My Heart Will Go On" → "Titanic"
    "Don't You (Forget About Me)" → "The Breakfast Club"
    "Footloose" → "Footloose"
    "Take My Breath Away" → "Top Gun"
    "Goldfinger" → "Goldfinger"
    "Lust for Life" → "Trainspotting"
    "Streets of Philadelphia" → "Philadelphia"
    "Mrs. Robinson" → "The Graduate"
    "(I've Had) The Time of My Life" → "Dirty Dancing"
    "Wind Beneath My Wings" → "Beaches"
    "When You Say Nothing At All" (Ronan Keating) → "Notting Hill"

CONFIDENCE LEVELS:
- "high": album metadata clearly names the source, or you're certain of the song-media tie from memory.
- "medium": album is generic but song is widely recognized from one film/show.
- "low": multiple plausible sources or borderline tie — pick the most likely one for trivia.
- "no_tie": after considering everything, this song genuinely has NO famous movie/show/musical/brand association. Use this RARELY, only when you're confident no meaningful media tie exists. When you use "no_tie", set "source": "".

The "source" value MUST be just the short canonical name — no parens, no qualifiers, no edition info. Strip franchise subtitles ("Pirates of the Caribbean: At World's End" → "Pirates of the Caribbean").

Reply with ONLY the JSON object. No prose, no markdown fences.`;

async function callClaude(title, artist, album) {
  const userPrompt = `Title: ${title}\nArtist: ${artist}\nAlbum: ${album}`;
  const body = {
    model: MODEL,
    max_tokens: 200,
    system: STRICT ? SYSTEM_PROMPT_STRICT : SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text);
    return {
      source: typeof parsed.source === 'string' ? parsed.source.trim() : '',
      confidence: parsed.confidence || 'unknown',
    };
  } catch {
    return { source: '', confidence: 'unknown' };
  }
}

async function main() {
  console.log(`=== Propose Sources ===`);
  console.log(`Input: ${inputPath}`);
  console.log(`Model: ${MODEL}\n`);

  if (!existsSync(inputPath)) {
    console.error(`✗ File not found: ${inputPath}`);
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(inputPath, 'utf8'));
  console.log(`Tracks to propose sources for: ${rows.length}\n`);

  const out = [];
  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;
  let unknownCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let proposal = { source: '', confidence: 'unknown' };
    try {
      proposal = await callClaude(r.Title, r.Artist, r.Album);
    } catch (e) {
      console.error(`  ✗ [${i + 1}/${rows.length}] ${r.Title} — ${e.message.slice(0, 80)}`);
    }
    if (proposal.confidence === 'high') highCount++;
    else if (proposal.confidence === 'medium') medCount++;
    else if (proposal.confidence === 'low') lowCount++;
    else unknownCount++;
    out.push({ ...r, ProposedSource: proposal.source, Confidence: proposal.confidence });
    if ((i + 1) % 20 === 0 || i === rows.length - 1) {
      process.stdout.write(
        `  [${i + 1}/${rows.length}]  H:${highCount} M:${medCount} L:${lowCount} ?:${unknownCount}\n`
      );
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`  High confidence:    ${highCount}`);
  console.log(`  Medium confidence:  ${medCount}`);
  console.log(`  Low confidence:     ${lowCount}`);
  console.log(`  Unknown/no match:   ${unknownCount}`);

  const outName = basename(inputPath, '.csv').replace(/^sources-unmatched-/, 'proposed-sources-');
  const outPath = join(__dirname, `${outName}.csv`);
  const headers = ['DeezerId', 'Title', 'Artist', 'Album', 'Source', 'ProposedSource', 'Confidence'];
  let csv = headers.join(',') + '\n';
  for (const r of out) {
    csv += headers.map((h) => csvField(r[h] ?? '')).join(',') + '\n';
  }
  writeFileSync(outPath, csv);
  console.log(`\n✓ Wrote ${outPath}`);
  console.log('\n=== NEXT STEPS ===');
  console.log('1. Open the CSV in Sheets');
  console.log('2. Review the ProposedSource column — for each row:');
  console.log('   - Correct? copy it to the empty Source column');
  console.log('   - Wrong?   type the right answer in Source');
  console.log('   - Pure pop song no media tie? leave Source empty');
  console.log('3. Save the CSV');
  console.log('4. Run: node scripts/apply-sources.mjs <edited-csv>');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
