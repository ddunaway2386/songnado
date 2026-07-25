#!/usr/bin/env node
/**
 * Append canonical Broadway additions to soundiiz-import-theme-broadway.csv.
 * Same pattern as add-wedding-canonical.mjs.
 *
 * Current pack is heavy on Hamilton (30+ tracks) and Wicked (~10), plus
 * some Dear Evan Hansen / Waitress / Six / La La Land — but skips 60+
 * years of iconic Broadway (Phantom, Les Mis, Sound of Music, Fiddler,
 * Grease, Cats, My Fair Lady, Sweeney Todd, disney musicals, etc.).
 *
 * Aim: 143 -> ~280 tracks, spread across ~30 shows for real breadth.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, 'soundiiz-import-theme-broadway.csv');

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[’‘'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonical Broadway additions. Every track should be famous enough that
// a casual musical fan would recognize either the song, the show, or both.
// Grouped by show for readability.
const ADDITIONS = [
  // ─── PHANTOM OF THE OPERA ─────────────────────────────────────────
  ['The Phantom of the Opera', 'Michael Crawford'],
  ['The Music of the Night', 'Michael Crawford'],
  ['All I Ask of You', 'Sarah Brightman'],
  ['Think of Me', 'Sarah Brightman'],
  ['Angel of Music', 'Sarah Brightman'],
  ['Wishing You Were Somehow Here Again', 'Sarah Brightman'],

  // ─── LES MISÉRABLES ───────────────────────────────────────────────
  ['I Dreamed a Dream', 'Anne Hathaway'],
  ['On My Own', 'Samantha Barks'],
  ['Do You Hear the People Sing?', 'Original London Cast'],
  ['Bring Him Home', 'Colm Wilkinson'],
  ['Empty Chairs at Empty Tables', 'Eddie Redmayne'],
  ['One Day More', 'Les Misérables Cast'],
  ['Master of the House', 'Sacha Baron Cohen'],
  ['Stars', 'Russell Crowe'],
  ['At the End of the Day', 'Les Misérables Cast'],
  ['A Little Fall of Rain', 'Samantha Barks'],

  // ─── THE SOUND OF MUSIC ───────────────────────────────────────────
  ['Do-Re-Mi', 'Julie Andrews'],
  ['Sixteen Going on Seventeen', 'Charmian Carr'],
  ['Edelweiss', 'Bill Lee'],
  ['So Long, Farewell', 'The Von Trapp Children'],
  ['Climb Ev\'ry Mountain', 'Peggy Wood'],
  ['The Lonely Goatherd', 'Julie Andrews'],
  ['The Sound of Music', 'Julie Andrews'],

  // ─── MY FAIR LADY ─────────────────────────────────────────────────
  ['I Could Have Danced All Night', 'Audrey Hepburn'],
  ['Wouldn\'t It Be Loverly', 'Audrey Hepburn'],
  ['On the Street Where You Live', 'Jeremy Brett'],
  ['The Rain in Spain', 'Audrey Hepburn'],
  ['Get Me to the Church on Time', 'Stanley Holloway'],
  ['I\'ve Grown Accustomed to Her Face', 'Rex Harrison'],

  // ─── FIDDLER ON THE ROOF ──────────────────────────────────────────
  ['Tradition', 'Topol'],
  ['If I Were a Rich Man', 'Topol'],
  ['Sunrise, Sunset', 'Topol'],
  ['Matchmaker, Matchmaker', 'Fiddler on the Roof Cast'],
  ['To Life', 'Topol'],

  // ─── WEST SIDE STORY (already has America) ────────────────────────
  ['Maria', 'Jimmy Bryant'],
  ['Tonight', 'Marni Nixon'],
  ['Somewhere', 'Reri Grist'],
  ['I Feel Pretty', 'Marni Nixon'],
  ['Something\'s Coming', 'Jimmy Bryant'],

  // ─── CATS ─────────────────────────────────────────────────────────
  ['Memory', 'Elaine Paige'],
  ['Mr. Mistoffelees', 'Cats Original Broadway Cast'],
  ['Jellicle Songs for Jellicle Cats', 'Cats Original Broadway Cast'],

  // ─── THE MUSIC MAN ────────────────────────────────────────────────
  ['Seventy Six Trombones', 'Robert Preston'],
  ['Till There Was You', 'Shirley Jones'],
  ['Ya Got Trouble', 'Robert Preston'],

  // ─── GUYS AND DOLLS ───────────────────────────────────────────────
  ['Luck Be a Lady', 'Marlon Brando'],
  ['Sit Down, You\'re Rockin\' the Boat', 'Guys and Dolls Cast'],
  ['A Bushel and a Peck', 'Vivian Blaine'],

  // ─── OKLAHOMA! ────────────────────────────────────────────────────
  ['Oh, What a Beautiful Mornin\'', 'Gordon MacRae'],
  ['The Surrey With the Fringe on Top', 'Gordon MacRae'],
  ['People Will Say We\'re in Love', 'Gordon MacRae'],
  ['Oklahoma', 'Oklahoma Cast'],

  // ─── SOUTH PACIFIC ────────────────────────────────────────────────
  ['Some Enchanted Evening', 'Ezio Pinza'],
  ['I\'m Gonna Wash That Man Right Outa My Hair', 'Mary Martin'],
  ['Bali Ha\'i', 'Juanita Hall'],

  // ─── ANNIE ────────────────────────────────────────────────────────
  ['It\'s the Hard-Knock Life', 'Annie Cast'],
  ['Maybe', 'Andrea McArdle'],
  ['Easy Street', 'Dorothy Loudon'],

  // ─── GREASE (already has Grease itself) ───────────────────────────
  ['Summer Nights', 'John Travolta & Olivia Newton-John'],
  ['You\'re the One That I Want', 'John Travolta & Olivia Newton-John'],
  ['We Go Together', 'Grease Cast'],
  ['Beauty School Dropout', 'Frankie Avalon'],
  ['Greased Lightnin\'', 'John Travolta'],
  ['Hopelessly Devoted to You', 'Olivia Newton-John'],

  // ─── DISNEY MUSICALS ──────────────────────────────────────────────
  ['Circle of Life', 'Carmen Twillie'],
  ['Hakuna Matata', 'Nathan Lane'],
  ['I Just Can\'t Wait to Be King', 'Jason Weaver'],
  ['Be Our Guest', 'Angela Lansbury'],
  ['Beauty and the Beast', 'Angela Lansbury'],
  ['Belle', 'Paige O\'Hara'],
  ['A Whole New World', 'Brad Kane & Lea Salonga'],
  ['Friend Like Me', 'Robin Williams'],
  ['Prince Ali', 'Robin Williams'],
  ['Let It Go', 'Idina Menzel'],
  ['Do You Want to Build a Snowman?', 'Kristen Bell'],
  ['For the First Time in Forever', 'Kristen Bell & Idina Menzel'],
  ['Part of Your World', 'Jodi Benson'],
  ['Under the Sea', 'Samuel E. Wright'],

  // ─── CHICAGO (already has All That Jazz, Cell Block Tango, etc.) ──
  ['When You\'re Good to Mama', 'Queen Latifah'],
  ['Nowadays', 'Renée Zellweger & Catherine Zeta-Jones'],

  // ─── RENT (already has Seasons of Love, La Vie Boheme, Rent) ─────
  ['Take Me or Leave Me', 'Rosario Dawson'],
  ['Light My Candle', 'Adam Pascal'],
  ['One Song Glory', 'Adam Pascal'],
  ['Without You', 'Rosario Dawson'],
  ['I\'ll Cover You', 'Rent Cast'],

  // ─── CABARET ──────────────────────────────────────────────────────
  ['Cabaret', 'Liza Minnelli'],
  ['Willkommen', 'Joel Grey'],
  ['Maybe This Time', 'Liza Minnelli'],
  ['Money', 'Liza Minnelli'],

  // ─── A CHORUS LINE ────────────────────────────────────────────────
  ['What I Did for Love', 'A Chorus Line Cast'],
  ['One', 'A Chorus Line Cast'],
  ['Nothing', 'Priscilla Lopez'],

  // ─── LITTLE SHOP OF HORRORS (has Skid Row) ────────────────────────
  ['Suddenly Seymour', 'Little Shop of Horrors Cast'],
  ['Somewhere That\'s Green', 'Ellen Greene'],
  ['Feed Me (Git It)', 'Levi Stubbs'],

  // ─── HAIRSPRAY (has Good Morning Baltimore) ───────────────────────
  ['You Can\'t Stop the Beat', 'Hairspray Cast'],
  ['Without Love', 'Zac Efron'],
  ['Welcome to the 60\'s', 'Nikki Blonsky'],
  ['I Can Hear the Bells', 'Nikki Blonsky'],

  // ─── SIX (already has Ex-Wives, Six, Heart of Stone) ──────────────
  ['Don\'t Lose Ur Head', 'Millie O\'Connell'],
  ['All You Wanna Do', 'Aimie Atkinson'],
  ['Get Down', 'Alexia McIntosh'],
  ['No Way', 'Jarneia Richard-Noel'],
  ['I Don\'t Need Your Love', 'Maiya Quansah-Breed'],

  // ─── SWEENEY TODD ─────────────────────────────────────────────────
  ['Not While I\'m Around', 'Johnny Depp'],
  ['A Little Priest', 'Johnny Depp & Helena Bonham Carter'],
  ['Pretty Women', 'Johnny Depp'],
  ['The Worst Pies in London', 'Helena Bonham Carter'],

  // ─── IN THE HEIGHTS ───────────────────────────────────────────────
  ['In the Heights', 'Anthony Ramos'],
  ['96,000', 'In the Heights Cast'],
  ['Breathe', 'Leslie Grace'],
  ['When You\'re Home', 'Corey Hawkins'],
  ['Blackout', 'In the Heights Cast'],

  // ─── SPRING AWAKENING (has Bitch of Living, Totally Fucked) ──────
  ['The Song of Purple Summer', 'Spring Awakening Cast'],
  ['Left Behind', 'Jonathan Groff'],
  ['The Word of Your Body', 'Lea Michele & Jonathan Groff'],

  // ─── THE BOOK OF MORMON (has I Believe, Hello!, You and Me) ──────
  ['Turn It Off', 'Book of Mormon Cast'],
  ['Man Up', 'Josh Gad'],
  ['Sal Tlay Ka Siti', 'Nikki M. James'],

  // ─── HEATHERS ─────────────────────────────────────────────────────
  ['Beautiful', 'Barrett Wilbert Weed'],
  ['Candy Store', 'Heathers Original Off-Broadway Cast'],
  ['Freeze Your Brain', 'Ryan McCartan'],
  ['Meant to Be Yours', 'Ryan McCartan'],
  ['Seventeen', 'Barrett Wilbert Weed & Ryan McCartan'],

  // ─── BEETLEJUICE ──────────────────────────────────────────────────
  ['Dead Mom', 'Sophia Anne Caruso'],
  ['Say My Name', 'Alex Brightman'],
  ['That Beautiful Sound', 'Beetlejuice Musical Cast'],

  // ─── MEAN GIRLS ───────────────────────────────────────────────────
  ['Meet the Plastics', 'Mean Girls Original Broadway Cast'],
  ['World Burn', 'Taylor Louderman'],
  ['I\'d Rather Be Me', 'Barrett Wilbert Weed'],

  // ─── INTO THE WOODS (has Agony) ───────────────────────────────────
  ['No One Is Alone', 'Anna Kendrick'],
  ['Giants in the Sky', 'Daniel Huttlestone'],
  ['Prologue: Into the Woods', 'Into the Woods Cast'],

  // ─── FUNNY GIRL ───────────────────────────────────────────────────
  ['Don\'t Rain on My Parade', 'Barbra Streisand'],
  ['People', 'Barbra Streisand'],

  // ─── A LITTLE NIGHT MUSIC ─────────────────────────────────────────
  ['Send in the Clowns', 'Judi Dench'],

  // ─── COMPANY ──────────────────────────────────────────────────────
  ['Being Alive', 'Raúl Esparza'],
  ['The Ladies Who Lunch', 'Elaine Stritch'],

  // ─── KINKY BOOTS ──────────────────────────────────────────────────
  ['Raise You Up / Just Be', 'Kinky Boots Cast'],
  ['Land of Lola', 'Billy Porter'],

  // ─── AMERICAN IDIOT ───────────────────────────────────────────────
  ['Boulevard of Broken Dreams', 'American Idiot Cast'],
  ['21 Guns', 'American Idiot Cast'],
  ['Wake Me Up When September Ends', 'American Idiot Cast'],

  // ─── AIDA ─────────────────────────────────────────────────────────
  ['Written in the Stars', 'Elton John & LeAnn Rimes'],
  ['Elaborate Lives', 'Sherie Rene Scott'],

  // ─── ANASTASIA (has Once Upon a December, Journey to the Past) ────
  ['Rumor in St. Petersburg', 'Anastasia Cast'],
  ['In My Dreams', 'Christy Altomare'],

  // ─── JERSEY BOYS ──────────────────────────────────────────────────
  ['Sherry', 'Jersey Boys Cast'],
  ['Big Girls Don\'t Cry', 'Jersey Boys Cast'],
  ['Can\'t Take My Eyes Off You', 'John Lloyd Young'],
  ['Oh, What a Night (December 1963)', 'Jersey Boys Cast'],

  // ─── FROZEN THE MUSICAL ───────────────────────────────────────────
  ['Monster', 'Caissie Levy'],
  ['Dangerous to Dream', 'Caissie Levy'],

  // ─── COME FROM AWAY (has Welcome to the Rock, Me and the Sky) ────
  ['Screech In', 'Come From Away Cast'],
  ['Somewhere in the Middle of Nowhere', 'Come From Away Cast'],

  // ─── AVENUE Q ─────────────────────────────────────────────────────
  ['The Internet Is for Porn', 'Avenue Q Cast'],
  ['If You Were Gay', 'Avenue Q Cast'],
  ['There\'s a Fine, Fine Line', 'Stephanie D\'Abruzzo'],

  // ─── DIVERSE PICKS ────────────────────────────────────────────────
  ['Somewhere Over the Rainbow', 'Judy Garland'],
  ['New York, New York', 'Frank Sinatra'],
  ['Springtime for Hitler', 'The Producers Cast'],
  ['Ease on Down the Road', 'Diana Ross & Michael Jackson'],
  ['Corner of the Sky', 'John Rubinstein'],
  ['I Am What I Am', 'George Hearn'],
  ['Aquarius / Let the Sunshine In', 'The 5th Dimension'],
  ['Cabaret Overture', 'Cabaret Cast'],
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

console.log(`Broadway pack additions:`);
console.log(`  Proposed:  ${ADDITIONS.length}`);
console.log(`  Added:     ${dedupedAdditions.length}`);
console.log(`  Duplicates (skipped): ${skipped.length}`);
console.log(`  New total: ${existing.length + dedupedAdditions.length} tracks`);
if (skipped.length > 0) {
  console.log(`\nSkipped (already in pack):`);
  for (const s of skipped) console.log(`  - ${s}`);
}
