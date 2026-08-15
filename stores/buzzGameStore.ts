/**
 * Buzz mode runtime state.
 *
 * Parallel to gameStore — buzz mode has fundamentally different shape
 * (multi-device, async messages, host/client role) and trying to retrofit
 * it into the single-device gameStore would make both messy.
 *
 * Lifecycle:
 *   none (no buzz session active)
 *     ↓ user picks "Host" → startHosting()
 *   host:lobby_starting (TCP server bringing up)
 *     ↓ server listening, QR ready
 *   host:lobby_open (waiting for clients to join)
 *     ↓ host taps "Start Game"
 *   host:playing  (running rounds)
 *     ↓ all rounds done
 *   host:ended
 *
 * Client side:
 *   none
 *     ↓ user scans QR → joinAsClient(connectionString)
 *   client:connecting
 *     ↓ JOIN_ACK received
 *   client:lobby
 *     ↓ GAME_START
 *   client:playing
 *     ↓ GAME_END
 *   client:ended
 *
 * Phase 0 (this commit): types + skeleton actions. Implementations stub
 * out anything that needs networking (returns null / no-ops). Phase 1
 * fills in the TCP transport behind these same action signatures.
 */

import { create } from 'zustand';

import { BuzzClient } from '@/lib/buzz/client';
import { BuzzServer } from '@/lib/buzz/server';
import { newMsgId } from '@/lib/buzz/protocol';
import { applySuddenDeathWin, tiedLeaders } from '@/lib/buzz/suddenDeath';
import type {
  LobbyTeam,
  RoundReveal,
  TeamColor,
  ConnectionString,
} from '@/lib/buzz/protocol';
import type { Song } from '@/lib/types';

export type BuzzRole = 'none' | 'host' | 'client';

export type BuzzPhase =
  // shared
  | 'none'
  // host-only
  | 'host:lobby_starting'
  | 'host:lobby_open'
  | 'host:playing'
  | 'host:ended'
  // client-only
  | 'client:connecting'
  | 'client:lobby'
  | 'client:playing'
  | 'client:ended';

/**
 * Per-round buzzer state (mirrors what the client UI cares about).
 *  - 'locked': buzz button disabled (between rounds, during reveal)
 *  - 'armed': buzz button live; race is on
 *  - 'i_buzzed': this client buzzed first; show "Your turn" UI
 *  - 'other_buzzed': another team buzzed; show "Team X is answering"
 *  - 'eliminated': this client got eliminated this round
 */
export type BuzzButtonState =
  | 'locked'
  | 'armed'
  | 'i_buzzed'
  | 'other_buzzed'
  | 'eliminated';

/**
 * What's happening inside a host:playing round.
 *  - 'idle'      — between rounds; host loading next song
 *  - 'playing'   — audio is playing, buzzers are armed, race is on
 *  - 'answering' — a team buzzed; host is judging Correct/Wrong
 *  - 'reveal'    — round is over (winner or all-eliminated), reveal screen up
 */
/**
 *  - 'picking'   — a team chooses which pack this round comes from. Rotates
 *                  between teams so everyone gets agency; rounds used to
 *                  draw a random pack, which left the teams with nothing to
 *                  do between buzzes.
 */
export type RoundSubPhase =
  | 'picking'
  | 'idle'
  | 'playing'
  | 'answering'
  | 'reveal';

