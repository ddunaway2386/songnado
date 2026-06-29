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
export type RoundSubPhase = 'idle' | 'playing' | 'answering' | 'reveal';

interface HostState {
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
  /** Playlist the host picked at game start. Set by the host-game screen. */
  currentPlaylistId: string | null;
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
  buzzButton: BuzzButtonState;
  /** Last round reveal we received from host. */
  lastReveal: RoundReveal | null;
  /** Current round-trip ping to host in ms. */
  pingMs: number | null;
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
    playlistId: string,
    playlistName: string,
    playlistTotalTracks: number
  ) => Promise<void>;
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
    desiredColor: TeamColor
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
  currentPlaylistId: null,
  currentPlaylistName: null,
  playedTrackIndices: [],
  playlistTotalTracks: 0,
  answeringTeamId: null,
  eliminatedThisRound: [],
  scores: {},
  lastReveal: null,
};

const initialClientState: ClientState = {
  connection: null,
  myTeamId: null,
  myColor: null,
  myName: null,
  lobbyTeams: [],
  buzzButton: 'locked',
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

  hostStartGame: async (
    totalRounds,
    playlistId,
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
        roundSubPhase: 'idle',
        currentPlaylistId: playlistId,
        currentPlaylistName: playlistName,
        playlistTotalTracks,
        playedTrackIndices: [],
        scores: initialScores,
        eliminatedThisRound: [],
        lastReveal: null,
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
    const eligible = Object.values(s0.host.teams)
      .filter((t) => t.connected)
      .map((t) => t.teamId);
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
    });
    currentServer.broadcast({
      t: 'BUZZ_ARMED',
      id: newMsgId(),
      eligibleTeamIds: eligible,
    });
  },

  hostJudgeCorrect: () => {
    if (!currentServer) return;
    const s0 = useBuzzGameStore.getState();
    const winnerId = s0.host.answeringTeamId;
    if (!winnerId) return;
    const newScores = {
      ...s0.host.scores,
      [winnerId]: (s0.host.scores[winnerId] ?? 0) + 1,
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

    const stillIn = Object.values(s0.host.teams)
      .filter((t) => t.connected && !newEliminated.includes(t.teamId))
      .map((t) => t.teamId);

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
    const nextRound = s0.host.currentRound + 1;
    if (nextRound > s0.host.totalRounds) {
      // Game over: rank teams by score
      const ranking = Object.entries(s0.host.scores)
        .sort(([, a], [, b]) => b - a)
        .map(([id]) => id);
      currentServer?.broadcast({
        t: 'GAME_END',
        id: newMsgId(),
        ranking,
        scores: s0.host.scores,
      });
      set({ phase: 'host:ended' });
      return;
    }
    set((s) => ({
      host: {
        ...s.host,
        currentRound: nextRound,
        roundSubPhase: 'idle',
        answeringTeamId: null,
        eliminatedThisRound: [],
        currentSong: null,
        lastReveal: null,
      },
    }));
  },

  // ─── client actions ──────────────────────────────────────────────
  joinAsClient: async (connection, desiredName, desiredColor) => {
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
      } else if (msg.t === 'GAME_START') {
        set({ phase: 'client:playing' });
      } else if (msg.t === 'GAME_END') {
        set({ phase: 'client:ended' });
      }
    });

    client.on('pingUpdate', (medianMs) => {
      set((s) => ({ client: { ...s.client, pingMs: medianMs } }));
    });

    client.on('disconnected', (_reason) => {
      set((s) => ({
        phase: s.phase === 'client:playing' ? 'client:ended' : 'none',
        client: { ...s.client, buzzButton: 'locked' },
      }));
    });

    client.on('error', (err) => {
      console.warn('[buzzGameStore] client error:', err.message);
    });

    const result = await client.connect(connection, desiredName, desiredColor);
    set((s) => ({
      phase: 'client:lobby',
      client: {
        ...s.client,
        myTeamId: result.teamId,
        myColor: result.assignedColor,
        myName: result.assignedName,
      },
    }));
  },

  disconnect: async () => {
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
