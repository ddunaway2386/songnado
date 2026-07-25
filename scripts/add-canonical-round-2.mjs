#!/usr/bin/env node
/**
 * Canonical additions round 2 - for the three packs where I see clear
 * gaps after the raw-pack pulls: Classic TV Themes, Modern TV Themes,
 * and Broadway.
 *
 * Same pattern as add-wedding-canonical.mjs and add-broadway-canonical.mjs
 * except this one writes to curated-Deezer JSON directly (no Soundiiz
 * involvement), searches Deezer for each candidate with strict artist
 * matching, dedupes against existing tracks.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');

const REJECT_RE = /karaoke|tribute|made\s*famous|in the style|glee cast|cover of\b/i;

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[’‘'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchDeezer(title, artist) {
  const artistKey = norm(artist).split(' ')[0];
  const strictUrl = 'https://api.deezer.com/search?q=' + encodeURIComponent(`track:"${title}" artist:"${artist}"`) + '&limit=10';
  let hits = await fetch(strictUrl).then((r) => r.json()).then((d) => d.data || []).catch(() => []);
  let best = hits.find(
    (h) =>
      (h.artist?.name || '').toLowerCase().includes(artistKey) &&
      !REJECT_RE.test(h.title) &&
      !REJECT_RE.test(h.artist?.name || '') &&
      h.preview
  );
  if (best) return best;
  const looseUrl = 'https://api.deezer.com/search?q=' + encodeURIComponent(`${title} ${artist}`) + '&limit=10';
  hits = await fetch(looseUrl).then((r) => r.json()).then((d) => d.data || []).catch(() => []);
  best = hits.find(
    (h) =>
      (h.artist?.name || '').toLowerCase().includes(artistKey) &&
      !REJECT_RE.test(h.title) &&
      !REJECT_RE.test(h.artist?.name || '') &&
      h.preview
  );
  return best || null;
}

// ─── CLASSIC TV THEMES additions ──────────────────────────────────
// Focus: pre-2010 shows currently missing (or with only obscure covers)
const CLASSIC_TV_ADDITIONS = [
  // Cartoons - big gaps
  ['The Simpsons Theme', 'Danny Elfman', 'The Simpsons'],
  ['Family Guy Theme', 'Walter Murphy', 'Family Guy'],
  ['Rugrats', 'Mark Mothersbaugh', 'Rugrats'],
  ['DuckTales', 'Jeff Pescetto', 'DuckTales'],
  ['Teenage Mutant Ninja Turtles', 'Chuck Lorre', 'TMNT'],
  ['Powerpuff Girls Theme', 'James Venable', 'The Powerpuff Girls'],
  ['Dexters Laboratory', 'Thomas Chase', 'Dexter\'s Laboratory'],
  ['Rocko\'s Modern Life', 'Pat Irwin', 'Rocko\'s Modern Life'],
  ['Doug Theme', 'Fred Newman', 'Doug'],
  ['Hey Arnold Theme', 'Jim Lang', 'Hey Arnold!'],
  ['Recess Theme', 'Denis Hannigan', 'Recess'],
  ['Animaniacs Theme', 'Richard Stone', 'Animaniacs'],
  ['Tiny Toon Adventures', 'Bruce Broughton', 'Tiny Toon Adventures'],
  ['Pinky and the Brain', 'Richard Stone', 'Pinky and the Brain'],
  ['Reading Rainbow', 'Steve Horelick', 'Reading Rainbow'],
  ['The Flintstones', 'Hoyt Curtin', 'The Flintstones'],

  // Older classics
  ['Bonanza Theme', 'Ray Evans', 'Bonanza'],
  ['Andy Griffith Show Theme', 'Earle Hagen', 'The Andy Griffith Show'],
  ['Twilight Zone Theme', 'Marius Constant', 'The Twilight Zone'],
  ['Bewitched', 'Howard Greenfield', 'Bewitched'],
  ['Mission: Impossible Theme', 'Lalo Schifrin', 'Mission Impossible'],
  ['Hawaii Five-O Theme', 'Morton Stevens', 'Hawaii Five-O'],
  ['The Rockford Files', 'Mike Post', 'The Rockford Files'],
  ['Hill Street Blues', 'Mike Post', 'Hill Street Blues'],
  ['Bosom Buddies Theme', 'Billy Joel', 'Bosom Buddies'],

  // 80s-90s classics still missing
  ['Saved by the Bell Theme', 'Scott Gale', 'Saved by the Bell'],
  ['Different Strokes Theme', 'Alan Thicke', 'Diff\'rent Strokes'],
  ['Facts of Life Theme', 'Alan Thicke', 'The Facts of Life'],
  ['Perfect Strangers Theme', 'Jesse Frederick', 'Perfect Strangers'],
  ['Family Matters Theme', 'Bennett Salvay', 'Family Matters'],
  ['In Living Color Theme', 'Heavy D & the Boyz', 'In Living Color'],
  ['The A-Team Theme', 'Mike Post', 'The A-Team'],
  ['Cops', 'Inner Circle', 'COPS'],
  ['Family Ties Theme', 'Jesse Frederick', 'Family Ties'],
  ['Mary Tyler Moore Show', 'Sonny Curtis', 'Mary Tyler Moore Show'],

  // Dramas
  ['NYPD Blue Theme', 'Mike Post', 'NYPD Blue'],
  ['Alias Theme', 'J.J. Abrams', 'Alias'],
  ['24 Theme', 'Sean Callery', '24'],
  ['Charmed Theme (How Soon Is Now?)', 'Love Spit Love', 'Charmed'],
  ['Buffy the Vampire Slayer Theme', 'Nerf Herder', 'Buffy the Vampire Slayer'],
  ['Angel Theme', 'Darling Violetta', 'Angel'],
  ['Dawson\'s Creek (I Don\'t Want to Wait)', 'Paula Cole', 'Dawson\'s Creek'],
  ['The West Wing Theme', 'W. G. Snuffy Walden', 'The West Wing'],

  // Kids / other
  ['Barney Theme (I Love You)', 'Barney', 'Barney & Friends'],
  ['Blues Clues Theme', 'Steve Burns', 'Blue\'s Clues'],
  ['Arthur Theme', 'Ziggy Marley', 'Arthur'],
  ['Winnie the Pooh Theme', 'Sherman Brothers', 'Winnie the Pooh'],
  ['The Adventures of Rocky and Bullwinkle', 'Frank Comstock', 'Rocky and Bullwinkle'],

  // Late night / variety
  ['Saturday Night Live Theme', 'Howard Shore', 'SNL'],
  ['The Tonight Show Theme', 'Paul Anka', 'The Tonight Show'],
];

// ─── MODERN TV THEMES additions ───────────────────────────────────
// Focus: 2010+ prestige TV heavily missing
const MODERN_TV_ADDITIONS = [
  // Peaky Blinders classics
  ['Red Right Hand', 'Nick Cave & The Bad Seeds', 'Peaky Blinders'],
  ['Anna', 'Anna Calvi', 'Peaky Blinders'],

  // Ted Lasso / Bear / The Boys
  ['Ted Lasso Theme', 'Marcus Mumford', 'Ted Lasso'],
  ['New Noise', 'Refused', 'The Bear'],
  ['The Boys Main Theme', 'Christopher Lennertz', 'The Boys'],

  // Squid Game
  ['Way Back Then', 'Jung Jae Il', 'Squid Game'],
  ['Pink Soldiers', 'Jung Jae Il', 'Squid Game'],
  ['Round VI', 'Jung Jae Il', 'Squid Game'],

  // Bridgerton
  ['Bridgerton Suite', 'Kris Bowers', 'Bridgerton'],
  ['Wildest Dreams', 'Duomo', 'Bridgerton'],

  // Severance
  ['Severance Main Title', 'Theodore Shapiro', 'Severance'],

  // White Lotus
  ['Renaissance (Main Title Theme) [From "The White Lotus"]', 'Cristobal Tapia de Veer', 'The White Lotus'],
  ['Aloha! (from "The White Lotus" Season 1)', 'Cristobal Tapia de Veer', 'The White Lotus'],
  ['Enigmatic (from "The White Lotus" Season 2)', 'Cristobal Tapia de Veer', 'The White Lotus'],

  // Handmaid's Tale / Crown
  ['The Crown Main Title', 'Hans Zimmer', 'The Crown'],
  ['Offred', 'Adam Taylor', 'The Handmaid\'s Tale'],

  // Westworld
  ['Westworld Main Title Theme', 'Ramin Djawadi', 'Westworld'],

  // Ozark / Better Call Saul
  ['Ozark (Main Title Theme)', 'Danny Bensi', 'Ozark'],
  ['Better Call Saul Main Title Theme', 'Little Barrie', 'Better Call Saul'],

  // Barry / Mr Robot
  ['Barry Main Titles', 'David Wingo', 'Barry'],
  ['Mr. Robot Main Title Theme', 'Mac Quayle', 'Mr. Robot'],

  // The Marvelous Mrs. Maisel
  ['Maisel Main Title', 'Sara Bareilles', 'The Marvelous Mrs. Maisel'],

  // La Casa de Papel / Money Heist
  ['Bella Ciao', 'Manu Pilas', 'Money Heist'],

  // Cobra Kai
  ['You\'re the Best', 'Joe Esposito', 'Cobra Kai'],

  // Killing Eve
  ['Killing Eve Main Theme', 'David Holmes', 'Killing Eve'],

  // Yellowjackets
  ['No Return', 'Craig Wedren', 'Yellowjackets'],

  // Fleabag
  ['Fleabag Theme', 'Isobel Waller-Bridge', 'Fleabag'],

  // The Umbrella Academy
  ['I Think We\'re Alone Now', 'Tiffany', 'The Umbrella Academy'],

  // Big Little Lies
  ['Cold Little Heart', 'Michael Kiwanuka', 'Big Little Lies'],

  // Silicon Valley / Rings of Power
  ['Silicon Valley Theme', 'Jeff Cardoni', 'Silicon Valley'],
  ['The Rings of Power Main Title', 'Bear McCreary', 'The Rings of Power'],

  // Cartoons + Adult Animation
  ['Rick and Morty Theme', 'Justin Roiland', 'Rick and Morty'],
  ['Bojack Horseman Theme', 'Patrick Carney', 'BoJack Horseman'],
  ['Bluey Theme Song', 'Joff Bush', 'Bluey'],
  ['Adventure Time Main Title', 'Pendleton Ward', 'Adventure Time'],
  ['Steven Universe Theme', 'Rebecca Sugar', 'Steven Universe'],

  // Marvel/Disney+
  ['WandaVision Theme', 'Kristen Anderson-Lopez', 'WandaVision'],
  ['Loki Main Theme', 'Natalie Holt', 'Loki'],
  ['The Falcon and the Winter Soldier Main Theme', 'Henry Jackman', 'The Falcon and the Winter Soldier'],

  // Streaming hits
  ['Ozark Main Title', 'Danny Bensi', 'Ozark'],
  ['The Queen\'s Gambit', 'Carlos Rafael Rivera', 'The Queen\'s Gambit'],
  ['Bridgerton Wedding', 'Kris Bowers', 'Bridgerton'],
];

// ─── BROADWAY additions round 2 ───────────────────────────────────
// Focus: deeper cuts of already-covered shows + recently missed shows
const BROADWAY_ADDITIONS = [
  // Sondheim classics missing
  ['Not While I\'m Around', 'Broadway Cast', 'Sweeney Todd'],
  ['Being Alive', 'Raul Esparza', 'Company'],
  ['Comedy Tonight', 'Nathan Lane', 'A Funny Thing Happened on the Way to the Forum'],
  ['Broadway Baby', 'Broadway Cast', 'Follies'],
  ['I\'m Still Here', 'Elaine Stritch', 'Follies'],
  ['Losing My Mind', 'Broadway Cast', 'Follies'],
  ['Everything\'s Coming Up Roses', 'Ethel Merman', 'Gypsy'],
  ['Rose\'s Turn', 'Bernadette Peters', 'Gypsy'],
  ['Let Me Entertain You', 'Broadway Cast', 'Gypsy'],
  ['Some People', 'Ethel Merman', 'Gypsy'],

  // Camelot / classic musicals
  ['If Ever I Would Leave You', 'Robert Goulet', 'Camelot'],
  ['Camelot', 'Richard Burton', 'Camelot'],

  // The King and I
  ['Getting to Know You', 'Deborah Kerr', 'The King and I'],
  ['Shall We Dance', 'Yul Brynner', 'The King and I'],

  // Kiss Me Kate
  ['So in Love', 'Cole Porter', 'Kiss Me Kate'],
  ['Too Darn Hot', 'Broadway Cast', 'Kiss Me Kate'],

  // Chicago (deeper)
  ['Class', 'Queen Latifah', 'Chicago'],
  ['They Both Reached for the Gun', 'Broadway Cast', 'Chicago'],

  // Newsies (deeper)
  ['King of New York', 'Newsies Broadway Cast', 'Newsies'],

  // Something Rotten
  ['Welcome to the Renaissance', 'Something Rotten Cast', 'Something Rotten!'],
  ['A Musical', 'Broadway Cast', 'Something Rotten!'],
  ['Hard to Be the Bard', 'Something Rotten Cast', 'Something Rotten!'],

  // Come From Away (deeper)
  ['Prayer', 'Come From Away Cast', 'Come From Away'],
  ['Somewhere in the Middle of Nowhere', 'Come From Away Cast', 'Come From Away'],

  // Recent shows
  ['Some Like It Hot', 'Broadway Cast', 'Some Like It Hot'],
  ['Kimberly Akimbo', 'Broadway Cast', 'Kimberly Akimbo'],
  ['A Strange Loop', 'Broadway Cast', 'A Strange Loop'],
  ['& Juliet - I Want It That Way', 'Original Broadway Cast', '& Juliet'],

  // Parade
  ['This Is Not Over Yet', 'Ben Platt', 'Parade'],
  ['All the Wasted Time', 'Ben Platt', 'Parade'],

  // MJ the Musical
  ['Man in the Mirror', 'MJ the Musical Cast', 'MJ the Musical'],
  ['Beat It', 'MJ the Musical Cast', 'MJ the Musical'],

  // Falsettos
  ['Four Jews in a Room Bitching', 'Broadway Cast', 'Falsettos'],
  ['What Would I Do', 'Broadway Cast', 'Falsettos'],

  // Sunday in the Park with George
  ['Sunday', 'Broadway Cast', 'Sunday in the Park with George'],
  ['Finishing the Hat', 'Mandy Patinkin', 'Sunday in the Park with George'],

  // The Prom
  ['Time to Dance', 'The Prom Cast', 'The Prom'],
  ['Barry Is Going to Prom', 'Brooks Ashmanskas', 'The Prom'],
];

// ─── EXECUTE ──────────────────────────────────────────────────────

async function processpack(slug, additions) {
  const jsonPath = join(CURATED_DIR, `${slug}.json`);
  const pack = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const existingIds = new Set(pack.tracks.map((t) => String(t.deezerId)));
  const existingTitles = new Set(pack.tracks.map((t) => norm(t.title)));

  console.log(`\n=== ${pack.name} (currently ${pack.tracks.length}) ===`);
  console.log(`  Proposed additions: ${additions.length}`);

  const added = [], skipped = [], notFound = [];
  for (const [title, artist, source] of additions) {
    if (existingTitles.has(norm(title))) {
      skipped.push({ title, artist, reason: 'dupe title' });
      continue;
    }
    const hit = await searchDeezer(title, artist);
    if (!hit) {
      notFound.push({ title, artist });
      continue;
    }
    if (existingIds.has(String(hit.id))) {
      skipped.push({ title, artist, reason: 'dupe id' });
      continue;
    }
    pack.tracks.push({
      deezerId: String(hit.id),
      title: hit.title,
      artist: hit.artist?.name || '',
      source: source || '',
    });
    existingIds.add(String(hit.id));
    existingTitles.add(norm(hit.title));
    added.push({ title: hit.title, artist: hit.artist?.name });
    await new Promise((r) => setTimeout(r, 60));
  }

  writeFileSync(jsonPath, JSON.stringify(pack, null, 2) + '\n');
  console.log(`  Added: ${added.length}`);
  console.log(`  Skipped (dupes): ${skipped.length}`);
  console.log(`  Not found on Deezer: ${notFound.length}`);
  if (notFound.length > 0 && notFound.length < 15) {
    for (const n of notFound) console.log(`    - ${n.title} — ${n.artist}`);
  }
  console.log(`  New total: ${pack.tracks.length} tracks`);
  return { name: pack.name, count: pack.tracks.length };
}

const results = [];
results.push(await processpack('classic-tv-themes', CLASSIC_TV_ADDITIONS));
results.push(await processpack('modern-tv-themes', MODERN_TV_ADDITIONS));
results.push(await processpack('broadway', BROADWAY_ADDITIONS));

console.log('\n\n=========================================');
console.log('SUMMARY');
console.log('=========================================');
for (const r of results) console.log(`  ${r.name.padEnd(20)} ${r.count} tracks`);