export interface HostState {
  /** Local IP of the device for the QR code. Resolved at startHosting. */
  localIp: string | null;
  port: number | null;
  sessionId: string | null;
  /**
   * Connected clients, by teamId. Includes disconnected-but-rejoinable
   * teams (`connected: false`) so we can show a "reconnecting…" state.
   */
  teams: Record<string, LobbyTeam>;
  /** Round counter when phase is host:playing. */
  currentRound: number;
  totalRounds: number;
  /** Sub-phase within the current round; see RoundSubPhase. */
  roundSubPhase: RoundSubPhase;
  /** Song the host is currently playing (or last played). */
  currentSong: Song | null;
  /**
   * Every pack chosen for this game. Each round one team picks which of
   * these it comes from (see pickingTeamId).
   */
  playlistIds: string[];
  /** The pack THIS round's song came from. Changes per round. */
  currentPlaylistId: string | null;
  /**
   * Team whose turn it is to choose this round's pack. Rotates through the
   * teams in join order. Null before the game starts.
   */
  pickingTeamId: string | null;
  currentPlaylistName: string | null;
  /** Track indices already played this game (for rotation). */
  playedTrackIndices: number[];
  /** Total track count in the chosen playlist. */
  playlistTotalTracks: number;
  /** TeamId whose buzzer is currently locked-in for answering. */
  answeringTeamId: string | null;
  /** TeamIds eliminated for the current round only (reset between rounds). */
  eliminatedThisRound: string[];
  /** Persistent team scores, by teamId. */
  scores: Record<string, number>;
  /** Last round's reveal — title/artist/source for the host UI. */
  lastReveal: RoundReveal | null;
  /**
   * True once the scheduled rounds are done and the leaders are playing off
   * a tie. Sudden-death rounds award no points — a tie-break shouldn't
   * rewrite the scoreboard everyone just watched — so the finishing order
   * is carried by suddenDeathOut instead.
   */
  suddenDeath: boolean;
  /** Teams still contesting the tie. */
  suddenDeathContenders: string[];
  /**
   * Contenders who have already answered correctly this cycle and are
   * through to the next one. With three or more tied, rounds continue until
   * exactly one contender is left unsafe; that team is out and the rest
   * start a fresh cycle.
   */
  suddenDeathSafe: string[];
  /** Knocked out in sudden death, earliest first — i.e. last place first. */
  suddenDeathOut: string[];
  /**
   * The last pack each team chose, by teamId. Used to stop a team picking
   * the same pack on two consecutive turns of their own.
   */
  lastPickByTeam: Record<string, string>;
}

interface ClientState {
  /** Connection details we connected to (for retry). */
  connection: ConnectionString | null;
  /** TeamId after JOIN_ACK. */
  myTeamId: string | null;
  myColor: TeamColor | null;
  myName: string | null;
  /** Lobby roster as broadcast by host. */
  lobbyTeams: LobbyTeam[];
  /**
   * Final standings from GAME_END. Kept so the client can show where it
   * finished instead of just going dark — the ranking used to be received
   * and discarded.
   */
  finalRanking: string[];
  finalScores: Record<string, number>;
  buzzButton: BuzzButtonState;
  /** Last round reveal we received from host. */
  lastReveal: RoundReveal | null;
  /** Current round-trip ping to host in ms. */
  pingMs: number | null;
  /**
   * True while we're trying to get back in after the socket dropped. The
   * player shouldn't have to understand any of this — a call comes in, the
   * app is backgrounded, and it reattaches itself on the way back.
   */
  reconnecting: boolean;
  /** Host says the scheduled rounds are done and the leaders are playing off. */
  suddenDeath: boolean;
}

export interface BuzzState {
  role: BuzzRole;
  phase: BuzzPhase;
  host: HostState;
  client: ClientState;

  // ─── host actions ─────────────────────────────────────────────────
  /**
   * Start hosting: resolve local IP, pick a port, start TCP server,
   * generate session ID. Phase advances to host:lobby_open on success.
   * Stubbed in Phase 0; real implementation lands in Phase 1.
   */
  startHosting: () => Promise<void>;
  stopHosting: () => Promise<void>;
  /** Host taps "Start Game". Broadcasts GAME_START, advances to host:playing. */
  hostStartGame: (
    totalRounds: number,
    playlistIds: string[],
    playlistName: string,
    playlistTotalTracks: number
  ) => Promise<void>;
  /**
   * Host-game screen tells the store which pack it drew from for the round
   * about to start, so the reveal can name it.
   */
  hostSetRoundPlaylist: (playlistId: string) => void;
  /**
   * The picking team has chosen this round's pack. Moves the sub-phase to
   * 'idle', which is what makes the host screen load and play a track.
   */
  hostPickPlaylist: (playlistId: string) => void;
  /**
   * Host's game-screen tells the store it has loaded a track and is about
   * to play. Store sets roundSubPhase='playing', broadcasts ROUND_START +
   * BUZZ_ARMED with eligible teams (connected ∧ not already eliminated
   * this round).
   */
  hostBeginRound: (song: Song, trackIndex: number) => void;
  /** Host's "Correct" judgment — award point + ROUND_END. */
  hostJudgeCorrect: () => void;
  /**
   * Host's "Wrong" judgment — eliminate buzzed team for this round.
   * If teams remain, re-arms buzzers. If none remain, broadcasts
   * ROUND_END with no winner.
   */
  hostJudgeWrong: () => void;
  /**
   * After reveal: host advances to next round, OR ends game if we've
   * hit totalRounds. Caller (host-game.tsx) handles picking the next
   * track and calling hostBeginRound() again.
   */
  hostAdvanceRound: () => void;

