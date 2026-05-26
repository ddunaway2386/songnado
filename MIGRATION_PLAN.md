# Songster — FlutterFlow → Expo Migration Plan

Reference: `flutterflow-reference/dan_songster_3/` (read-only).
Target: `songster-v2/` (React Native + Expo, empty).

> Naming note: the user's brief said "songgame-v2" but the actual target directory is `songster-v2`. Plan written against the latter.

---

## 1. Game mechanics

### 1.1 Shape of the game
Songster is a **host-moderated, pass-and-play party quiz**. Teams take turns, the app plays a 30-second Deezer preview, and the active team shouts their guess. The player holding the phone then toggles two switches — "song correct?" and "artist correct?" — and the app awards/deducts points. It is *not* a single-player multiple-choice game; there are no distractors, no free-text input, no answer validation by the app.

### 1.2 Categories (11 hardcoded Deezer playlists, plus user-added)
Defined in `app_state.dart:396-420` as `allAvailablePlaylists`. In v2 these ship as seed data; users can also add their own via the **Add Playlist** screen (§7 Phase 4).

| Name | Deezer playlist ID | Tracks |
|---|---|---|
| 1970's | 13700823521 | 461 |
| 1980's | 13700820281 | 562 |
| 1990's | 13707544281 | 556 |
| 2000's | 13700823101 | 913 |
| 2010's | 13700823021 | 605 |
| 2020's | 13700822841 | 103 |
| Billboard #1's | 13700822301 | 972 |
| Soundtracks | 13700843081 | 803 |
| Broadway | 13889425981 | 450 |
| TV Themes | 13889467621 | 249 |
| Movie Songs | 13904299281 | 316 |

Track counts are baked in, not fetched — saves a round-trip but will drift if Deezer's playlists change. In v2, the built-in list ships as seed data and the app refreshes `totalTracks` from Deezer on first load so the numbers stay accurate without code changes.


### 1.3 Three game modes
From `app_state.dart:487-494`:
- **Classic** — teams rotate, score accrues, first to a target score (slider, 0–20 in UI) wins. Playlist pool is whatever the host picked on the setup screen (up to 8).
- **Classic Timed** — same as Classic with a visible per-round timer (separate page `pages/classic_timed/`).
- **Elimination** — each team must "clear" every playlist; clearing = correctly guessing a song from that playlist. Completed playlists tracked on `TeamDataStruct.completedPlaylists`.

### 1.4 Round flow (Classic, `pages/classic/classic_widget.dart`)
1. Host picks the next playlist from the grid (`gridview_playlist` component).
2. `getNextIndexForPlaylist` picks a random track index that hasn't been played in this session (see §3.3).
3. App hits `GetPlaylistTracksCall` with that index; pulls `title`, `artist.name`, `preview`, `album.cover_big`.
4. **Retry loop (up to 10×)** — some Deezer tracks have `preview: null`. If so, pick another index and try again (`classic_widget.dart:163`).
5. Preview URL written to `FFAppState().previewSong`. Host taps play → `just_audio`'s `AudioPlayer.setUrl(url).then(play())` (`classic_widget.dart:802-809`).
6. `recordPlayTime` stamps `DateTime.now()`; `updatePlayDuration` writes elapsed seconds into `FFAppState().lastPlayedSeconds` so scoring can use it.
7. Host flips the two correctness switches, taps a team button → `applyGuessResult(songCorrect, artistCorrect, teamIndex)`.
8. If the team refuses to guess, `applyNoAnswerPenalty` deducts 30 flat.
9. Round ends, next team's turn.

### 1.5 Scoring (exact formula from `apply_guess_result.dart:26-43`)
```
base =  3  if song AND artist correct
base =  1  if exactly one correct
base = -30 if both wrong
roundPts = base * (30 - timeUsed)
teamScore += roundPts
```
No-answer penalty (`apply_no_answer_penalty.dart`): `teamScore -= 30` (flat, no time multiplier).

