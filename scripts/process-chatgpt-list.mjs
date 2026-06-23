#!/usr/bin/env node
/**
 * One-shot: cross-reference ChatGPT's list of canonical song/movie ties
 * against Movie Classics, search Deezer for each missing track, output
 * a URL list (for manual add) + a source-CSV (for apply-sources later).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function csvField(v) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}
const REJECT = /karaoke|tribute|made\s*famous|in the style|cover\b|instrumental|made famous by|background music/i;

const list = [
  ['My Heart Will Go On', 'Celine Dion', 'Titanic'],
  ['Ghostbusters', 'Ray Parker Jr', 'Ghostbusters'],
  ['The Heat Is On', 'Glenn Frey', 'Beverly Hills Cop'],
  ['Unchained Melody', 'The Righteous Brothers', 'Ghost'],
  ['Oh Pretty Woman', 'Roy Orbison', 'Pretty Woman'],
  ['Bohemian Rhapsody', 'Queen', "Wayne's World"],
  ['Tiny Dancer', 'Elton John', 'Almost Famous'],
  ["You've Lost That Lovin' Feelin'", 'The Righteous Brothers', 'Top Gun'],
  ['Misirlou', 'Dick Dale', 'Pulp Fiction'],
  ["Girl You'll Be a Woman Soon", 'Urge Overkill', 'Pulp Fiction'],
  ['You Never Can Tell', 'Chuck Berry', 'Pulp Fiction'],
  ['Son of a Preacher Man', 'Dusty Springfield', 'Pulp Fiction'],
  ['Bittersweet Symphony', 'The Verve', 'Cruel Intentions'],
  ['In Your Eyes', 'Peter Gabriel', 'Say Anything'],
  ["Raindrops Keep Fallin' on My Head", 'B.J. Thomas', 'Butch Cassidy and the Sundance Kid'],
  ["Everybody's Talkin'", 'Harry Nilsson', 'Midnight Cowboy'],
  ['Iris', 'Goo Goo Dolls', 'City of Angels'],
  ['A Thousand Miles', 'Vanessa Carlton', 'White Chicks'],
  ['Twist and Shout', 'The Beatles', "Ferris Bueller's Day Off"],
  ['Born to Be Wild', 'Steppenwolf', 'Easy Rider'],
  ['Old Time Rock and Roll', 'Bob Seger', 'Risky Business'],
  ['Shout', 'The Isley Brothers', 'Animal House'],
  ['Maniac', 'Michael Sembello', 'Flashdance'],
  ["(I've Had) The Time of My Life", 'Bill Medley', 'Dirty Dancing'],
  ['Do You Love Me', 'The Contours', 'Dirty Dancing'],
  ['Love Is Strange', 'Mickey & Sylvia', 'Dirty Dancing'],
  ['Be My Baby', 'The Ronettes', 'Dirty Dancing'],
  ['Goodbye Horses', 'Q Lazzarus', 'The Silence of the Lambs'],
  ['American Girl', 'Tom Petty', 'The Silence of the Lambs'],
  ['Layla', 'Derek and the Dominos', 'Goodfellas'],
  ['Then He Kissed Me', 'The Crystals', 'Goodfellas'],
  ['Gimme Shelter', 'The Rolling Stones', 'Goodfellas'],
  ['Sweet Emotion', 'Aerosmith', 'Dazed and Confused'],
  ['Lust for Life', 'Iggy Pop', 'Trainspotting'],
  ['Born Slippy', 'Underworld', 'Trainspotting'],
  ['Just Dropped In', 'Kenny Rogers', 'The Big Lebowski'],
  ['The Man in Me', 'Bob Dylan', 'The Big Lebowski'],
  ['Sister Christian', 'Night Ranger', 'Boogie Nights'],
  ["Don't Stop Me Now", 'Queen', 'Shaun of the Dead'],
  ['All Star', 'Smash Mouth', 'Shrek'],
  ['Accidentally in Love', 'Counting Crows', 'Shrek 2'],
  ['Send Me on My Way', 'Rusted Root', 'Matilda'],
  ['What Is Love', 'Haddaway', 'A Night at the Roxbury'],
  ["Scotty Doesn't Know", 'Lustra', 'EuroTrip'],
  ['Men in Black', 'Will Smith', 'Men in Black'],
  ["Gangsta's Paradise", 'Coolio', 'Dangerous Minds'],
  ['My Girl', 'The Temptations', 'My Girl'],
  ["You've Got a Friend in Me", 'Randy Newman', 'Toy Story'],
  ["I'll Make a Man Out of You", 'Donny Osmond', 'Mulan'],
  ['Beauty and the Beast', 'Celine Dion Peabo Bryson', 'Beauty and the Beast'],
  ['Reflection', 'Christina Aguilera', 'Mulan'],
  ['When She Loved Me', 'Sarah McLachlan', 'Toy Story 2'],
  ['Over the Rainbow', 'Judy Garland', 'The Wizard of Oz'],
  ['Moon River', 'Henry Mancini', 'Breakfast at Tiffanys'],
  ['Pure Imagination', 'Gene Wilder', 'Willy Wonka and the Chocolate Factory'],
  ['The Rainbow Connection', 'Kermit the Frog', 'The Muppet Movie'],
  ["Stayin' Alive", 'Bee Gees', 'Saturday Night Fever'],
  ['Night Fever', 'Bee Gees', 'Saturday Night Fever'],
  ['Time Warp', "Richard O'Brien", 'The Rocky Horror Picture Show'],
  ['Fame', 'Irene Cara', 'Fame'],
  ['9 to 5', 'Dolly Parton', '9 to 5'],
  ['Against All Odds', 'Phil Collins', 'Against All Odds'],
];

async function searchOne(title, artist) {
  const q = `track:"${title}" artist:"${artist}"`;
  const res = await fetch('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=10');
  const data = await res.json();
  const candidates = (data.data || []).filter((t) =>
    !REJECT.test(t.title) && !REJECT.test(t.artist?.name || '') && !REJECT.test(t.album?.title || '') &&
    norm(t.artist?.name).includes(norm(artist).split(' ')[0]) &&
    t.preview
  );
  candidates.sort((a, b) => (b.rank || 0) - (a.rank || 0));
  return candidates[0] || null;
}

const found = [];
const notFound = [];
for (let i = 0; i < list.length; i++) {
  const [title, artist, movie] = list[i];
  const pick = await searchOne(title, artist);
  if (pick) {
    found.push({ id: pick.id, title: pick.title, artist: pick.artist?.name, movie });
  } else {
    notFound.push({ title, artist, movie });
  }
  if ((i + 1) % 20 === 0) process.stdout.write(`  [${i + 1}/${list.length}]\n`);
  await new Promise((r) => setTimeout(r, 80));
}
console.log('');
console.log('Found: ' + found.length + ', not found: ' + notFound.length);

let txt = `# ${found.length} tracks to ADD to Movie Classics (15450804501)\n`;
txt += `# For each: paste URL in Deezer address bar → ... menu → Add to playlist → Movie Classics\n\n`;
for (const f of found) {
  txt += `https://www.deezer.com/track/${f.id}   # ${f.title} — ${f.artist}  (${f.movie})\n`;
}
if (notFound.length) {
  txt += '\n# UNFOUND on Deezer search (skip or look up manually):\n';
  for (const u of notFound) txt += `# ${u.title} — ${u.artist} (${u.movie})\n`;
}
writeFileSync(join(__dirname, 'manual-add-chatgpt-classics.txt'), txt);
console.log('✓ Wrote scripts/manual-add-chatgpt-classics.txt');

let csv = 'DeezerId,Title,Artist,Album,Source\n';
for (const f of found) {
  csv += [csvField(f.id), csvField(f.title), csvField(f.artist), csvField(''), csvField(f.movie)].join(',') + '\n';
}
writeFileSync(join(__dirname, 'chatgpt-sources-classics.csv'), csv);
console.log('✓ Wrote scripts/chatgpt-sources-classics.csv');
