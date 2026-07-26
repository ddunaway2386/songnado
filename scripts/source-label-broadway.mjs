#!/usr/bin/env node
/**
 * Populate the `source` field on every Broadway track via Sonnet.
 * Same treatment Movies got, tailored to musicals.
 *
 * For each track without a source: prompt Sonnet with title + artist
 * (which often includes cast name like "Original Broadway Cast of
 * Hamilton" that gives it away). Sonnet returns the show name or
 * "unknown". We only write non-unknown sources so we don't erase
 * previously-set values.
 *
 * After running, the reveal screen shows "from Hamilton" etc., and
 * cap-broadway-per-show.mjs can group by source to trim the pack.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const JSON_PATH = join(PROJECT_ROOT, 'assets', 'curated-deezer', 'broadway.json');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = loadEnv();
const API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 25;

const SYSTEM_PROMPT = `You identify which Broadway musical (or musical-adjacent stage show / movie musical) a song is from.

For each input in the numbered list, reply with the show name — the actual musical/show title, not the song. If the song is from multiple productions, use the most famous. If you cannot identify the show with confidence, reply "unknown".

Reply with ONLY a JSON array, one string per input in order:
["Hamilton", "Wicked", "unknown", "Chicago"]

No prose, no markdown.`;

async function classifyBatch(entries) {
  const userPrompt = entries.map((e, i) => `${i + 1}. "${e.title}" — ${e.artist}`).join('\n');
  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
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
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

const pack = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
console.log(`Loaded ${pack.tracks.length} tracks from Broadway pack`);

// Only process tracks without a source (don't overwrite existing labels)
const needsSource = pack.tracks.filter((t) => !t.source || t.source === '' || t.source === 'unknown');
console.log(`  ${needsSource.length} tracks need source labels`);
console.log(`  ${pack.tracks.length - needsSource.length} already have sources — keeping as-is`);

let labeled = 0, unknown = 0;
for (let i = 0; i < needsSource.length; i += BATCH_SIZE) {
  const batch = needsSource.slice(i, i + BATCH_SIZE);
  process.stdout.write(`  Batch ${i + batch.length}/${needsSource.length}... `);
  try {
    const result = await classifyBatch(batch);
    for (let j = 0; j < batch.length; j++) {
      const show = (result[j] || '').trim();
      if (show && show !== 'unknown') {
        batch[j].source = show;
        labeled++;
      } else {
        unknown++;
      }
    }
    process.stdout.write('ok\n');
  } catch (e) {
    process.stdout.write('ERR ' + e.message.slice(0, 80) + '\n');
  }
  await new Promise((r) => setTimeout(r, 200));
}

writeFileSync(JSON_PATH, JSON.stringify(pack, null, 2) + '\n');

console.log('');
console.log('=========================================');
console.log(`  Labeled: ${labeled}`);
console.log(`  Unknown: ${unknown}`);
console.log(`  Total tracks with source now: ${pack.tracks.filter((t) => t.source).length} / ${pack.tracks.length}`);
console.log('=========================================');

// Show top shows by count
const bySource = new Map();
for (const t of pack.tracks) {
  const s = t.source || '(unknown)';
  bySource.set(s, (bySource.get(s) || 0) + 1);
}
const sorted = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
console.log('\nTop 20 shows by track count:');
for (const [show, count] of sorted.slice(0, 20)) {
  console.log(`  ${count.toString().padStart(3)}  ${show}`);
}