Implementation notes:
- `timeUsed` is "seconds elapsed while the 30s preview was playing" — the **timer must cap at 30** (stop counting when audio ends), so `(30 - timeUsed)` stays in `[0, 30]`. Full 30s elapsed → bonus multiplier of 0 → 0 points that round. No negative multipliers.
- Scores are `double` in Dart but only ever integer-valued. Keep `number` in TS; no need for decimals.

### 1.6 Win condition
Target score is a slider value on the setup page (0–20). End-of-game screen is `pages/game_over/`. Elimination mode's win condition is implicit: team with all playlists in `completedPlaylists` first.

---

## 2. Deezer integration

### 2.1 Endpoints (public API, no auth)
From `backend/api_requests/api_calls.dart`:
```
GET https://api.deezer.com/playlist/{playlistId}?index={i}&limit=1
GET https://api.deezer.com/playlist/{playlistId}/tracks?index={i}&limit=1
```
No API key, no OAuth. `ApiManager` is FlutterFlow's thin `http` wrapper — in RN this is just `fetch`.

### 2.2 Response fields used
- `data[0].title` / `title_short` — song name
- `data[0].artist.name` — artist
- `data[0].preview` — **30-second MP3 URL** (may be null, see §1.4 retry)
- `data[0].album.cover_small` / `cover_big` — album art

### 2.3 Legacy per-decade API wrappers
`api_calls.dart` has `GeteightiesCall`, `GetninetiesCall`, … one per decade, each with a hardcoded playlist ID. These duplicate `GetPlaylistTracksCall`. **Do not port** — the generic version is all the RN app needs.

### 2.4 Distractors / multiple choice
**There are none.** Don't spend time in the migration looking for them — the UX is host-moderated toggles. If we want to add proper single-player MCQ later, that's a new feature, not a port.

### 2.5 Audio library mapping
`just_audio` (`AudioPlayer` + `setUrl` + `play`/`stop`) → **`expo-av`** (`Audio.Sound.createAsync({ uri }, { shouldPlay: true })`). Both handle remote HTTPS MP3s out of the box; preview URLs work unmodified. `expo-av` is moving to `expo-audio` in newer Expo SDKs — pick whichever matches the SDK version we're on.

---

## 3. State & data

### 3.1 FFAppState (singleton, ~50 fields, `app_state.dart`)
Groups into:
- **Setup:** `selectedTeamCount`, `selectedGamePlaylists`, `currentGameMode`, `gamePhase`
- **Active game:** `gameTeams`, `activeTeam`, `currentTeamIndex`, `currentPlayingPlaylist`
- **Current round:** `lastTitle`, `lastArtist`, `lastImageUrl`, `previewSong`, `lastPlayedSeconds`, `roundPoints`, `songCorrect`, `artistCorrect`
- **Scoring:** `teamScores: List<double>` (canonical) + `team1Score..team6Score` (legacy duplicates — drop these in v2)
- **Playlist rotation:** `allAvailablePlaylists`, `selectedPlaylistsForGame`, `playedIndicesByPlaylist`, `playlistDidReset`
- **UI state:** `showSongInfo`, `displaySeconds`, `audioTime`, `songStopped`

### 3.2 Data structs (`backend/schema/structs/`)
- `PlaylistDataStruct { playlistId, playlistName, imageUrl, totalTracks, playedIndices: List<int>, dummyField }`
- `TeamDataStruct { teamName, score, id, index, completedPlaylists: List<String> }`
- `SongsStruct { title, titleShort, artist: ArtistStruct, preview, md5Image, position, rank }`
- `ArtistStruct { name, id, … }`
- `GameModeStruct { name, rules, refNumber }`

Convert 1:1 to TypeScript interfaces. `dummyField` on `PlaylistDataStruct` is a FlutterFlow workaround (empty struct serialization); drop it.

