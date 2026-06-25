#!/usr/bin/env node
/**
 * Canonical Modern Movies (2010+) song-movie ties to add to the
 * Modern Movies pack. Generated from Claude Opus's training-data
 * knowledge of which songs are best-known from which 2010+ films/shows.
 *
 * Cross-references with current Modern Movies playlist (15427817901)
 * to flag what's already there vs what needs to be added.
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
function csvField(v) { return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }
const REJECT = /karaoke|tribute|made\s*famous|in the style|cover\b|background music/i;

const list = [
  // Disney/Pixar Animated (2010+)
  ['Let It Go', 'Idina Menzel', 'Frozen'],
  ['Do You Want to Build a Snowman?', 'Kristen Bell', 'Frozen'],
  ['For the First Time in Forever', 'Kristen Bell', 'Frozen'],
  ['Love Is an Open Door', 'Kristen Bell', 'Frozen'],
  ['Into the Unknown', 'Idina Menzel', 'Frozen 2'],
  ['Show Yourself', 'Idina Menzel', 'Frozen 2'],
  ['Some Things Never Change', 'Kristen Bell', 'Frozen 2'],
  ['How Far I\'ll Go', 'Auli\'i Cravalho', 'Moana'],
  ['You\'re Welcome', 'Dwayne Johnson', 'Moana'],
  ['We Know the Way', 'Lin-Manuel Miranda', 'Moana'],
  ['Shiny', 'Jemaine Clement', 'Moana'],
  ['Remember Me', 'Miguel', 'Coco'],
  ['Un Poco Loco', 'Anthony Gonzalez', 'Coco'],
  ['We Don\'t Talk About Bruno', 'Lin-Manuel Miranda', 'Encanto'],
  ['Surface Pressure', 'Jessica Darrow', 'Encanto'],
  ['Dos Oruguitas', 'Sebastián Yatra', 'Encanto'],
  ['Waiting on a Miracle', 'Stephanie Beatriz', 'Encanto'],
  ['What Else Can I Do', 'Stephanie Beatriz', 'Encanto'],
  ['I See the Light', 'Mandy Moore', 'Tangled'],
  ['When Will My Life Begin', 'Mandy Moore', 'Tangled'],
  ['Touch the Sky', 'Julie Fowlis', 'Brave'],
  ['Nobody Like U', '4*TOWN', 'Turning Red'],
  ['At All Costs', 'Ariana DeBose', 'Wish'],

  // Movie Musicals (2010+)
  ['I Dreamed a Dream', 'Anne Hathaway', 'Les Misérables'],
  ['Do You Hear the People Sing', 'Aaron Tveit', 'Les Misérables'],
  ['On My Own', 'Samantha Barks', 'Les Misérables'],
  ['Suddenly', 'Hugh Jackman', 'Les Misérables'],
  ['This Is Me', 'Keala Settle', 'The Greatest Showman'],
  ['Rewrite the Stars', 'Zac Efron', 'The Greatest Showman'],
  ['Never Enough', 'Loren Allred', 'The Greatest Showman'],
  ['A Million Dreams', 'Hugh Jackman', 'The Greatest Showman'],
  ['From Now On', 'Hugh Jackman', 'The Greatest Showman'],
  ['The Greatest Show', 'Hugh Jackman', 'The Greatest Showman'],
  ['City of Stars', 'Ryan Gosling', 'La La Land'],
  ['Audition', 'Emma Stone', 'La La Land'],
  ['Another Day of Sun', 'La La Land Cast', 'La La Land'],
  ['Someone in the Crowd', 'Emma Stone', 'La La Land'],
  ['Shallow', 'Lady Gaga', 'A Star Is Born'],
  ['Always Remember Us This Way', 'Lady Gaga', 'A Star Is Born'],
  ['I\'ll Never Love Again', 'Lady Gaga', 'A Star Is Born'],
  ['Defying Gravity', 'Cynthia Erivo', 'Wicked'],
  ['Popular', 'Ariana Grande', 'Wicked'],
  ['What Is This Feeling', 'Ariana Grande', 'Wicked'],
  ['My Shot', 'Lin-Manuel Miranda', 'Hamilton'],
  ['Alexander Hamilton', 'Lin-Manuel Miranda', 'Hamilton'],
  ['The Schuyler Sisters', 'Phillipa Soo', 'Hamilton'],
  ['Wait for It', 'Leslie Odom Jr', 'Hamilton'],
  ['Helpless', 'Phillipa Soo', 'Hamilton'],
  ['Satisfied', 'Renée Elise Goldsberry', 'Hamilton'],
  ['Memory', 'Jennifer Hudson', 'Cats'],

  // Marvel / Spider-Verse / Big Franchise
  ['Sunflower', 'Post Malone', 'Spider-Man: Into the Spider-Verse'],
  ['What\'s Up Danger', 'Blackway', 'Spider-Man: Into the Spider-Verse'],
  ['All the Stars', 'Kendrick Lamar', 'Black Panther'],
  ['Pray for Me', 'The Weeknd', 'Black Panther'],
  ['See You Again', 'Wiz Khalifa', 'Furious 7'],
  ['Hold My Hand', 'Lady Gaga', 'Top Gun: Maverick'],

  // Bond films (2012+)
  ['Skyfall', 'Adele', 'Skyfall'],
  ['Writing\'s on the Wall', 'Sam Smith', 'Spectre'],
  ['No Time to Die', 'Billie Eilish', 'No Time to Die'],

  // YA / Romance
  ['Safe & Sound', 'Taylor Swift', 'The Hunger Games'],
  ['Eyes Open', 'Taylor Swift', 'The Hunger Games'],
  ['The Hanging Tree', 'James Newton Howard', 'The Hunger Games: Mockingjay'],
  ['A Thousand Years', 'Christina Perri', 'The Twilight Saga: Breaking Dawn'],
  ['Earned It', 'The Weeknd', 'Fifty Shades of Grey'],
  ['Love Me Like You Do', 'Ellie Goulding', 'Fifty Shades of Grey'],

  // Barbie / Oppenheimer (2023)
  ['What Was I Made For?', 'Billie Eilish', 'Barbie'],
  ['Dance the Night', 'Dua Lipa', 'Barbie'],
  ['Pink', 'Lizzo', 'Barbie'],
  ['Can You Hear the Music', 'Ludwig Göransson', 'Oppenheimer'],

  // Biopic Musicals (Bohemian Rhapsody, Rocketman, Elvis)
  ['Bohemian Rhapsody', 'Queen', 'Bohemian Rhapsody'],
  ['Don\'t Stop Me Now', 'Queen', 'Bohemian Rhapsody'],
  ['Somebody to Love', 'Queen', 'Bohemian Rhapsody'],
  ['Radio Ga Ga', 'Queen', 'Bohemian Rhapsody'],
  ['Hound Dog', 'Elvis Presley', 'Elvis'],

  // Pitch Perfect Series
  ['Cups', 'Anna Kendrick', 'Pitch Perfect'],
  ['Flashlight', 'Jessie J', 'Pitch Perfect 2'],

  // TV/Streaming Series (qualifies if "movie/show" tie is strong)
  ['Running Up That Hill', 'Kate Bush', 'Stranger Things'],
  ['Master of Puppets', 'Metallica', 'Stranger Things'],
  ['All for Us', 'Labrinth', 'Euphoria'],
  ['Way Back Then', 'Jung Jae-il', 'Squid Game'],
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

console.log('Fetching current Modern Movies playlist (15427817901)...');
const all = [];
let index = 0;
while (true) {
  const res = await fetch('https://api.deezer.com/playlist/15427817901/tracks?index=' + index + '&limit=100');
  const data = await res.json();
  const batch = data.data || [];
  all.push(...batch);
  if (!data.next || batch.length < 100) break;
  index += 100;
  await new Promise((r) => setTimeout(r, 50));
}
const playlistKeys = new Set(all.map((t) => norm(t.title) + '|' + norm(t.artist?.name)));
console.log('Got ' + all.length + ' Modern Movies tracks');

const inPlaylist = [];
const toAdd = [];
const notFound = [];

for (let i = 0; i < list.length; i++) {
  const [title, artist, movie] = list[i];
  const pick = await searchOne(title, artist);
  if (!pick) {
    notFound.push({ title, artist, movie });
  } else {
    const k = norm(pick.title) + '|' + norm(pick.artist?.name);
    if (playlistKeys.has(k)) {
      inPlaylist.push({ id: pick.id, title: pick.title, artist: pick.artist?.name, movie });
    } else {
      toAdd.push({ id: pick.id, title: pick.title, artist: pick.artist?.name, movie });
    }
  }
  if ((i + 1) % 20 === 0) process.stdout.write(`  [${i + 1}/${list.length}]\n`);
  await new Promise((r) => setTimeout(r, 80));
}
console.log('');
console.log('=== RESULTS ===');
console.log('Already in playlist:           ' + inPlaylist.length);
console.log('Not yet in playlist (to add):  ' + toAdd.length);
console.log('Deezer search miss:            ' + notFound.length);

let txt = `# ${toAdd.length} canonical Modern Movies tracks to ADD to playlist 15427817901\n`;
txt += `# For each: paste URL → ... → Add to playlist → Modern Movies\n\n`;
for (const t of toAdd) {
  txt += `https://www.deezer.com/track/${t.id}   # ${t.title} — ${t.artist}  (${t.movie})\n`;
}
if (notFound.length) {
  txt += '\n# UNFOUND on Deezer search (look up manually if you want):\n';
  for (const n of notFound) txt += `# ${n.title} — ${n.artist} (${n.movie})\n`;
}
writeFileSync(join(__dirname, 'manual-add-modern-canon.txt'), txt);
console.log('✓ Wrote scripts/manual-add-modern-canon.txt');

let csv = 'DeezerId,Title,Artist,Album,Source\n';
for (const t of [...inPlaylist, ...toAdd]) {
  csv += [csvField(t.id), csvField(t.title), csvField(t.artist), csvField(''), csvField(t.movie)].join(',') + '\n';
}
writeFileSync(join(__dirname, 'modern-canon-sources.csv'), csv);
console.log('✓ Wrote scripts/modern-canon-sources.csv (source mappings for all ' + (inPlaylist.length + toAdd.length) + ' canonical tracks)');