  // ─── client actions ──────────────────────────────────────────────
  /**
   * Join an in-progress session via scanned QR.
   * Phase advances client:connecting → client:lobby.
   */
  joinAsClient: (
    connection: ConnectionString,
    desiredName: string,
    desiredColor: TeamColor,
    /**
     * Set when coming back after a drop: asks the host to reattach us to
     * this team instead of creating a new one, so our score survives.
     */
    rejoinTeamId?: string
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  /** User taps the giant BUZZ button. */
  pressBuzz: () => Promise<void>;
  /** User toggles ready in lobby. */
  setReady: (ready: boolean) => Promise<void>;

  // ─── shared ──────────────────────────────────────────────────────
  reset: () => void;
}

const initialHostState: HostState = {
  localIp: null,
  port: null,
  sessionId: null,
  teams: {},
  currentRound: 0,
  totalRounds: 0,
  roundSubPhase: 'idle',
  currentSong: null,
  playlistIds: [],
  currentPlaylistId: null,
  pickingTeamId: null,
  currentPlaylistName: null,
  playedTrackIndices: [],
  playlistTotalTracks: 0,
  answeringTeamId: null,
  eliminatedThisRound: [],
  scores: {},
  lastReveal: null,
  suddenDeath: false,
  suddenDeathContenders: [],
  suddenDeathSafe: [],
  suddenDeathOut: [],
  lastPickByTeam: {},
};

const initialClientState: ClientState = {
  connection: null,
  myTeamId: null,
  myColor: null,
  myName: null,
  lobbyTeams: [],
  finalRanking: [],
  finalScores: {},
  buzzButton: 'locked',
  reconnecting: false,
  suddenDeath: false,
  lastReveal: null,
  pingMs: null,
};

/**
 * Live transport instances. Held outside zustand state because they
 * carry non-serializable handles (sockets) and listener registrations.
 * Cleared on reset()/disconnect()/stopHosting().
 */
let currentServer: BuzzServer | null = null;
let currentClient: BuzzClient | null = null;

// ─── client auto-reconnect ──────────────────────────────────────────
//
// A phone that rings, sleeps, or wanders out of Wi-Fi range drops its
// socket. Without this the player is simply out of the game with no way
// back, which in a party is indistinguishable from the app being broken.

const MAX_RECONNECT_ATTEMPTS = 6;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
}

function scheduleReconnect(): void {
  const { connection, myTeamId, myName, myColor } =
    useBuzzGameStore.getState().client;
  if (!connection || !myTeamId || !myName || !myColor) return;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // Give up quietly rather than retrying forever in someone's pocket.
    useBuzzGameStore.setState((s) => ({
      client: { ...s.client, reconnecting: false },
    }));
    return;
  }

  // Back off: the common case (brief backgrounding) recovers on the first
  // try, and the uncommon one shouldn't hammer the host.
  const delay = Math.min(8000, 500 * 2 ** reconnectAttempts);
  reconnectAttempts += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void useBuzzGameStore
      .getState()
      .joinAsClient(connection, myName, myColor, myTeamId)
      .catch(() => scheduleReconnect());
  }, delay);
}

/**
 * Who may buzz right now. One definition, used by every place that arms
 * buzzers — normal rounds, wrong-answer re-arms, and mid-game rejoins —
 * because three copies of this rule would eventually disagree.
 *
 * In sudden death only the tied teams are in it, and a team that has
 * already answered correctly this cycle sits out so the round converges on
 * whoever is left rather than letting a safe team win twice.
 */