### 3.3 The "no-repeat" song selector (`get_next_index_for_playlist.dart`)
Tracks `playedIndices: number[]` per playlist, picks a random index from `[0..totalTracks) \ playedIndices`, appends the choice, persists, and when the pool empties flips `playlistDidReset = true` and starts over. Port behavior exactly — the reset flag is used in the UI to show a "🔄 played all songs, starting over" toast.

### 3.4 Firebase / Firestore
Configured (`firebase_core`, `cloud_firestore`) with schema files present but **not read or written from in gameplay code**. Treat as dead weight — skip in v2. If we want cloud high scores later we can add it back cleanly.

---

## 4. Persistence

Everything in `SharedPreferences`, no backend:
- `ff_defaultGameMode` — last-used game mode (serialized `GameModeStruct`).
- `ff_playedIndicesByPlaylist` — per-playlist played indices across sessions. This is why songs don't repeat even after closing the app.

In RN: `@react-native-async-storage/async-storage` for both. There are **no high scores, no user accounts, no settings screen, no sound-on/off toggle**. If we want any of those, they are new features.

---

## 5. Assets / dependencies worth knowing

- `assets/` declares `fonts/ images/ videos/ audios/ rive_animations/ pdfs/ jsons/` — most are empty. The only real static asset is the launcher icon.
- Fonts via `google_fonts` (Outfit, Plus Jakarta Sans) — on RN use `expo-font` or `@expo-google-fonts/*` packages.
- Album covers stream from Deezer CDN — `expo-image` with its built-in memory+disk cache replaces `cached_network_image`.
- FontAwesome icons → `@expo/vector-icons` (FontAwesome is bundled).

---

## 6. FlutterFlow-specific gotchas

1. **`FFAppState` is a god-object singleton with ~50 fields.** Don't port that shape verbatim. Split into focused stores: `useGameStore` (active game + scoring), `useSetupStore` (pre-game config), `usePlaylistStore` (rotation state, persisted). Zustand fits this cleanly.
2. **Scoring** — `timeUsed` is capped by the timer, not the formula: stop the counter when the 30s preview ends so `timeUsed ∈ [0, 30]`. No negative multipliers.
3. **Null `preview` URLs** — up to 10× retry is load-bearing. Port it or the game will occasionally stall on silent rounds.
4. **Legacy per-decade API methods and `team1Score..team6Score` duplicates** exist for historical FlutterFlow-binding reasons. Drop both; use the generic playlist endpoint and the `teamScores` array.
5. **`BuildContext` threaded through custom actions** — Dart-specific, drops out naturally in JS/TS.
6. **GoRouter declarative routes** → `expo-router` (file-based) is the cleanest mapping; react-navigation is fine too.
7. **`FlutterFlowTheme.of(context)`** — no direct equivalent. We're using NativeWind + a `theme.ts` tokens file as the single source of truth; no component library.
8. **Audio session / interruption handling** — Flutter's `audio_session` is implicit; with `expo-audio` we must configure the audio mode at app init (`playsInSilentMode: true`, background playback off) or previews won't play with the iOS ringer muted.
9. **Firestore is dead code.** Don't port it.
10. **No i18n needed** — English-only in the reference.
11. **`playlistDidReset` as a one-shot flag** is the FlutterFlow pattern for "fire a toast from state." In RN use a transient notification (toast lib or a `useEffect` on the flag that immediately clears it) rather than persistent state.

---

## 7. Phased build order

Each phase is a shippable checkpoint — run the app at the end of each and verify before moving on.

### Phase 0 — Scaffold (½ day)
- `npx create-expo-app` with TypeScript, **latest stable Expo SDK**, **expo-router**.
- Install: `expo-audio`, `expo-image`, `@react-native-async-storage/async-storage`, `zustand`, `nativewind`, `expo-haptics`.
- `theme.ts` with color/spacing/radius tokens; NativeWind config points at those tokens.
- Base `<Screen>` layout, `setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })` at app root.
- Commit: empty app boots on iOS and Android simulators.

