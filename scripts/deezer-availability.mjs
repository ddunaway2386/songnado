#!/usr/bin/env node
/**
 * Deezer availability validator for Songnado pack curation planning.
 *
 * Hits Deezer's public search API for ~300 candidate "must-have" tracks
 * across 20 planned pack categories. For each:
 *  - Confirms whether the track exists in Deezer's catalog
 *  - Confirms whether a 30-second `preview` MP3 URL is available (some
 *    tracks exist but lack a preview — useless for our game)
 *  - Records the Deezer track ID + preview URL for use as a seed
 *
 * Outputs:
 *  - scripts/deezer-availability-report.json (full structured data)
 *  - scripts/deezer-availability-report.csv (human-friendly spreadsheet)
 *  - Live console output with per-category summaries
 *
 * Run from project root:
 *   node scripts/deezer-availability.mjs
 *
 * Total runtime: ~2-3 minutes (rate-limited to 10 req/s to be polite).
 *
 * The output answers the most important pre-curation question: "which
 * planned packs will actually work on Deezer, and which need substitutions
 * or should be cut?" Categories under 80% availability are red-flagged
 * for the family curation team's planning session.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Test tracks — 15 must-have tracks per pack category.
// Sourced from the deep-research playlist plan; aim is "if these aren't on
// Deezer, the pack doesn't work."
// ============================================================================

const TRACKS_BY_CATEGORY = {
  // ===== v1 LAUNCH HEROES =====

  '90s Mega Hits': [
    ['Smells Like Teen Spirit', 'Nirvana'],
    ['Wonderwall', 'Oasis'],
    ['...Baby One More Time', 'Britney Spears'],
    ['Killing Me Softly With His Song', 'Fugees'],
    ['I Want It That Way', 'Backstreet Boys'],
    ['No Scrubs', 'TLC'],
    ['Black Hole Sun', 'Soundgarden'],
    ['Vogue', 'Madonna'],
    ['Genie in a Bottle', 'Christina Aguilera'],
    ['Bitter Sweet Symphony', 'The Verve'],
    ['Wannabe', 'Spice Girls'],
    ['Tubthumping', 'Chumbawamba'],
    ['Mambo No. 5', 'Lou Bega'],
    ['Macarena', 'Los del Río'],
    ['Livin\' La Vida Loca', 'Ricky Martin'],
  ],

  '80s Mega Hits': [
    ['Sweet Child O\' Mine', 'Guns N\' Roses'],
    ['Take On Me', 'a-ha'],
    ['Don\'t Stop Believin\'', 'Journey'],
    ['Livin\' on a Prayer', 'Bon Jovi'],
    ['Billie Jean', 'Michael Jackson'],
    ['Like a Virgin', 'Madonna'],
    ['Every Breath You Take', 'The Police'],
    ['With or Without You', 'U2'],
    ['Eye of the Tiger', 'Survivor'],
    ['Africa', 'Toto'],
    ['Total Eclipse of the Heart', 'Bonnie Tyler'],
    ['Tainted Love', 'Soft Cell'],
    ['Walking on Sunshine', 'Katrina and the Waves'],
    ['Girls Just Want to Have Fun', 'Cyndi Lauper'],
    ['Take My Breath Away', 'Berlin'],
  ],

  'Wedding Reception Bangers': [
    ['Mr. Brightside', 'The Killers'],
    ['I Wanna Dance with Somebody', 'Whitney Houston'],
    ['Uptown Funk', 'Mark Ronson'],
    ['Shut Up and Dance', 'WALK THE MOON'],
    ['Cha Cha Slide', 'DJ Casper'],
    ['Cupid Shuffle', 'Cupid'],
    ['Y.M.C.A.', 'Village People'],
    ['We Are Family', 'Sister Sledge'],
    ['September', 'Earth, Wind & Fire'],
    ['Shape of You', 'Ed Sheeran'],
    ['Yeah!', 'Usher'],
    ['Sweet Caroline', 'Neil Diamond'],
    ['Dancing Queen', 'ABBA'],
    ['(I\'ve Had) The Time of My Life', 'Bill Medley'],
    ['Single Ladies (Put a Ring on It)', 'Beyoncé'],
  ],

  'Road Trip Sing-Alongs': [
    ['Bohemian Rhapsody', 'Queen'],
    ['Hey Jude', 'The Beatles'],
    ['Take Me Home, Country Roads', 'John Denver'],
    ['Free Fallin\'', 'Tom Petty'],
    ['Life Is a Highway', 'Tom Cochrane'],
    ['Don\'t Stop', 'Fleetwood Mac'],
    ['American Pie', 'Don McLean'],
    ['Tiny Dancer', 'Elton John'],
    ['Wagon Wheel', 'Old Crow Medicine Show'],
    ['Build Me Up Buttercup', 'The Foundations'],
    ['I\'m Yours', 'Jason Mraz'],
    ['Mr. Brightside', 'The Killers'],
    ['Piano Man', 'Billy Joel'],
    ['Lean on Me', 'Bill Withers'],
    ['Africa', 'Toto'],
  ],

  // ===== v1.1 EXPANSION =====

  '70s Classic Rock': [
    ['Stairway to Heaven', 'Led Zeppelin'],
    ['Hotel California', 'Eagles'],
    ['Free Bird', 'Lynyrd Skynyrd'],
    ['More Than a Feeling', 'Boston'],
    ['Carry On Wayward Son', 'Kansas'],
    ['Dream On', 'Aerosmith'],
    ['Black Dog', 'Led Zeppelin'],
    ['Won\'t Get Fooled Again', 'The Who'],
    ['Sweet Home Alabama', 'Lynyrd Skynyrd'],
    ['Smoke on the Water', 'Deep Purple'],
    ['Layla', 'Derek and the Dominos'],
    ['Brown Sugar', 'The Rolling Stones'],
    ['Comfortably Numb', 'Pink Floyd'],
    ['Walk This Way', 'Aerosmith'],
    ['Won\'t Get Fooled Again', 'The Who'],
  ],

  '60s Motown & Soul': [
    ['My Girl', 'The Temptations'],
    ['I Heard It Through the Grapevine', 'Marvin Gaye'],
    ['Respect', 'Aretha Franklin'],
    ['Stop! In the Name of Love', 'The Supremes'],
    ['(Sittin\' On) The Dock of the Bay', 'Otis Redding'],
    ['Ain\'t No Mountain High Enough', 'Marvin Gaye'],
    ['Dancing in the Street', 'Martha and the Vandellas'],
    ['I Can\'t Help Myself (Sugar Pie, Honey Bunch)', 'Four Tops'],
    ['My Guy', 'Mary Wells'],
    ['You Can\'t Hurry Love', 'The Supremes'],
    ['Higher and Higher', 'Jackie Wilson'],
    ['ABC', 'The Jackson 5'],
    ['I Want You Back', 'The Jackson 5'],
    ['Knock on Wood', 'Eddie Floyd'],
    ['What Becomes of the Brokenhearted', 'Jimmy Ruffin'],
  ],

  'Disney Animated Songs': [
    ['Let It Go', 'Idina Menzel'],
    ['A Whole New World', 'Peabo Bryson'],
    ['Circle of Life', 'Carmen Twillie'],
    ['Under the Sea', 'Samuel E. Wright'],
    ['Beauty and the Beast', 'Angela Lansbury'],
    ['How Far I\'ll Go', 'Auli\'i Cravalho'],
    ['Hakuna Matata', 'Nathan Lane'],
    ['Friend Like Me', 'Robin Williams'],
    ['Part of Your World', 'Jodi Benson'],
    ['You\'ll Be in My Heart', 'Phil Collins'],
    ['Reflection', 'Lea Salonga'],
    ['Almost There', 'Anika Noni Rose'],
    ['Try Everything', 'Shakira'],
    ['Remember Me', 'Miguel'],
    ['We Don\'t Talk About Bruno', 'Carolina Gaitán'],
  ],

  'One Hit Wonders': [
    ['Take On Me', 'a-ha'],
    ['Come On Eileen', 'Dexys Midnight Runners'],
    ['99 Luftballons', 'Nena'],
    ['Macarena', 'Los del Río'],
    ['I\'m Too Sexy', 'Right Said Fred'],
    ['Tubthumping', 'Chumbawamba'],
    ['Mambo No. 5', 'Lou Bega'],
    ['Bitter Sweet Symphony', 'The Verve'],
    ['What\'s Up?', '4 Non Blondes'],
    ['Who Let the Dogs Out', 'Baha Men'],
    ['Lovefool', 'The Cardigans'],
    ['Spirit in the Sky', 'Norman Greenbaum'],
    ['Walking on Sunshine', 'Katrina and the Waves'],
    ['Cotton Eye Joe', 'Rednex'],
    ['Barbie Girl', 'Aqua'],
  ],

  'Country Crossover Hits': [
    ['Cruise', 'Florida Georgia Line'],
    ['Before He Cheats', 'Carrie Underwood'],
    ['Wagon Wheel', 'Darius Rucker'],
    ['Need You Now', 'Lady A'],
    ['Friends in Low Places', 'Garth Brooks'],
    ['Man! I Feel Like a Woman!', 'Shania Twain'],
    ['Achy Breaky Heart', 'Billy Ray Cyrus'],
    ['The Devil Went Down to Georgia', 'Charlie Daniels Band'],
    ['I Walk the Line', 'Johnny Cash'],
    ['Jolene', 'Dolly Parton'],
    ['Body Like a Back Road', 'Sam Hunt'],
    ['Tennessee Whiskey', 'Chris Stapleton'],
    ['Old Town Road', 'Lil Nas X'],
    ['9 to 5', 'Dolly Parton'],
    ['Boot Scootin\' Boogie', 'Brooks & Dunn'],
  ],

  'Hip-Hop Golden Era (88-98)': [
    ['Juicy', 'The Notorious B.I.G.'],
    ['California Love', '2Pac'],
    ['C.R.E.A.M.', 'Wu-Tang Clan'],
    ['Nuthin\' But a \'G\' Thang', 'Dr. Dre'],
    ['Fight the Power', 'Public Enemy'],
    ['It Was a Good Day', 'Ice Cube'],
    ['Gin and Juice', 'Snoop Dogg'],
    ['Mama Said Knock You Out', 'LL Cool J'],
    ['Push It', 'Salt-N-Pepa'],
    ['Bonita Applebum', 'A Tribe Called Quest'],
    ['Can I Kick It?', 'A Tribe Called Quest'],
    ['Rapper\'s Delight', 'The Sugarhill Gang'],
    ['Children\'s Story', 'Slick Rick'],
    ['Hypnotize', 'The Notorious B.I.G.'],
    ['Wu-Tang Clan Ain\'t Nuthing ta F\' Wit', 'Wu-Tang Clan'],
  ],

  '2000s Pop Punk & Emo': [
    ['Sugar, We\'re Goin Down', 'Fall Out Boy'],
    ['Welcome to the Black Parade', 'My Chemical Romance'],
    ['Misery Business', 'Paramore'],
    ['American Idiot', 'Green Day'],
    ['In the End', 'Linkin Park'],
    ['The Middle', 'Jimmy Eat World'],
    ['All the Small Things', 'blink-182'],
    ['Mr. Brightside', 'The Killers'],
    ['Helena', 'My Chemical Romance'],
    ['Dirty Little Secret', 'The All-American Rejects'],
    ['Move Along', 'The All-American Rejects'],
    ['I Write Sins Not Tragedies', 'Panic! at the Disco'],
    ['Ocean Avenue', 'Yellowcard'],
    ['Vindicated', 'Dashboard Confessional'],
    ['crushcrushcrush', 'Paramore'],
  ],

  'Yacht Rock': [
    ['Rosanna', 'Toto'],
    ['Africa', 'Toto'],
    ['Reminiscing', 'Little River Band'],
    ['Sailing', 'Christopher Cross'],
    ['What a Fool Believes', 'The Doobie Brothers'],
    ['Peg', 'Steely Dan'],
    ['Reelin\' in the Years', 'Steely Dan'],
    ['Baker Street', 'Gerry Rafferty'],
    ['Lowdown', 'Boz Scaggs'],
    ['Lido Shuffle', 'Boz Scaggs'],
    ['I Keep Forgettin\' (Every Time You\'re Near)', 'Michael McDonald'],
    ['Goodbye Stranger', 'Supertramp'],
    ['The Logical Song', 'Supertramp'],
    ['Biggest Part of Me', 'Ambrosia'],
    ['Steal Away', 'Robbie Dupree'],
  ],

  // ===== v1.2 + FUTURE =====

  '90s Hip-Hop & R&B': [
    ['Waterfalls', 'TLC'],
    ['Killing Me Softly With His Song', 'Fugees'],
    ['No Diggity', 'Blackstreet'],
    ['End of the Road', 'Boyz II Men'],
    ['Gangsta\'s Paradise', 'Coolio'],
    ['Fantasy', 'Mariah Carey'],
    ['Doo Wop (That Thing)', 'Lauryn Hill'],
    ['U Can\'t Touch This', 'MC Hammer'],
    ['Insane in the Brain', 'Cypress Hill'],
    ['I\'ll Make Love to You', 'Boyz II Men'],
    ['Bills, Bills, Bills', 'Destiny\'s Child'],
    ['Tha Crossroads', 'Bone Thugs-N-Harmony'],
    ['Mo Money Mo Problems', 'The Notorious B.I.G.'],
    ['Vision of Love', 'Mariah Carey'],
    ['Creep', 'TLC'],
  ],

  'K-Pop Essentials': [
    ['Gangnam Style', 'PSY'],
    ['Dynamite', 'BTS'],
    ['Butter', 'BTS'],
    ['Boy with Luv', 'BTS'],
    ['Kill This Love', 'BLACKPINK'],
    ['How You Like That', 'BLACKPINK'],
    ['DDU-DU DDU-DU', 'BLACKPINK'],
    ['Fancy', 'TWICE'],
    ['What is Love?', 'TWICE'],
    ['Mic Drop', 'BTS'],
    ['Fake Love', 'BTS'],
    ['Lovesick Girls', 'BLACKPINK'],
    ['Gee', 'Girls\' Generation'],
    ['BANG BANG BANG', 'BIGBANG'],
    ['Sorry, Sorry', 'Super Junior'],
  ],

  'Anime Openings & OSTs': [
    ['A Cruel Angel\'s Thesis', 'Yoko Takahashi'],
    ['Tank!', 'The Seatbelts'],
    ['Unravel', 'TK from Ling Tosite Sigure'],
    ['Guren no Yumiya', 'Linked Horizon'],
    ['We Are!', 'Hiroshi Kitadani'],
    ['Pokémon Theme', 'Jason Paige'],
    ['Lilium', 'Kumiko Noma'],
    ['Naruto Main Theme', 'Toshio Masuda'],
    ['Again', 'YUI'],
    ['Sis Puella Magica!', 'Yuki Kajiura'],
    ['Toki wo Kizamu Uta', 'Lia'],
    ['Renai Circulation', 'Kana Hanazawa'],
    ['Crossing Field', 'LiSA'],
    ['Hare Hare Yukai', 'Aya Hirano'],
    ['Blue Bird', 'Ikimono-gakari'],
  ],

  'Christmas & Holiday': [
    ['All I Want for Christmas Is You', 'Mariah Carey'],
    ['Last Christmas', 'Wham!'],
    ['White Christmas', 'Bing Crosby'],
    ['Rockin\' Around the Christmas Tree', 'Brenda Lee'],
    ['Jingle Bell Rock', 'Bobby Helms'],
    ['Have Yourself a Merry Little Christmas', 'Frank Sinatra'],
    ['It\'s Beginning to Look a Lot Like Christmas', 'Michael Bublé'],
    ['Santa Tell Me', 'Ariana Grande'],
    ['Mistletoe', 'Justin Bieber'],
    ['Underneath the Tree', 'Kelly Clarkson'],
    ['Feliz Navidad', 'José Feliciano'],
    ['Wonderful Christmastime', 'Paul McCartney'],
    ['The Christmas Song', 'Nat King Cole'],
    ['Sleigh Ride', 'The Ronettes'],
    ['Do They Know It\'s Christmas?', 'Band Aid'],
  ],

  'Reggaeton & Latin Pop': [
    ['Despacito', 'Luis Fonsi'],
    ['Bailando', 'Enrique Iglesias'],
    ['La Tortura', 'Shakira'],
    ['Gasolina', 'Daddy Yankee'],
    ['Hips Don\'t Lie', 'Shakira'],
    ['Mi Gente', 'J Balvin'],
    ['Sin Pijama', 'Becky G'],
    ['Taki Taki', 'DJ Snake'],
    ['I Like It', 'Cardi B'],
    ['Vivir Mi Vida', 'Marc Anthony'],
    ['Tusa', 'KAROL G'],
    ['Yo Perreo Sola', 'Bad Bunny'],
    ['Échame La Culpa', 'Luis Fonsi'],
    ['Suavemente', 'Elvis Crespo'],
    ['Bichota', 'KAROL G'],
  ],

  'Christian & CCM': [
    ['Amazing Grace (My Chains Are Gone)', 'Chris Tomlin'],
    ['How Great Is Our God', 'Chris Tomlin'],
    ['Oceans (Where Feet May Fail)', 'Hillsong United'],
    ['10,000 Reasons (Bless the Lord)', 'Matt Redman'],
    ['Reckless Love', 'Cory Asbury'],
    ['Good, Good Father', 'Chris Tomlin'],
    ['What a Beautiful Name', 'Hillsong Worship'],
    ['Lord, I Need You', 'Matt Maher'],
    ['Way Maker', 'Sinach'],
    ['Holy Spirit', 'Francesca Battistelli'],
    ['Build My Life', 'Pat Barrett'],
    ['The Blessing', 'Kari Jobe'],
    ['Graves Into Gardens', 'Elevation Worship'],
    ['Hosanna', 'Hillsong United'],
    ['Open the Eyes of My Heart', 'Michael W. Smith'],
  ],

  'Bollywood Hits': [
    ['Tum Hi Ho', 'Arijit Singh'],
    ['Kal Ho Naa Ho', 'Sonu Nigam'],
    ['Chaiyya Chaiyya', 'Sukhwinder Singh'],
    ['Jai Ho', 'A.R. Rahman'],
    ['Lungi Dance', 'Yo Yo Honey Singh'],
    ['Senorita', 'Farhan Akhtar'],
    ['Dilbar', 'Neha Kakkar'],
    ['Channa Mereya', 'Arijit Singh'],
    ['Tera Ban Jaunga', 'Akhil Sachdeva'],
    ['Naatu Naatu', 'Rahul Sipligunj'],
    ['Why This Kolaveri Di', 'Dhanush'],
    ['Pehla Nasha', 'Udit Narayan'],
    ['Ainvayi Ainvayi', 'Sunidhi Chauhan'],
    ['Tujhe Dekha To Ye Jana Sanam', 'Lata Mangeshkar'],
    ['Mehndi Laga Ke Rakhna', 'Lata Mangeshkar'],
  ],

  'Video Game OSTs': [
    ['Megalovania', 'Toby Fox'],
    ['Snake Eater', 'Cynthia Harrell'],
    ['One-Winged Angel', 'Nobuo Uematsu'],
    ['To Zanarkand', 'Nobuo Uematsu'],
    ['Halo Theme', 'Martin O\'Donnell'],
    ['Still Alive', 'Jonathan Coulton'],
    ['Want You Gone', 'Ellen McLain'],
    ['Baba Yetu', 'Christopher Tin'],
    ['Hopes and Dreams', 'Toby Fox'],
    ['Eyes on Me', 'Faye Wong'],
    ['Aerith\'s Theme', 'Nobuo Uematsu'],
    ['Sweden', 'C418'],
    ['Wet Hands', 'C418'],
    ['Battle Theme', 'Koji Kondo'],
    ['Dearly Beloved', 'Yoko Shimomura'],
  ],
};

// ============================================================================
// Search + match logic
// ============================================================================

const FETCH_TIMEOUT_MS = 10_000;
const REQUEST_DELAY_MS = 100; // 10 req/s — well under Deezer's 50 req/s limit

/** Normalize a string for fuzzy comparison — lowercase, strip punctuation. */
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Are two strings "the same" by loose comparison? */
function looselyMatches(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function searchDeezer(title, artist) {
  const q = `track:"${title}" artist:"${artist}"`;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { found: false, reason: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      return { found: false, reason: 'no results' };
    }

    // Pick the best match — prefer one with a preview URL and tight title/artist match.
    let best = null;
    let bestScore = -1;
    for (const track of data.data) {
      const titleOk = looselyMatches(track.title, title);
      const artistOk = looselyMatches(track.artist.name, artist);
      const hasPreview = !!track.preview;
      // Score: title match (3) + artist match (2) + preview (5).
      // Preview is the biggest factor — track without preview is useless to us.
      const score =
        (titleOk ? 3 : 0) + (artistOk ? 2 : 0) + (hasPreview ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = track;
      }
    }

    if (!best || !looselyMatches(best.title, title) || !looselyMatches(best.artist.name, artist)) {
      return { found: false, reason: 'no title+artist match' };
    }

    if (!best.preview) {
      return {
        found: false,
        reason: 'no preview',
        deezerId: best.id,
        deezerTitle: best.title,
        deezerArtist: best.artist.name,
      };
    }

    return {
      found: true,
      deezerId: best.id,
      deezerTitle: best.title,
      deezerArtist: best.artist.name,
      previewUrl: best.preview,
      durationSec: best.duration,
    };
  } catch (err) {
    return { found: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Main
// ============================================================================

function statusBadge(pct) {
  if (pct >= 80) return '✅ shippable';
  if (pct >= 60) return '⚠️  needs work';
  return '❌ at risk';
}

async function main() {
  console.log('Songnado — Deezer Availability Validator');
  console.log('==========================================\n');
  const totalCategories = Object.keys(TRACKS_BY_CATEGORY).length;
  const totalTracks = Object.values(TRACKS_BY_CATEGORY).reduce(
    (n, arr) => n + arr.length,
    0
  );
  console.log(`Checking ${totalTracks} tracks across ${totalCategories} categories...\n`);

  const results = {};
  let categoryIndex = 0;

  for (const [category, tracks] of Object.entries(TRACKS_BY_CATEGORY)) {
    categoryIndex++;
    console.log(`\n[${categoryIndex}/${totalCategories}] ${category}`);
    console.log('  ' + '-'.repeat(category.length));

    const categoryResults = [];
    for (const [title, artist] of tracks) {
      const result = await searchDeezer(title, artist);
      categoryResults.push({ title, artist, ...result });
      const mark = result.found ? '✓' : '✗';
      const note = result.found ? '' : `  (${result.reason})`;
      console.log(`    ${mark} ${title} — ${artist}${note}`);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    const found = categoryResults.filter((r) => r.found).length;
    const total = categoryResults.length;
    const pct = Math.round((found / total) * 100);
    console.log(`    ${found}/${total} (${pct}%) — ${statusBadge(pct)}`);

    results[category] = {
      total,
      found,
      availabilityPct: pct,
      tracks: categoryResults,
    };
  }

  // Sorted summary
  console.log('\n\n=== AVAILABILITY SUMMARY (sorted) ===\n');
  const sorted = Object.entries(results).sort(
    (a, b) => b[1].availabilityPct - a[1].availabilityPct
  );
  for (const [category, data] of sorted) {
    const label = category.padEnd(36);
    const pct = String(data.availabilityPct).padStart(3) + '%';
    console.log(`  ${label} ${pct}  ${statusBadge(data.availabilityPct)}`);
  }

  // Aggregate stats
  const grandTotal = Object.values(results).reduce((n, r) => n + r.total, 0);
  const grandFound = Object.values(results).reduce((n, r) => n + r.found, 0);
  const overallPct = Math.round((grandFound / grandTotal) * 100);
  console.log(`\n  OVERALL: ${grandFound}/${grandTotal} (${overallPct}%)\n`);

  // Write reports
  const scriptsDir = __dirname;
  try {
    mkdirSync(scriptsDir, { recursive: true });
  } catch {}

  const jsonPath = join(scriptsDir, 'deezer-availability-report.json');
  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${jsonPath}`);

  // CSV — flat list, one row per track
  let csv = 'Category,Title,Artist,Found,DeezerId,DeezerTitle,DeezerArtist,PreviewUrl,DurationSec,Reason\n';
  for (const [category, data] of Object.entries(results)) {
    for (const t of data.tracks) {
      const fields = [
        category,
        t.title,
        t.artist,
        t.found,
        t.deezerId || '',
        t.deezerTitle || '',
        t.deezerArtist || '',
        t.previewUrl || '',
        t.durationSec || '',
        t.reason || '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      csv += fields.join(',') + '\n';
    }
  }
  const csvPath = join(scriptsDir, 'deezer-availability-report.csv');
  writeFileSync(csvPath, csv);
  console.log(`Wrote ${csvPath}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
