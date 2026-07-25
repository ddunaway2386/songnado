#!/usr/bin/env node
/**
 * Append canonical wedding-canon additions to the Wedding Soundiiz-import
 * CSV. Same pattern as add-modern-canon-v2.mjs but for the Wedding pack
 * (which is going through Soundiiz-upload path, not curated-Deezer JSON).
 *
 * De-dupes against the existing CSV by normalized title (lowercase,
 * punctuation-stripped) so we don't push the same song twice under a
 * slight naming variant. Soundiiz has its own dedup pass on upload so
 * this is belt-and-suspenders.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, 'soundiiz-import-theme-wedding.csv');

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[’‘'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonical wedding additions organized by category. Aim: fill obvious
// gaps in the current 169-track pack. Order doesn't matter (Soundiiz
// stores by upload order and users shuffle anyway).
const ADDITIONS = [
  // ─── LINE DANCES (all essential, all missing) ─────────────────────
  ['Cha Cha Slide', 'DJ Casper'],
  ['Cupid Shuffle', 'Cupid'],
  ['Cotton Eye Joe', 'Rednex'],
  ['Wobble', 'V.I.C.'],
  ['Electric Boogie', 'Marcia Griffiths'],
  ['YMCA', 'Village People'],
  ['Macarena', 'Los Del Rio'],
  ['Conga', 'Miami Sound Machine'],
  ['The Twist', 'Chubby Checker'],
  ['Time Warp', 'Rocky Horror Picture Show'],

  // ─── RECEPTION BANGERS ────────────────────────────────────────────
  ['Livin\' on a Prayer', 'Bon Jovi'],
  ['Don\'t Stop Believin\'', 'Journey'],
  ['Mr. Brightside', 'The Killers'],
  ['Shout', 'The Isley Brothers'],
  ['Twist and Shout', 'The Beatles'],
  ['Hey Ya!', 'OutKast'],
  ['I\'m Gonna Be (500 Miles)', 'The Proclaimers'],
  ['Come On Eileen', 'Dexys Midnight Runners'],
  ['Blinding Lights', 'The Weeknd'],
  ['Uptown Funk (feat. Bruno Mars)', 'Mark Ronson'],
  ['Shut Up and Dance', 'WALK THE MOON'],
  ['Can\'t Stop the Feeling!', 'Justin Timberlake'],
  ['Sweet Home Alabama', 'Lynyrd Skynyrd'],
  ['Piano Man', 'Billy Joel'],
  ['Don\'t Stop Me Now', 'Queen'],
  ['Bohemian Rhapsody', 'Queen'],
  ['Footloose', 'Kenny Loggins'],
  ['I Wanna Dance with Somebody (Who Loves Me)', 'Whitney Houston'],
  ['Play That Funky Music', 'Wild Cherry'],
  ['Girls Just Want to Have Fun', 'Cyndi Lauper'],
  ['Walking on Sunshine', 'Katrina & The Waves'],
  ['Groove Is in the Heart', 'Deee-Lite'],
  ['Uptown Girl', 'Billy Joel'],
  ['Ain\'t No Mountain High Enough', 'Marvin Gaye & Tammi Terrell'],
  ['I Want You Back', 'The Jackson 5'],
  ['Brown Eyed Girl', 'Van Morrison'],
  ['ABC', 'The Jackson 5'],
  ['Get Down Tonight', 'KC & The Sunshine Band'],
  ['Signed, Sealed, Delivered I\'m Yours', 'Stevie Wonder'],
  ['Superstition', 'Stevie Wonder'],
  ['Old Time Rock & Roll', 'Bob Seger'],
  ['We Are Young (feat. Janelle Monáe)', 'fun.'],

  // ─── FATHER-DAUGHTER / MOTHER-SON DANCES ──────────────────────────
  ['Butterfly Kisses', 'Bob Carlisle'],
  ['Isn\'t She Lovely', 'Stevie Wonder'],
  ['The Way You Look Tonight', 'Frank Sinatra'],
  ['Cinderella', 'Steven Curtis Chapman'],
  ['My Wish', 'Rascal Flatts'],
  ['Simple Man', 'Lynyrd Skynyrd'],
  ['Wind Beneath My Wings', 'Bette Midler'],
  ['A Song for Mama', 'Boyz II Men'],
  ['You Are So Beautiful', 'Joe Cocker'],
  ['Unforgettable', 'Nat King Cole'],
  ['I Loved Her First', 'Heartland'],
  ['Daughters', 'John Mayer'],
  ['My Girl', 'The Temptations'],

  // ─── SLOW DANCE CLASSICS ──────────────────────────────────────────
  ['Endless Love', 'Diana Ross & Lionel Richie'],
  ['Save the Last Dance for Me', 'The Drifters'],
  ['Fly Me to the Moon', 'Frank Sinatra'],
  ['Cheek to Cheek', 'Ella Fitzgerald & Louis Armstrong'],
  ['Just the Way You Are', 'Billy Joel'],
  ['Nothing\'s Gonna Stop Us Now', 'Starship'],
  ['When a Man Loves a Woman', 'Percy Sledge'],
  ['Kiss From a Rose', 'Seal'],
  ['Truly Madly Deeply', 'Savage Garden'],
  ['I Don\'t Want to Wait', 'Paula Cole'],
  ['I Will', 'The Beatles'],
  ['God Only Knows', 'The Beach Boys'],
  ['The First Time Ever I Saw Your Face', 'Roberta Flack'],
  ['Time in a Bottle', 'Jim Croce'],
  ['Let\'s Stay Together', 'Al Green'],
  ['Ain\'t That a Kick in the Head', 'Dean Martin'],
  ['Everything I Do', 'Bryan Adams'],

  // ─── LATIN / CROSS-CULTURAL ───────────────────────────────────────
  ['Suavemente', 'Elvis Crespo'],
  ['La Bamba', 'Los Lobos'],
  ['Despacito (feat. Daddy Yankee)', 'Luis Fonsi'],
  ['Bailando (feat. Descemer Bueno & Gente De Zona)', 'Enrique Iglesias'],
  ['Vivir Mi Vida', 'Marc Anthony'],
  ['Danza Kuduro', 'Don Omar & Lucenzo'],
  ['Waka Waka (This Time for Africa)', 'Shakira'],

  // ─── COUNTRY WEDDING STAPLES ──────────────────────────────────────
  ['Marry Me', 'Train'],
  ['From The Ground Up', 'Dan + Shay'],
  ['Just A Kiss', 'Lady A'],
  ['I Cross My Heart', 'George Strait'],
  ['Chicken Fried', 'Zac Brown Band'],
  ['Wagon Wheel', 'Darius Rucker'],
  ['Wanted', 'Hunter Hayes'],
  ['H.O.L.Y.', 'Florida Georgia Line'],
  ['Die a Happy Man', 'Thomas Rhett'],
  ['You Look So Good In Love', 'George Strait'],
  ['Forever and Ever, Amen', 'Randy Travis'],

  // ─── ANTHEMS / SINGALONGS ─────────────────────────────────────────
  ['Don\'t Stop', 'Fleetwood Mac'],
  ['Sweet Home Chicago', 'The Blues Brothers'],
  ['Whole Lotta Rosie', 'AC/DC'],
  ['Come Together', 'The Beatles'],
  ['Hey Jude', 'The Beatles'],
  ['Twist and Shout (Original)', 'The Isley Brothers'],
  ['Build Me Up Buttercup', 'The Foundations'],
  ['I Feel Good', 'James Brown'],
  ['Play the Music', 'K.C. and the Sunshine Band'],
  ['I\'m Every Woman', 'Whitney Houston'],
  ['Boogie Wonderland', 'Earth, Wind & Fire'],
  ['Boogie Oogie Oogie', 'A Taste of Honey'],
  ['September (Extended Version)', 'Earth, Wind & Fire'],

  // ─── MODERN POP / RECENT ─────────────────────────────────────────
  ['Levitating', 'Dua Lipa'],
  ['Cheap Thrills', 'Sia'],
  ['Cake by the Ocean', 'DNCE'],
  ['Watermelon Sugar', 'Harry Styles'],
  ['As It Was', 'Harry Styles'],
  ['Flowers', 'Miley Cyrus'],
  ['Espresso', 'Sabrina Carpenter'],
  ['Kill Bill', 'SZA'],
];

// Load current CSV, dedupe additions
const src = readFileSync(CSV_PATH, 'utf8');
const lines = src.split(/\r?\n/).filter(Boolean);
const header = lines[0];
const existing = lines.slice(1);

function parseTitleFromCsvRow(line) {
  const m = line.match(/^\"([^\"]+)\",\"([^\"]+)\"/);
  return m ? m[1] : '';
}

const existingTitles = new Set(existing.map((l) => norm(parseTitleFromCsvRow(l))));

const dedupedAdditions = [];
const skipped = [];
for (const [title, artist] of ADDITIONS) {
  const key = norm(title);
  if (existingTitles.has(key)) {
    skipped.push(`${title} — ${artist}`);
    continue;
  }
  existingTitles.add(key);
  dedupedAdditions.push([title, artist]);
}

const additionsCsv = dedupedAdditions.map(
  ([t, a]) => `"${t.replace(/"/g, '""')}","${a.replace(/"/g, '""')}"`
);

const outLines = [header, ...existing, ...additionsCsv];
writeFileSync(CSV_PATH, outLines.join('\n') + '\n');

console.log(`Wedding pack additions:`);
console.log(`  Proposed:  ${ADDITIONS.length}`);
console.log(`  Added:     ${dedupedAdditions.length}`);
console.log(`  Duplicates (skipped): ${skipped.length}`);
console.log(`  New total: ${existing.length + dedupedAdditions.length} tracks`);
if (skipped.length > 0) {
  console.log(`\nSkipped (already in pack):`);
  for (const s of skipped) console.log(`  - ${s}`);
}
