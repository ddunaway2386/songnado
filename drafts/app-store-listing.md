# Songnado — App Store listing copy (draft)

Numbers below are verified against the shipped packs, not estimates:
**14 packs, ~6,300 tracks** (2,763 curated + 3,533 from live Deezer
playlists), 10 free packs and 4 unlockable.

Constraints this copy respects:
- No mention of Spotify — it's disabled at the build level, and claiming
  it would fail Guideline 2.3.1
- No implication of a Deezer partnership or endorsement
- No prices or subscriptions — there's no IAP in v1
- Buzz mode is marked ⚠️ throughout; delete those blocks if the test
  says hide it

---

## App name (30 max)

```
Songnado
```

## Subtitle (30 max)

Three options, in my order of preference:

```
Music trivia party game
```
*23 chars. Plain and searchable — "music trivia" and "party game" are
both terms people actually type.*

```
Name that tune, with teams
```
*26 chars. Warmer, but "name that tune" is a crowded search term.*

```
The music guessing party game
```
*29 chars. Weakest — "guessing" is vaguer than "trivia".*

## Promotional text (170 max, editable without review)

```
Six decades of music, movie and TV themes, Broadway and more. Pick your packs, split into teams, and find out who really knows their music.
```
*138 chars. This field can be changed any time without resubmitting —
good place for seasonal notes later ("New: Christmas pack").*

---

## Description (4,000 max)

```
Songnado turns any gathering into a music trivia showdown.

Play a 30-second clip, and the first team to name the song and the artist takes the round. That's it. No signup, no account, no setup beyond picking your packs and naming your teams.

FOUR WAYS TO PLAY

Classic — Take turns. Score for the song, the artist, or both. First team to the target score wins.

Blitz — The clock is the scoreboard. Answer faster, score higher. A 30-second timer turns every round into a sprint.

Elimination — Draft your board before you play. Protect the packs you're strong on, eliminate the ones you're not, then race to clear your grid. Nail both the song and the artist and you go again.

⚠️ Buzz — Every team on their own phone. One device hosts, everyone else joins with a room code, and the first thumb on the buzzer gets the answer. Guess wrong and you're out for the round while the music keeps playing.

14 MUSIC PACKS, OVER 6,000 SONGS

Six decades of hits — 70s, 80s, 90s, 2000s, 2010s and 2020s
Movie Soundtracks and Songs from Movies
Classic and Modern TV Themes
Broadway
Wedding and Road Trip
Billboard #1's

Mix as many packs as you like. A round pulls from whatever you've chosen, so a game can range from Motown to Megan Thee Stallion or stay firmly in one era.

BUILT FOR ACTUAL PARTIES

One phone, passed around — no app to install on anyone else's device (except Buzz, if you want the buzzer race).

Up to six teams, named however you like.

Rounds take seconds. Games take as long as you want.

Hosts get an undo button, because someone always gets shortchanged.

Family-friendly by default. Explicit tracks are filtered out, so you can hand it to anyone.

Songnado is not affiliated with or endorsed by any music service. Audio previews are 30-second clips streamed from Deezer's public catalogue, so an internet connection is required.
```

*~1,750 characters. Well under the limit — deliberately. Nobody reads a
4,000-character store description, and the first three lines are what
actually shows before "more".*

**If Buzz gets hidden**, delete the ⚠️ paragraph, change "FOUR WAYS TO
PLAY" to "THREE WAYS TO PLAY", and drop the parenthetical in the
"One phone, passed around" line.

---

## Keywords (100 max, comma-separated, NO spaces after commas)

```
music,trivia,party,game,quiz,song,guess,name that tune,team,family,80s,90s,karaoke,playlist
```
*99 chars. Notes on the choices:*

- Don't repeat words already in the app name or subtitle — Apple indexes
  those separately, so "Songnado" and "trivia" would be wasted here if
  the subtitle carries them. (Subtitle above uses "music trivia party
  game", so those four are arguably redundant — see the alternative
  below.)
- No spaces after commas: spaces consume characters.
- "karaoke" is a deliberate stretch — high-traffic term, adjacent
  intent, and people searching it are often looking for exactly this
  kind of group music activity.

**Alternative if you use the "Music trivia party game" subtitle** —
frees up 4 words:

```
quiz,song,guess,name that tune,team,family,friends,80s,90s,2000s,karaoke,playlist,pop,movie
```

---

## Other required fields

| Field | Value |
|---|---|
| **Primary category** | Games → Trivia |
| **Secondary category** | Games → Music |
| **Age rating** | 4+ — explicit tracks are filtered, no gambling, no user content |
| **Support URL** | https://ddunaway2386.github.io/songnado/ *(needs a contact route added)* |
| **Marketing URL** | Optional — same site |
| **Privacy policy** | https://ddunaway2386.github.io/songnado/privacy/ |
| **Copyright** | 2026 Daniel Dunaway |

## Privacy nutrition label

Sentry was added recently, so this is **not** what it would have been a
week ago:

- **Diagnostics → Crash Data** — collected, not linked to identity, not
  used for tracking
- **Diagnostics → Performance Data** — collected, same treatment
- Everything else (teams, scores, pack choices) is local-only
  AsyncStorage and is **not** collected
- No tracking, no ad identifiers, no third-party analytics beyond Sentry

## App Review notes

```
Songnado is a local party game — one device, teams take turns. No account or login is required.

Audio is 30-second preview clips fetched from Deezer's public API at play time. Songnado is not affiliated with or endorsed by Deezer.

To try it: New Game → choose any mode → accept the default teams → select one or more packs → Start. An internet connection is required for audio.

Buzz mode (if visible) is optional and needs two or more devices on the same Wi-Fi network; the other modes work on a single device.
```
