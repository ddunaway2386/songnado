#!/usr/bin/env node
/**
 * Merge two sources of source-annotations into a curated-Deezer JSON:
 *   1. Sonnet's HIGH-confidence proposals (from propose-sources output)
 *   2. ChatGPT's corrections to medium/low/no_tie/unknown rows
 *
 * Sonnet HIGH rows are trusted as-is (curator skipped review per instruction).
 * ChatGPT corrections override for everything else — the corrected_association
 * column is the final value; corrected_status='no_tie' means leave blank.
 *
 * Usage:
 *   node scripts/merge-chatgpt-corrections.mjs <sonnet-csv> <chatgpt-csv> <curated-deezer-json>
 *
 * Example:
 *   node scripts/merge-chatgpt-corrections.mjs scripts/proposed-sources-modern-movies.csv \
 *     "$env:USERPROFILE\Downloads\corrected_song_movie_associations.csv" \
 *     assets/curated-deezer/modern-movies.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [, , sonnetCsv, chatgptCsv, jsonPath] = process.argv;
if (!sonnetCsv || !chatgptCsv || !jsonPath) {
  console.error('Usage: node scripts/merge-chatgpt-corrections.mjs <sonnet-csv> <chatgpt-csv> <json>');
  process.exit(1);
}
for (const p of [sonnetCsv, chatgptCsv, jsonPath]) {
  if (!existsSync(p)) {
    console.error(`✗ Not found: ${p}`);
    process.exit(1);
  }
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

const sonnet = parseCsv(readFileSync(sonnetCsv, 'utf8'));
const chatgpt = parseCsv(readFileSync(chatgptCsv, 'utf8'));
const json = JSON.parse(readFileSync(jsonPath, 'utf8'));

// Build source map: HIGH from Sonnet, then ChatGPT corrections override.
const sourceByTrackId = {};

let sonnetHigh = 0;
for (const r of sonnet) {
  const id = String(r.DeezerId || '').trim();
  const confidence = String(r.Confidence || '').trim().toLowerCase();
  const proposed = String(r.ProposedSource || '').trim();
  if (id && confidence === 'high' && proposed) {
    sourceByTrackId[id] = proposed;
    sonnetHigh++;
  }
}

let chatgptApplied = 0;
let chatgptCleared = 0;
let chatgptKeptCheck = 0;
for (const r of chatgpt) {
  const id = String(r.track_id || '').trim();
  if (!id) continue;
  const status = String(r.corrected_status || '').trim().toLowerCase();
  const association = String(r.corrected_association || '').trim();
  if (status === 'no_tie' || status === 'unknown') {
    delete sourceByTrackId[id];
    chatgptCleared++;
  } else if (status === 'needs_check') {
    delete sourceByTrackId[id];
    chatgptKeptCheck++;
  } else if (association) {
    sourceByTrackId[id] = association;
    chatgptApplied++;
  }
}

let updated = 0;
let alreadyHad = 0;
for (const t of json.tracks) {
  const newSrc = sourceByTrackId[String(t.deezerId)];
  if (!newSrc) continue;
  if (t.source && t.source === newSrc) {
    alreadyHad++;
  } else {
    t.source = newSrc;
    updated++;
  }
}

writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n');

const totalWithSource = json.tracks.filter((t) => t.source).length;
console.log('=== Merge Sonnet HIGH + ChatGPT corrections ===');
console.log(`  Sonnet HIGH applied:           ${sonnetHigh}`);
console.log(`  ChatGPT corrections applied:   ${chatgptApplied}`);
console.log(`  ChatGPT cleared (no_tie):      ${chatgptCleared}`);
console.log(`  ChatGPT left blank (needs_check):${chatgptKeptCheck}`);
console.log(`  Tracks newly sourced in JSON:  ${updated}`);
console.log(`  Tracks already at right value: ${alreadyHad}`);
console.log('');
console.log(`  Final coverage: ${totalWithSource}/${json.tracks.length} (${Math.round(totalWithSource / json.tracks.length * 100)}%)`);