### Phase 1 — Deezer client + types (½ day)
- TS interfaces matching the structs in §3.2 (minus dead fields).
- `deezer.ts`: `getTrackAtIndex(playlistId, index)` returning `{ title, artist, previewUrl, coverUrl } | null`, plus `getPlaylistMeta(playlistId)` returning `{ name, imageUrl, totalTracks }` for the Add Playlist flow.
- Ship the 11 built-in playlists as seed data (const array → hydrated into the playlist store on first launch).
- Throwaway screen that hits one playlist and renders the response.

### Phase 2 — Playlist rotation store (½ day)
- Zustand `usePlaylistStore` persisted to AsyncStorage; port `getNextIndexForPlaylist` verbatim (no-repeat + auto-reset + `didReset` flag).
- On first launch, hydrate seed playlists and refresh each one's `totalTracks` from Deezer in the background (so counts stay accurate without a code push).
- Unit test the selector: draws without replacement, resets cleanly, exposes the reset flag.

### Phase 3 — Audio playback + round loop (1 day)
- Minimal single-screen "jukebox": pick playlist → fetch track → play 30s preview → show title/artist/cover after stop.
- 10× null-preview retry.
- Timer that increments while audio is playing and **caps at 30**; writes `lastPlayedSeconds` on stop.
- Verify audio + fetch + rotation on iOS and Android devices (not just simulators — the silent switch behavior only shows up on hardware).

### Phase 4 — Setup flow + Add Playlist (1 day)
- Setup screen: team count (1–6), team names, playlist multi-select grid, target score slider, game mode selector.
- **Add Playlist screen**: paste a Deezer playlist URL or ID → parse → `getPlaylistMeta` → preview card (name, cover, track count) → confirm → persisted to `usePlaylistStore` alongside seeds. User-added playlists are deletable; seeds are not.
- `useSetupStore` (non-persistent; only `defaultGameMode` is persisted per §4).

### Phase 5 — Classic mode gameplay (1 day)
- Game screen with active-team indicator, team buttons, two correctness toggles, play/stop.
- Port `applyGuessResult` and `applyNoAnswerPenalty` exactly.
- Turn rotation, round counter, score display.
- Win detection → Game Over screen.

### Phase 6 — Classic Timed + Elimination (1 day)
- Timed: reuse Classic with a visible countdown; preview still 30s, round ends on buzz or time-out.
- Elimination: track `completedPlaylists` per team; playlist unavailable for that team once cleared; win when a team clears all selected playlists.

### Phase 7 — Polish (½–1 day)
- Reset-flag toast ("🔄 starting playlist over").
- Album-cover transitions, loading states, error states (Deezer 429 / network failure).
- Haptics on correct/wrong.
- Launcher icon + splash.

### Phase 8 — Deferred / future
- Cloud-synced playlists and high scores (Firestore or a small backend) — intentionally deferred.
- Single-player MCQ mode (needs distractor generation — new design).
- Share-a-playlist (deep link into the Add Playlist flow).

**Rough total:** ~5–6 focused days to reach feature parity + in-app playlist management.

---

## 8. Resolved decisions

1. **Scoring timer** — cap `timeUsed` at 30 via the timer itself (stop counting when audio ends). Formula stays as-is; multiplier stays in `[0, 30]`.
2. **Playlists** — ship 11 built-ins as seed data; refresh `totalTracks` from Deezer on first launch; users can add their own via an in-app **Add Playlist** screen (paste Deezer URL/ID). Spotify→Deezer workflow unchanged, but no code push needed to add new ones.
3. **Expo SDK & audio** — latest stable Expo SDK + `expo-audio` (not `expo-av`, which is on the deprecation path).
4. **Styling** — NativeWind + a `theme.ts` tokens file. No component library.
5. **Short Test debug playlist** — dropped.