function eligibleTeamIds(s: BuzzState): string[] {
  const h = s.host;
  return Object.values(h.teams)
    .filter((t) => t.connected)
    .map((t) => t.teamId)
    .filter((id) => !h.eliminatedThisRound.includes(id))
    .filter((id) => !h.suddenDeath || h.suddenDeathContenders.includes(id))
    .filter((id) => !h.suddenDeath || !h.suddenDeathSafe.includes(id));
}

function isEligibleThisRound(s: BuzzState, teamId: string): boolean {
  return eligibleTeamIds(s).includes(teamId);
}

/**
 * Hand the pick to the next team after the current one, restricted to
 * `pool` (all connected teams normally, only the contenders in sudden
 * death). Wraps, and falls back to the full roster if nobody in the pool is
 * connected, so the game never stalls with no picker.
 */
function nextPicker(h: HostState, pool: string[]): string | null {
  const connected = pool.filter((id) => h.teams[id]?.connected);
  const usable = connected.length > 0 ? connected : pool;
  if (usable.length === 0) return null;
  const at = h.pickingTeamId ? usable.indexOf(h.pickingTeamId) : -1;
  return usable[(at + 1) % usable.length];
}

/**
 * Finishing order, best first.
 *
 * Without a tie-break this is just score order. After sudden death the
 * contenders are ordered by how they fared in the play-off — the survivor
 * first, then the knocked-out teams in reverse order of elimination — and
 * everyone who wasn't tied follows on score. Sorting the whole field by
 * score would be wrong here: the tied teams still have identical scores,
 * which is the entire reason the play-off happened.
 */
export function finalRanking(h: HostState): string[] {
  const byScore = (ids: string[]) =>
    [...ids].sort((a, b) => (h.scores[b] ?? 0) - (h.scores[a] ?? 0));

  if (!h.suddenDeath) return byScore(Object.keys(h.scores));

  const contested = [
    ...h.suddenDeathContenders,
    ...[...h.suddenDeathOut].reverse(),
  ];
  const rest = Object.keys(h.scores).filter((id) => !contested.includes(id));
  return [...contested, ...byScore(rest)];
}


