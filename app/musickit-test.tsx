/**
 * MusicKit spike — the two-day Apple Music feasibility test (Oct 2026).
 *
 * Answers, on a real phone, the questions that decide whether Songnado can
 * move from Deezer previews to the host's own Apple Music subscription:
 *   1. Does Apple Music play through the React Native bridge at all?
 *   2. Can a clip start at a random point, pause on cue, and resume where it
 *      paused — without the song's intro leaking before the seek lands?
 *   3. What do the lock screen and Control Center show while it plays?
 *   4. How much of our catalogue can Apple Music find by title + artist?
 *
 * Every result is console.logged with an `[MK]` prefix so it lands in the
 * Metro terminal on the PC, where it can be read without a screenshot.
 *
 * Spike-branch only. The bridge is required lazily: it constructs a
 * NativeEventEmitter at import time, which throws on any binary without the
 * native module — every 1.0.3 / 1.0.4 install — and expo-router evaluates
 * every route file at launch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '../theme';

type AM = typeof import('@lomray/react-native-apple-music');

function loadAppleMusic(): AM | null {
  if (Platform.OS !== 'ios' || !NativeModules.MusicModule) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@lomray/react-native-apple-music') as AM;
}

// ---------------------------------------------------------------------------
// Catalogue sample
// ---------------------------------------------------------------------------

type PackTrack = { deezerId: string; title: string; artist: string; source: string };

const PACKS: { name: string; tracks: PackTrack[] }[] = [
  { name: '2020s hits', tracks: require('../assets/curated-deezer/2020s-mega-hits.json').tracks },
  { name: '70s hits', tracks: require('../assets/curated-deezer/70s-mega-hits.json').tracks },
  { name: 'Broadway', tracks: require('../assets/curated-deezer/broadway.json').tracks },
  { name: 'Classic TV', tracks: require('../assets/curated-deezer/classic-tv-themes.json').tracks },
  { name: 'Movie scores', tracks: require('../assets/curated-deezer/movie-soundtracks.json').tracks },
  { name: 'Christmas', tracks: require('../assets/curated-deezer/christmas.json').tracks },
];

/** One song per pack type, hardest-to-match kinds included on purpose. */
const TEST_SONGS: { pack: string; title: string; artist: string }[] = [
  { pack: '2020s hits', title: 'Blinding Lights', artist: 'The Weeknd' },
  { pack: '70s hits', title: 'September', artist: 'Earth, Wind & Fire' },
  { pack: 'Broadway', title: 'Defying Gravity', artist: 'Kristin Chenoweth' },
  { pack: 'Movie scores', title: "Hedwig's Theme", artist: 'John Williams' },
  { pack: 'Classic TV', title: 'Breaking Bad Main Title Theme (Extended)', artist: 'Dave Porter' },
  { pack: 'Christmas', title: 'Last Christmas', artist: 'Wham!' },
];

const MATCH_SAMPLE_PER_PACK = 8;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // (From "Top Gun"), [Remastered]
    .replace(/\s-\s.*$/, ' ') // " - Main Theme", " - Remastered 2011"
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryArtist(a: string): string {
  return norm(a.split(/,|&| and | feat\.?| ft\.?| x /i)[0] ?? a);
}

