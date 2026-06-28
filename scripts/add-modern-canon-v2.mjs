#!/usr/bin/env node
/**
 * Add ChatGPT's second-batch canonical Modern Movies song-movie ties
 * directly to assets/curated-deezer/modern-movies.json. No Deezer UI
 * clicks needed — the JSON is the source of truth for the pack now.
 *
 * Dedupes against existing entries by Deezer ID and by normalized
 * title+artist. Logs anything Deezer search can't find for manual review.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'assets', 'curated-deezer', 'modern-movies.json');

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const REJECT = /karaoke|tribute|made\s*famous|in the style|cover\b|instrumental version|background music/i;

const list = [
  ['Everything Is Awesome', 'Tegan and Sara', 'The Lego Movie'],
  ['Glory', 'Common', 'Selma'],
  ['Lost Stars', 'Adam Levine', 'Begin Again'],
  ['I Ain\'t Worried', 'OneRepublic', 'Top Gun: Maverick'],
  ['Naatu Naatu', 'Rahul Sipligunj', 'RRR'],
  ['Husavik', 'Molly Sandén', 'Eurovision Song Contest: The Story of Fire Saga'],
  ['Speechless', 'Naomi Scott', 'Aladdin'],
  ['Mystery of Love', 'Sufjan Stevens', 'Call Me by Your Name'],
  ['Stand Up', 'Cynthia Erivo', 'Harriet'],
  ['Fight For You', 'H.E.R.', 'Judas and the Black Messiah'],
  ['Be Alive', 'Beyoncé', 'King Richard'],
  ['Heathens', 'Twenty One Pilots', 'Suicide Squad'],
  ['Yellow Flicker Beat', 'Lorde', 'The Hunger Games: Mockingjay – Part 1'],
  ['Boom Clap', 'Charli XCX', 'The Fault in Our Stars'],
  ['All of the Stars', 'Ed Sheeran', 'The Fault in Our Stars'],
  ['Atlas', 'Coldplay', 'The Hunger Games: Catching Fire'],
  ['Elastic Heart', 'Sia', 'The Hunger Games: Catching Fire'],
  ['I Don\'t Wanna Live Forever', 'ZAYN', 'Fifty Shades Darker'],
  ['A Little Party Never Killed Nobody', 'Fergie', 'The Great Gatsby'],
  ['No Church in the Wild', 'Jay-Z', 'The Great Gatsby'],
  ['Swan Song', 'Dua Lipa', 'Alita: Battle Angel'],
  ['Spirit', 'Beyoncé', 'The Lion King'],
  ['Evermore', 'Dan Stevens', 'Beauty and the Beast'],
  ['The Place Where Lost Things Go', 'Emily Blunt', 'Mary Poppins Returns'],
  ['The Family Madrigal', 'Stephanie Beatriz', 'Encanto'],
  ['What Else Can I Do?', 'Diane Guerrero', 'Encanto'],
  ['Colombia, Mi Encanto', 'Carlos Vives', 'Encanto'],
  ['True Colors', 'Justin Timberlake', 'Trolls'],
  ['Better Place', '*NSYNC', 'Trolls Band Together'],
  ['A Sky Full of Stars', 'Taron Egerton', 'Sing 2'],
  ['Could Have Been Me', 'Halsey', 'Sing 2'],
  ['Scared of the Dark', 'Lil Wayne', 'Spider-Man: Into the Spider-Verse'],
  ['Am I Dreaming', 'Metro Boomin', 'Spider-Man: Across the Spider-Verse'],
  ['Mona Lisa', 'Dominic Fike', 'Spider-Man: Across the Spider-Verse'],
  ['Annihilate', 'Metro Boomin', 'Spider-Man: Across the Spider-Verse'],
  ['King\'s Dead', 'Jay Rock', 'Black Panther'],
  ['Born Again', 'Rihanna', 'Black Panther: Wakanda Forever'],
  ['The Fire Inside', 'Becky G', 'Flamin\' Hot'],
  ['Wahzhazhe', 'Osage Tribal Singers', 'Killers of the Flower Moon'],
  ['This Wish', 'Ariana DeBose', 'Wish'],
  ['Peaches', 'Jack Black', 'The Super Mario Bros. Movie'],
  ['Speed Drive', 'Charli XCX', 'Barbie'],
  ['Barbie World', 'Nicki Minaj', 'Barbie'],
  ['Golden', 'HUNTR/X', 'KPop Demon Hunters'],
  ['How It\'s Done', 'HUNTR/X', 'KPop Demon Hunters'],
];

async function searchOne(title, artist) {
  // Strict: track+artist
  let q = `track:"${title}" artist:"${artist}"`;
  let res = await fetch('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=10');
  let data = await res.json();
  let candidates = (data.data || []).filter((t) =>
    !REJECT.test(t.title) && !REJECT.test(t.artist?.name || '') && !REJECT.test(t.album?.title || '') &&
    norm(t.artist?.name).includes(norm(artist).split(' ')[0]) &&
    t.preview
  );
  if (candidates.length === 0) {
    // Loose: just title
    q = `"${title}"`;
    res = await fetch('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=10');
    data = await res.json();
    candidates = (data.data || []).filter((t) =>
      !REJECT.test(t.title) && !REJECT.test(t.artist?.name || '') && !REJECT.test(t.album?.title || '') &&
      norm(t.title) === norm(title) &&
      t.preview
    );
  }
  candidates.sort((a, b) => (b.rank || 0) - (a.rank || 0));
  return candidates[0] || null;
}

const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const existingIds = new Set(json.tracks.map((t) => String(t.deezerId)));
const existingKeys = new Set(
  json.tracks.map((t) => norm(t.title) + '|' + norm(t.artist))
);

const added = [];
const dupes = [];
const notFound = [];
for (let i = 0; i < list.length; i++) {
  const [title, artist, movie] = list[i];
  const pick = await searchOne(title, artist);
  if (!pick) {
    notFound.push({ title, artist, movie });
    console.log(`  ✗ ${title} — ${artist}  (Deezer search miss)`);
  } else {
    const id = String(pick.id);
    const key = norm(pick.title) + '|' + norm(pick.artist?.name);
    if (existingIds.has(id) || existingKeys.has(key)) {
      dupes.push({ id, title: pick.title, artist: pick.artist?.name, movie });
      console.log(`  ⚠ Already in pack: ${pick.title} — ${pick.artist?.name}`);
    } else {
      json.tracks.push({
        deezerId: id,
        title: pick.title,
        artist: pick.artist?.name || '',
        source: movie,
      });
      existingIds.add(id);
      existingKeys.add(key);
      added.push({ id, title: pick.title, artist: pick.artist?.name, movie });
      console.log(`  ✓ Added: ${pick.title} — ${pick.artist?.name}  (${movie})`);
    }
  }
  await new Promise((r) => setTimeout(r, 80));
}

writeFileSync(JSON_PATH, JSON.stringify(json, null, 2) + '\n');

console.log('');
console.log('=== SUMMARY ===');
console.log(`  Added:      ${added.length}`);
console.log(`  Duplicates: ${dupes.length}`);
console.log(`  Not found:  ${notFound.length}`);
console.log(`  Final pack size: ${json.tracks.length} tracks`);
if (notFound.length > 0) {
  console.log('\nUnfound (worth manual lookup on Deezer):');
  for (const n of notFound) console.log(`  - ${n.title} — ${n.artist} (${n.movie})`);
}