// NOT persisted — buzz sessions are ephemeral. If the app backgrounds for
// more than a few seconds the TCP socket will drop anyway; rejoining is
// faster than trying to resume from disk.
export const useBuzzGameStore = create<BuzzState>((set, _get) => ({
  role: 'none',
  phase: 'none',
  host: initialHostState,
  client: initialClientState,

  // ─── host actions ────────────────────────────────────────────────
  startHosting: async () => {
    if (currentServer) await currentServer.stop();
    const server = new BuzzServer();
    currentServer = server;
    set({ role: 'host', phase: 'host:lobby_starting' });

    const broadcastLobbyState = () => {
      const teams = Object.values(useBuzzGameStore.getState().host.teams);
      server.broadcast({
        t: 'LOBBY_STATE',
        id: newMsgId(),
        gameMode: 'buzz',
        playlistName: '', // Phase 3: thread playlist name through here
        teams,
        starting: false,
      });
    };

    server.on('clientJoined', (teamId, name, color) => {
      set((s) => ({
        host: {
          ...s.host,
          teams: {
            ...s.host.teams,
            [teamId]: {
              teamId,
              name,
              color,
              ready: false,
              pingMs: null,
              connected: true,
            },
          },
        },
      }));
      broadcastLobbyState();
    });

    server.on('clientRejoined', (teamId, name, color) => {
      set((s) => {
        const existing = s.host.teams[teamId];
        return {
          host: {
            ...s.host,
            teams: {
              ...s.host.teams,
              [teamId]: {
                ...(existing ?? {
                  teamId,
                  name,
                  color,
                  pingMs: null,
                }),
                connected: true,
                ready: false,
              },
            },
          },
        };
      });
      broadcastLobbyState();

      // Mid-game rejoin: the client is sitting on its lobby screen with no
      // idea a game is running. Replay just enough for it to catch up —
      // GAME_START to move it into the game, then the current buzzer state
      // so its button matches everyone else's.
      // Read state AFTER the set above — eligibility depends on this team
      // being marked connected again, so a pre-set snapshot would always
      // say "not eligible" and hand them a dead buzzer.
      const s1 = useBuzzGameStore.getState();
      if (s1.phase === 'host:playing') {
        currentServer?.sendTo(teamId, {
          t: 'GAME_START',
          id: newMsgId(),
          totalRounds: s1.host.totalRounds,
        });
        const armed =
          s1.host.roundSubPhase === 'playing' &&
          isEligibleThisRound(s1, teamId);
        currentServer?.sendTo(
          teamId,
          armed
            ? {
                t: 'BUZZ_ARMED',
                id: newMsgId(),
                eligibleTeamIds: eligibleTeamIds(s1),
              }
            : { t: 'BUZZ_LOCKED', id: newMsgId() }
        );
      }
    });

    server.on('clientDisconnected', (teamId) => {
      set((s) => {
        const existing = s.host.teams[teamId];
        if (!existing) return s;
        return {
          host: {
            ...s.host,
            teams: {
              ...s.host.teams,
              [teamId]: { ...existing, connected: false, ready: false },
            },
          },
        };
      });
      broadcastLobbyState();
    });

    server.on('clientMessage', (teamId, msg) => {
      if (msg.t === 'READY') {
        set((s) => {
          const existing = s.host.teams[teamId];
          if (!existing) return s;
          return {
            host: {
              ...s.host,
              teams: {
                ...s.host.teams,
                [teamId]: { ...existing, ready: msg.ready },
              },
            },
          };
        });
        broadcastLobbyState();
      } else if (msg.t === 'BUZZ') {
        // First-arrival wins. Drop subsequent BUZZes for the round.
        // Drop BUZZes from teams not currently armed (eliminated this
        // round, or arrived after we already locked).
        const cur = useBuzzGameStore.getState();
        if (cur.host.roundSubPhase !== 'playing') return;
        if (cur.host.eliminatedThisRound.includes(teamId)) return;
        set((s) => ({
          host: {
            ...s.host,
            roundSubPhase: 'answering',
            answeringTeamId: teamId,
          },
        }));
        // Lock everyone, then announce the winner.
        server.broadcast({ t: 'BUZZ_LOCKED', id: newMsgId() });
        server.broadcast({
          t: 'BUZZ_WINNER',
          id: newMsgId(),
          winningTeamId: teamId,
          answerWindowSec: 5,
        });
      }
    });

    server.on('error', (err) => {
      console.warn('[buzzGameStore] server error:', err.message);
    });

    const info = await server.start();
    set((s) => ({
      phase: 'host:lobby_open',
      host: {
        ...s.host,
        localIp: info.localIp,
        port: info.port,
        sessionId: info.sessionId,
      },
    }));
  },

  stopHosting: async () => {
    if (currentServer) {
      await currentServer.stop();
      currentServer = null;
    }
    set({ role: 'none', phase: 'none', host: initialHostState });
  },

  hostPickPlaylist: (playlistId) => {
    set((s) => ({
      host: {
        ...s.host,
        currentPlaylistId: playlistId,
        // Remember it so this team can't pick the same pack again next
        // time the rotation reaches them.
        lastPickByTeam: s.host.pickingTeamId
          ? { ...s.host.lastPickByTeam, [s.host.pickingTeamId]: playlistId }
          : s.host.lastPickByTeam,
        // 'idle' is the trigger the host screen watches to load a track.
        roundSubPhase: 'idle',
      },
    }));
  },

  hostSetRoundPlaylist: (playlistId) => {
    set((s) => ({ host: { ...s.host, currentPlaylistId: playlistId } }));
  },

  hostStartGame: async (
    totalRounds,
    playlistIds,
    playlistName,
    playlistTotalTracks
  ) => {
    // Initialize scores for every connected team.
    const teams = Object.values(useBuzzGameStore.getState().host.teams);
    const initialScores: Record<string, number> = {};
    for (const t of teams) initialScores[t.teamId] = 0;
    set((s) => ({
      phase: 'host:playing',
      host: {
        ...s.host,
        totalRounds,
        currentRound: 1,
        // Games open on a pick rather than a song — the first team chooses
        // where round one comes from.
        roundSubPhase: 'picking',
        pickingTeamId: teams[0]?.teamId ?? null,
        playlistIds,
        currentPlaylistId: null,
        currentPlaylistName: playlistName,
        playlistTotalTracks,
        playedTrackIndices: [],
        scores: initialScores,
        eliminatedThisRound: [],
        lastReveal: null,
        suddenDeath: false,
        suddenDeathContenders: [],
        suddenDeathSafe: [],
        suddenDeathOut: [],
        lastPickByTeam: {},
      },
    }));
    currentServer?.broadcast({
      t: 'GAME_START',
      id: newMsgId(),
      totalRounds,
    });
  },

  hostBeginRound: (song, trackIndex) => {
    if (!currentServer) return;
    const s0 = useBuzzGameStore.getState();
    set((s) => ({
      host: {
        ...s.host,
        currentSong: song,
        roundSubPhase: 'playing',
        answeringTeamId: null,
        eliminatedThisRound: [],
        playedTrackIndices: [...s.host.playedTrackIndices, trackIndex],
      },
    }));
    currentServer.broadcast({
      t: 'ROUND_START',
      id: newMsgId(),
      roundNumber: s0.host.currentRound,
      suddenDeath: s0.host.suddenDeath,
    });
    // Read eligibility AFTER the set() above cleared eliminatedThisRound,
    // or a team eliminated last round would start this one locked out.
    currentServer.broadcast({
      t: 'BUZZ_ARMED',
      id: newMsgId(),
      eligibleTeamIds: eligibleTeamIds(useBuzzGameStore.getState()),
    });
  },

  hostJudgeCorrect: () => {
    if (!currentServer) return;
    const s0 = useBuzzGameStore.getState();
    const winnerId = s0.host.answeringTeamId;
    if (!winnerId) return;

    // Sudden death awards no points — the scoreboard the room just watched
    // shouldn't change during a tie-break. Standing is carried by who is
    // knocked out and when.
    const sd = s0.host.suddenDeath;
    const newScores = sd
      ? s0.host.scores
      : {
          ...s0.host.scores,
          [winnerId]: (s0.host.scores[winnerId] ?? 0) + 1,
        };

    const nextSd = sd
      ? applySuddenDeathWin(
          {
            contenders: s0.host.suddenDeathContenders,
            safe: s0.host.suddenDeathSafe,
            out: s0.host.suddenDeathOut,
          },
          winnerId
        )
      : {
          contenders: s0.host.suddenDeathContenders,
          safe: s0.host.suddenDeathSafe,
          out: s0.host.suddenDeathOut,
        };

    const song = s0.host.currentSong;
    const reveal: RoundReveal = {
      songTitle: song?.title ?? '',
      artist: song?.artist ?? '',
      source: song?.source ?? null,
      coverUrl: song?.coverUrl ?? '',
    };
    set((s) => ({
      host: {
        ...s.host,
        roundSubPhase: 'reveal',
        scores: newScores,
        lastReveal: reveal,
        suddenDeathContenders: nextSd.contenders,
        suddenDeathSafe: nextSd.safe,
        suddenDeathOut: nextSd.out,
      },
    }));
    currentServer.broadcast({
      t: 'ROUND_END',
      id: newMsgId(),
      roundNumber: s0.host.currentRound,
      winningTeamId: winnerId,
      reveal,
      scores: newScores,
    });
  },

  hostJudgeWrong: () => {
    if (!currentServer) return;
    const s0 = useBuzzGameStore.getState();
    const losingId = s0.host.answeringTeamId;
    if (!losingId) return;
    const newEliminated = [...s0.host.eliminatedThisRound, losingId];

    currentServer.broadcast({
      t: 'TEAM_ELIMINATED',
      id: newMsgId(),
      teamId: losingId,
    });

    const stillIn = eligibleTeamIds({
      ...s0,
      host: { ...s0.host, eliminatedThisRound: newEliminated },
    });

    if (stillIn.length === 0) {
      // All eliminated → reveal with no winner
      const song = s0.host.currentSong;
      const reveal: RoundReveal = {
        songTitle: song?.title ?? '',
        artist: song?.artist ?? '',
        source: song?.source ?? null,
        coverUrl: song?.coverUrl ?? '',
      };
      set((s) => ({
        host: {
          ...s.host,
          roundSubPhase: 'reveal',
          eliminatedThisRound: newEliminated,
          answeringTeamId: null,
          lastReveal: reveal,
        },
      }));
      currentServer.broadcast({
        t: 'ROUND_END',
        id: newMsgId(),
        roundNumber: s0.host.currentRound,
        winningTeamId: null,
        reveal,
        scores: s0.host.scores,
      });
      return;
    }

    // Re-arm remaining teams. Audio resume happens in host-game screen.
    set((s) => ({
      host: {
        ...s.host,
        roundSubPhase: 'playing',
        eliminatedThisRound: newEliminated,
        answeringTeamId: null,
      },
    }));
    currentServer.broadcast({
      t: 'BUZZ_ARMED',
      id: newMsgId(),
      eligibleTeamIds: stillIn,
    });
  },

  hostAdvanceRound: () => {
    const s0 = useBuzzGameStore.getState();
    const h = s0.host;
    const nextRound = h.currentRound + 1;

    const endGame = () => {
      currentServer?.broadcast({
        t: 'GAME_END',
        id: newMsgId(),
        ranking: finalRanking(h),
        scores: h.scores,
      });
      set({ phase: 'host:ended' });
    };

    if (h.suddenDeath) {
      // One contender left standing — that's the winner.
      if (h.suddenDeathContenders.length <= 1) {
        endGame();
        return;
      }
      // Otherwise keep playing off. Only contenders get to pick.
      set((s) => ({
        host: {
          ...s.host,
          currentRound: nextRound,
          roundSubPhase: 'picking',
          pickingTeamId: nextPicker(s.host, s.host.suddenDeathContenders),
          currentPlaylistId: null,
          answeringTeamId: null,
          eliminatedThisRound: [],
          currentSong: null,
          lastReveal: null,
        },
      }));
      return;
    }

    if (nextRound > h.totalRounds) {
      const leaders = tiedLeaders(h.scores);
      if (leaders.length < 2) {
        endGame();
        return;
      }
      // Tied at the top: play it off rather than declaring a joint winner.
      set((s) => ({
        host: {
          ...s.host,
          currentRound: nextRound,
          roundSubPhase: 'picking',
          pickingTeamId: nextPicker(s.host, leaders),
          currentPlaylistId: null,
          answeringTeamId: null,
          eliminatedThisRound: [],
          currentSong: null,
          lastReveal: null,
          suddenDeath: true,
          suddenDeathContenders: leaders,
          suddenDeathSafe: [],
          suddenDeathOut: [],
        },
      }));
      return;
    }
    // Hand the pick to the next team in join order. Teams that dropped mid
    // game are skipped, and if everyone has gone the rotation wraps.
    set((s) => ({
      host: {
        ...s.host,
        currentRound: nextRound,
        // Back to 'picking', not 'idle' — the next round starts with a
        // team choosing a pack rather than a song appearing.
        roundSubPhase: 'picking',
        pickingTeamId: nextPicker(
          s.host,
          Object.values(s.host.teams).map((t) => t.teamId)
        ),
        currentPlaylistId: null,
        answeringTeamId: null,
        eliminatedThisRound: [],
        currentSong: null,
        lastReveal: null,
      },
    }));
  },

  // ─── client actions ──────────────────────────────────────────────
  joinAsClient: async (connection, desiredName, desiredColor, rejoinTeamId) => {
    if (currentClient) await currentClient.disconnect();
    const client = new BuzzClient();
    currentClient = client;

    set({
      role: 'client',
      phase: 'client:connecting',
      client: {
        ...initialClientState,
        connection,
        myName: desiredName,
        myColor: desiredColor,
        // Keep showing who we are while reattaching, so the screen doesn't
        // blank out and look like a fresh join.
        myTeamId: rejoinTeamId ?? null,
        reconnecting: rejoinTeamId != null,
      },
    });

    client.on('hostMessage', (msg) => {
      if (msg.t === 'LOBBY_STATE') {
        set((s) => ({
          client: { ...s.client, lobbyTeams: msg.teams },
        }));
      } else if (msg.t === 'BUZZ_ARMED') {
        set((s) => {
          const myId = s.client.myTeamId;
          const armed =
            myId != null && msg.eligibleTeamIds.includes(myId);
          return {
            client: {
              ...s.client,
              buzzButton: armed ? 'armed' : 'eliminated',
            },
          };
        });
      } else if (msg.t === 'BUZZ_LOCKED') {
        set((s) => ({
          client: { ...s.client, buzzButton: 'locked' },
        }));
      } else if (msg.t === 'BUZZ_WINNER') {
        set((s) => ({
          client: {
            ...s.client,
            buzzButton:
              s.client.myTeamId === msg.winningTeamId
                ? 'i_buzzed'
                : 'other_buzzed',
          },
        }));
      } else if (msg.t === 'TEAM_ELIMINATED') {
        set((s) => {
          if (s.client.myTeamId === msg.teamId) {
            return {
              client: { ...s.client, buzzButton: 'eliminated' },
            };
          }
          return s;
        });
      } else if (msg.t === 'ROUND_END') {
        set((s) => ({
          client: {
            ...s.client,
            lastReveal: msg.reveal,
            buzzButton: 'locked',
          },
        }));
      } else if (msg.t === 'ROUND_START') {
        set((s) => ({
          client: { ...s.client, suddenDeath: msg.suddenDeath === true },
        }));
      } else if (msg.t === 'GAME_START') {
        set({ phase: 'client:playing' });
      } else if (msg.t === 'GAME_END') {
        // Keep the standings — the client screen shows final placement.
        set((s) => ({
          phase: 'client:ended',
          client: {
            ...s.client,
            finalRanking: msg.ranking,
            finalScores: msg.scores,
            buzzButton: 'locked',
          },
        }));
      }
    });

    client.on('pingUpdate', (medianMs) => {
      set((s) => ({ client: { ...s.client, pingMs: medianMs } }));
    });

    client.on('disconnected', (reason) => {
      const s0 = useBuzzGameStore.getState();
      // The host deliberately ended the session — nothing to reconnect to.
      if (reason !== 'host_shutdown' && s0.client.myTeamId) {
        const inGame =
          s0.phase === 'client:playing' || s0.phase === 'client:lobby';
        if (inGame) {
          set((s) => ({
            client: { ...s.client, buzzButton: 'locked', reconnecting: true },
          }));
          scheduleReconnect();
          return;
        }
      }
      set((s) => ({
        phase: s.phase === 'client:playing' ? 'client:ended' : 'none',
        client: { ...s.client, buzzButton: 'locked', reconnecting: false },
      }));
    });

    client.on('error', (err) => {
      console.warn('[buzzGameStore] client error:', err.message);
    });

    const result = await client.connect(
      connection,
      desiredName,
      desiredColor,
      rejoinTeamId
    );
    cancelReconnect();
    set((s) => ({
      // A mid-game rejoin gets a GAME_START from the host moments later,
      // which moves us on to client:playing.
      phase: 'client:lobby',
      client: {
        ...s.client,
        myTeamId: result.teamId,
        myColor: result.assignedColor,
        myName: result.assignedName,
        reconnecting: false,
      },
    }));
  },

  disconnect: async () => {
    // Leaving on purpose — stop trying to crawl back in.
    cancelReconnect();
    if (currentClient) {
      await currentClient.disconnect();
      currentClient = null;
    }
    set({ role: 'none', phase: 'none', client: initialClientState });
  },

  pressBuzz: async () => {
    if (!currentClient) return;
    currentClient.send({
      t: 'BUZZ',
      id: `buzz-${Date.now()}`,
      clientTsMs: Date.now(),
    });
  },

  setReady: async (ready) => {
    if (!currentClient) return;
    currentClient.send({
      t: 'READY',
      id: `ready-${Date.now()}`,
      ready,
    });
  },

  // ─── shared ──────────────────────────────────────────────────────
  reset: () => {
    if (currentServer) {
      currentServer.stop().catch(() => {});
      currentServer = null;
    }
    if (currentClient) {
      currentClient.disconnect().catch(() => {});
      currentClient = null;
    }
    set({
      role: 'none',
      phase: 'none',
      host: initialHostState,
      client: initialClientState,
    });
  },
}));