function cleanTitle(t: string): string {
  return t.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchTerm(title: string, artist: string): string {
  return `${cleanTitle(title)} ${artist.split(/,|&| feat/i)[0]?.trim() ?? artist}`;
}

type AppleSong = { id: string; title: string; artistName: string; artworkUrl: string; duration: number };

type MatchKind = 'exact' | 'title-only' | 'miss';

function classify(ours: { title: string; artist: string }, results: AppleSong[]) {
  const t = norm(ours.title);
  const a = primaryArtist(ours.artist);
  let titleOnly: { rank: number; song: AppleSong } | null = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rt = norm(r.title);
    const titleOk = rt === t || (t.length >= 4 && rt.length >= 4 && (rt.includes(t) || t.includes(rt)));
    if (!titleOk) continue;
    const ra = norm(r.artistName);
    const artistOk = a.length > 0 && (ra.includes(a) || a.includes(primaryArtist(r.artistName)));
    if (artistOk) return { kind: 'exact' as MatchKind, rank: i + 1, song: r };
    if (!titleOnly) titleOnly = { rank: i + 1, song: r };
  }
  if (titleOnly) return { kind: 'title-only' as MatchKind, ...titleOnly };
  return { kind: 'miss' as MatchKind, rank: 0, song: null };
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Playback timing
// ---------------------------------------------------------------------------

/**
 * seekFirst — set the position, then play (the ideal: no intro ever audible)
 * playFirst — play, then seek once the player reports playing
 * both      — seek, play, and seek again if it started in the wrong place
 */
type Strategy = 'seekFirst' | 'playFirst' | 'both';

type StartResult = {
  strategy: Strategy;
  target: number;
  queueMs: number;
  /** ms from the play command until playback was advancing near the target. */
  startMs: number | null;
  firstPlayingPt: number | null;
  /** ms the player reported playing well before the target (intro leaking). */
  introLeakMs: number;
  landed: boolean;
};

function randomStart(duration: number, clipS: number): number {
  const maxStart = Math.max(5, duration - clipS - 10);
  const minStart = Math.min(20, maxStart);
  return Math.round((minStart + Math.random() * (maxStart - minStart)) * 10) / 10;
}

export default function MusicKitTest() {
  const [am] = useState(loadAppleMusic);
  const startRef = useRef(Date.now());
  const cancelRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);
  const reportRef = useRef<Record<string, unknown>>({ clips: [], resumes: [], sims: [] });

  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [auth, setAuth] = useState<string>('not asked');
  const [canPlay, setCanPlay] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<AppleSong | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('seekFirst');
  const [clipS, setClipS] = useState(10);
  const [pausedPt, setPausedPt] = useState<number | null>(null);
  const [lastClip, setLastClip] = useState<string>('');
  const [matchRows, setMatchRows] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no'>>({});

  const log = useCallback((msg: string) => {
    const t = ((Date.now() - startRef.current) / 1000).toFixed(1).padStart(6);
    console.log(`[MK] ${msg}`);
    setLines((prev) => [`${t}s  ${msg}`, ...prev].slice(0, 120));
  }, []);

  useEffect(() => {
    if (!am) return;
    cancelRef.current = false;
    const subState = am.Player.addListener('onPlaybackStateChange', (s) => {
      const status = String(s?.playbackStatus ?? '?');
      if (status !== lastStatusRef.current) {
        lastStatusRef.current = status;
        log(`event: ${status} @ ${Number(s?.playbackTime ?? 0).toFixed(2)}s`);
      }
    });
    const subErr = am.Player.addListener('onPlaybackError', (e) => {
      log(`PLAYBACK ERROR (${e?.operation}): ${e?.message} [${e?.domain} ${e?.code}]`);
    });
    return () => {
      cancelRef.current = true;
      am.Player.pause();
      subState.remove();
      subErr.remove();
    };
  }, [am, log]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (busy) return;
      cancelRef.current = false;
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        log(`${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    },
    [busy, log]
  );

  // ---- Apple Music primitives ---------------------------------------------

  async function search(title: string, artist: string): Promise<{ songs: AppleSong[]; ms: number }> {
    const t0 = Date.now();
    const res = await am!.MusicKit.catalogSearch(searchTerm(title, artist), [am!.CatalogSearchType.SONGS], {
      limit: 5,
    });
    const songs = (res?.songs ?? []).map((s) => ({ ...s, duration: Number(s.duration) || 0 }));
    return { songs, ms: Date.now() - t0 };
  }

  async function startAt(appleId: string, target: number, strat: Strategy): Promise<StartResult> {
    const P = am!.Player;
    const t0 = Date.now();
    await am!.MusicKit.setPlaybackQueue(appleId, am!.MusicItem.SONG);
    const queueMs = Date.now() - t0;

    const tCmd = Date.now();
    if (strat === 'playFirst') {
      P.play();
    } else {
      P.seekToTime(target);
      P.play();
    }
    let corrected = strat === 'seekFirst';
    let firstPlayingPt: number | null = null;
    let leakStart: number | null = null;
    let introLeakMs = 0;
    let prevNear: number | null = null;
    let startMs: number | null = null;

    while (Date.now() - tCmd < 8000 && !cancelRef.current) {
      const s = await P.getCurrentState();
      const now = Date.now();
      const playing = s.playbackStatus === 'playing';
      const pt = Number(s.playbackTime) || 0;
      if (playing && firstPlayingPt === null) firstPlayingPt = pt;
      if (playing && !corrected && Math.abs(pt - target) > 1.5) {
        P.seekToTime(target);
        corrected = true;
      }
      const leaking = playing && pt > 0.05 && pt < target - 1.5;
      if (leaking && leakStart === null) leakStart = now;
      if (!leaking && leakStart !== null) {
        introLeakMs += now - leakStart;
        leakStart = null;
      }
      const near = playing && Math.abs(pt - target) < 3;
      if (near && prevNear !== null && pt > prevNear) {
        startMs = now - tCmd;
        break;
      }
      prevNear = near ? pt : null;
      await sleep(40);
    }
    if (leakStart !== null) introLeakMs += Date.now() - leakStart;
    return { strategy: strat, target, queueMs, startMs, firstPlayingPt, introLeakMs, landed: startMs !== null };
  }

  /** Waits until `until`, then pauses and measures how late and how fast. */
  async function pauseAt(until: number) {
    const P = am!.Player;
    while (Date.now() < until && !cancelRef.current) await sleep(50);
    const tPause = Date.now();
    const lateMs = tPause - until;
    P.pause();
    let pauseMs: number | null = null;
    let pt = 0;
    while (Date.now() - tPause < 3000) {
      const s = await P.getCurrentState();
      pt = Number(s.playbackTime) || 0;
      if (s.playbackStatus !== 'playing') {
        pauseMs = Date.now() - tPause;
        break;
      }
      await sleep(30);
    }
    return { lateMs, pauseMs, pausedPt: pt };
  }

  function fmt(r: StartResult): string {
    const start = r.landed ? `${r.startMs}ms to audio at ${r.target.toFixed(1)}s` : `NEVER LANDED on ${r.target.toFixed(1)}s`;
    const first = r.firstPlayingPt === null ? 'never played' : `first heard at ${r.firstPlayingPt.toFixed(2)}s`;
    const leak = r.introLeakMs > 0 ? ` · INTRO LEAKED ~${r.introLeakMs}ms` : ' · no intro leak';
    return `${r.strategy}: load ${r.queueMs}ms, ${start}, ${first}${leak}`;
  }

  // ---- Actions ----------------------------------------------------------------

  const connect = () =>
    run('connect', async () => {
      const status = await am!.Auth.authorize();
      setAuth(String(status));
      log(`authorization: ${status}`);
      reportRef.current.auth = status;
      try {
        const sub = await am!.Auth.checkSubscription();
        setCanPlay(sub.canPlayCatalogContent);
        reportRef.current.subscription = sub;
        log(
          `subscription: canPlayCatalogContent=${sub.canPlayCatalogContent} canBecomeSubscriber=${sub.canBecomeSubscriber} cloudLibrary=${sub.hasCloudLibraryEnabled}`
        );
      } catch (e) {
        const code = (e as { code?: string })?.code;
        log(`subscription check failed: ${code ?? ''} ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  const findSong = (t: (typeof TEST_SONGS)[number]) =>
    run('find', async () => {
      const { songs, ms } = await search(t.title, t.artist);
      const m = classify(t, songs);
      log(`search "${searchTerm(t.title, t.artist)}" → ${songs.length} results in ${ms}ms, ${m.kind} (rank ${m.rank})`);
      songs.forEach((s, i) => log(`   ${i + 1}. ${s.title} — ${s.artistName} [${s.id}] ${Math.round(s.duration)}s`));
      const pick = m.song ?? songs[0] ?? null;
      setSelected(pick);
      setPausedPt(null);
      if (!pick) log('nothing to play for that one');
    });

  const playClip = (strat: Strategy, seconds: number, label = 'clip') =>
    run(label, async () => {
      if (!selected) return log('pick a song first');
      const target = randomStart(selected.duration, seconds);
      log(`${label}: "${selected.title}" from ${target}s for ${seconds}s (${strat})`);
      const r = await startAt(selected.id, target, strat);
      log(fmt(r));
      if (!r.landed) {
        am!.Player.pause();
        setLastClip(fmt(r));
        (reportRef.current.clips as unknown[]).push({ label, song: selected.title, ...r });
        return;
      }
      const p = await pauseAt(Date.now() + seconds * 1000);
      log(
        `paused ${p.pauseMs === null ? 'NOT CONFIRMED' : `in ${p.pauseMs}ms`} at ${p.pausedPt.toFixed(2)}s` +
          (p.lateMs > 250 ? ` · pause fired ${(p.lateMs / 1000).toFixed(1)}s LATE (app was suspended?)` : '')
      );
      setPausedPt(p.pausedPt);
      setLastClip(`${fmt(r)}\npaused in ${p.pauseMs ?? '?'}ms at ${p.pausedPt.toFixed(1)}s, ${p.lateMs}ms after cue`);
      (reportRef.current.clips as unknown[]).push({ label, song: selected.title, ...r, ...p });
    });

  const resume = () =>
    run('resume', async () => {
      if (pausedPt === null) return log('play a clip first, then resume');
      const P = am!.Player;
      const tCmd = Date.now();
      P.play();
      let firstPt: number | null = null;
      let ms: number | null = null;
      while (Date.now() - tCmd < 6000 && !cancelRef.current) {
        const s = await P.getCurrentState();
        const pt = Number(s.playbackTime) || 0;
        if (s.playbackStatus === 'playing') {
          if (firstPt === null) firstPt = pt;
          else if (pt > firstPt) {
            ms = Date.now() - tCmd;
            break;
          }
        }
        await sleep(40);
      }
      const diff = firstPt === null ? null : firstPt - pausedPt;
      const ok = diff !== null && Math.abs(diff) < 1;
      log(
        `resume: ${ms === null ? 'DID NOT RESUME' : `${ms}ms`}, picked up at ${firstPt?.toFixed(2) ?? '?'}s vs paused ${pausedPt.toFixed(2)}s → ${ok ? 'SAME SPOT ✓' : 'WRONG SPOT ✗'}`
      );
      (reportRef.current.resumes as unknown[]).push({ ms, firstPt, pausedPt, ok });
      const p = await pauseAt(Date.now() + 5000);
      setPausedPt(p.pausedPt);
    });

  const stop = () => {
    cancelRef.current = true;
    am?.Player.pause();
    log('stopped');
  };

  const simulate = () =>
    run('sim', async () => {
      const picks = pickRandom(
        PACKS.flatMap((p) => p.tracks.map((t) => ({ ...t, pack: p.name }))),
        5
      );
      const rows: { song: string; searchMs: number; queueMs: number; startMs: number | null; leak: number }[] = [];
      for (const [i, t] of picks.entries()) {
        if (cancelRef.current) break;
        const { songs, ms } = await search(t.title, t.artist);
        const m = classify(t, songs);
        if (!m.song) {
          log(`round ${i + 1}: "${t.title}" (${t.pack}) not found — a real game would skip it`);
          continue;
        }
        const r = await startAt(m.song.id, randomStart(m.song.duration, 6), strategy);
        log(`round ${i + 1}: "${m.song.title}" search ${ms}ms · ${fmt(r)}`);
        rows.push({ song: m.song.title, searchMs: ms, queueMs: r.queueMs, startMs: r.startMs, leak: r.introLeakMs });
        if (r.landed) await pauseAt(Date.now() + 6000);
        else am!.Player.pause();
        await sleep(1500);
      }
      const ready = rows.filter((r) => r.startMs !== null);
      const tapToAudio = ready.map((r) => r.queueMs + (r.startMs ?? 0));
      const avg = tapToAudio.length ? Math.round(tapToAudio.reduce((a, b) => a + b, 0) / tapToAudio.length) : 0;
      const max = tapToAudio.length ? Math.max(...tapToAudio) : 0;
      log(
        `SIM SUMMARY (${strategy}): ${ready.length}/${rows.length} landed · load+start avg ${avg}ms, worst ${max}ms · intro leaks: ${rows.filter((r) => r.leak > 0).length}`
      );
      (reportRef.current.sims as unknown[]).push({ strategy, rows, avg, max });
    });

  const matchTest = () =>
    run('match', async () => {
      const summary: string[] = [];
      const detail: Record<string, unknown> = {};
      for (const pack of PACKS) {
        let exact1 = 0;
        let exact5 = 0;
        let titleOnly = 0;
        let miss = 0;
        for (const t of pickRandom(pack.tracks, MATCH_SAMPLE_PER_PACK)) {
          if (cancelRef.current) return;
          const { songs } = await search(t.title, t.artist);
          const m = classify(t, songs);
          if (m.kind === 'exact') {
            exact5++;
            if (m.rank === 1) exact1++;
          } else if (m.kind === 'title-only') {
            titleOnly++;
            log(`  ~ ${pack.name}: "${t.title}" — ${t.artist} → only "${m.song?.title}" — ${m.song?.artistName}`);
          } else {
            miss++;
            log(`  ✗ ${pack.name}: "${t.title}" — ${t.artist} → not found`);
          }
          await sleep(120);
        }
        const row = `${pack.name}: ${exact5}/${MATCH_SAMPLE_PER_PACK} matched (${exact1} top hit) · ${titleOnly} wrong artist · ${miss} missing`;
        summary.push(row);
        detail[pack.name] = { exact1, exact5, titleOnly, miss };
        log(row);
        setMatchRows([...summary]);
      }
      reportRef.current.match = detail;
      log('MATCH TEST DONE');
    });

  const answer = (id: string, q: string, v: 'yes' | 'no') => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
    log(`answer: ${q} → ${v.toUpperCase()}`);
  };

  const printReport = () => {
    const report = { ...reportRef.current, answers, at: new Date().toISOString() };
    console.log(`[MK] REPORT ${JSON.stringify(report)}`);
    log('report sent to the PC');
  };

  // ---- UI ---------------------------------------------------------------------

  if (!am) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.pad}>
          <Text style={styles.h1}>Apple Music test</Text>
          <Text style={styles.body}>
            This build doesn&apos;t include Apple Music. Install the Apple Music test build to run it.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const disabled = busy !== null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.pad}>
        <Section n="1" title="Connect Apple Music">
          <Btn label="Connect" onPress={connect} disabled={disabled} />
          <Text style={styles.body}>
            Access: {auth}
            {canPlay === null ? '' : canPlay ? ' · subscription can play ✓' : ' · NO playable subscription ✗'}
          </Text>
        </Section>

        <Section n="2" title="Pick a test song">
          <View style={styles.wrap}>
            {TEST_SONGS.map((t) => (
              <Chip key={t.title} label={`${t.pack}: ${cleanTitle(t.title)}`} onPress={() => findSong(t)} disabled={disabled} />
            ))}
          </View>
          {selected ? (
            <View style={styles.songRow}>
              {selected.artworkUrl ? <Image source={{ uri: selected.artworkUrl }} style={styles.art} /> : null}
              <View style={styles.flex}>
                <Text style={styles.songTitle}>{selected.title}</Text>
                <Text style={styles.body}>
                  {selected.artistName} · {Math.round(selected.duration)}s
                </Text>
              </View>
            </View>
          ) : null}
        </Section>

        <Section n="3" title="Random-start clip">
          <Text style={styles.body}>Listen closely: do you hear the song&apos;s opening before it jumps ahead?</Text>
          <View style={styles.wrap}>
            {(['seekFirst', 'playFirst', 'both'] as Strategy[]).map((s) => (
              <Chip
                key={s}
                label={s === 'seekFirst' ? 'Seek then play' : s === 'playFirst' ? 'Play then seek' : 'Both'}
                active={strategy === s}
                onPress={() => setStrategy(s)}
              />
            ))}
            {[10, 30].map((s) => (
              <Chip key={s} label={`${s}s`} active={clipS === s} onPress={() => setClipS(s)} />
            ))}
          </View>
          <View style={styles.row}>
            <Btn label="Play clip" onPress={() => playClip(strategy, clipS)} disabled={disabled || !selected} />
            <Btn label="Resume" onPress={resume} disabled={disabled || pausedPt === null} />
            <Btn label="Stop" onPress={stop} kind="danger" />
          </View>
          {lastClip ? <Text style={styles.mono}>{lastClip}</Text> : null}
        </Section>

        <Section n="4" title="Lock-screen check">
          <Text style={styles.body}>
            Plays 45 seconds. As soon as it starts, lock the phone and look at the lock screen. Then unlock and swipe down
            from the top-right for Control Center. Answer the questions in step 7.
          </Text>
          <Btn label="Play 45s" onPress={() => playClip(strategy, 45, 'lockscreen')} disabled={disabled || !selected} />
        </Section>

        <Section n="5" title="Five quick rounds">
          <Text style={styles.body}>
            Five random songs from the packs, 6 seconds each, using the strategy picked in step 3. Measures how long the
            wait feels between rounds.
          </Text>
          <Btn label="Run 5 rounds" onPress={simulate} disabled={disabled} />
        </Section>

        <Section n="6" title="Catalogue match test">
          <Text style={styles.body}>
            Searches Apple Music for {MATCH_SAMPLE_PER_PACK * PACKS.length} random songs from six packs. Takes about a
            minute, no sound.
          </Text>
          <Btn label="Run match test" onPress={matchTest} disabled={disabled} />
          {matchRows.map((r) => (
            <Text key={r} style={styles.mono}>
              {r}
            </Text>
          ))}
        </Section>

        <Section n="7" title="What did you see and hear?">
          {QUESTIONS.map((q) => (
            <View key={q.id} style={styles.question}>
              <Text style={styles.body}>{q.q}</Text>
              <View style={styles.row}>
                <Chip label="Yes" active={answers[q.id] === 'yes'} onPress={() => answer(q.id, q.q, 'yes')} />
                <Chip label="No" active={answers[q.id] === 'no'} onPress={() => answer(q.id, q.q, 'no')} />
              </View>
            </View>
          ))}
          <Btn label="Send report to PC" onPress={printReport} />
        </Section>

        <Text style={styles.h2}>Log {busy ? `· running ${busy}…` : ''}</Text>
        {lines.map((l, i) => (
          <Text key={`${i}-${l}`} style={styles.mono}>
            {l}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const QUESTIONS = [
  { id: 'introLeak', q: 'In the clip test, did you hear the start of the song before it jumped ahead?' },
  { id: 'lockTitle', q: 'Did the lock screen show the song title or album art?' },
  { id: 'ccTitle', q: 'Did Control Center show the song title?' },
  { id: 'topOfScreen', q: 'With Songnado open, did the top of the screen (Dynamic Island) show the song?' },
  { id: 'keptPlaying', q: 'Did the song keep playing while the phone was locked?' },
  { id: 'musicAppUntouched', q: 'Afterwards, was your own Apple Music app queue unchanged?' },
  { id: 'sound', q: 'Were sound quality and volume fine?' },
];

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>
        {n} · {title}
      </Text>
      {children}
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  kind = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, { backgroundColor: kind === 'danger' ? colors.danger : colors.primary }, disabled && styles.dim]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  onPress,
  active,
  disabled,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && styles.dim]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 14, paddingBottom: 48 },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 14,
    gap: 10,
  },
  h1: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  h2: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  mono: { color: colors.textPrimary, fontSize: 11, fontFamily: 'Menlo', lineHeight: 16 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1 },
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: radii.md, alignItems: 'center' },
  btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.border },
  chipText: { color: colors.textPrimary, fontSize: 13 },
  dim: { opacity: 0.4 },
  songRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  art: { width: 56, height: 56, borderRadius: radii.sm },
  songTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  question: { gap: 6 },
});
