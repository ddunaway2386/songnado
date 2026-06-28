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
  /** TeamId whose buzzer is currently locked-in for answering. */
  answeringTeamId: string | null;
  /** Seconds remaining in the answer window; null when no team is answering. */
  answerSecsLeft: number | null;
  /** TeamIds eliminated for the current round only (reset between rounds). */
  eliminatedThisRound: Set<string>;
  /** Persistent team scores, by teamId. */
  scores: Record<string, number>;
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
  /** Host taps "Start Game" once all teams ready. */
  hostStartGame: (totalRounds: number) => Promise<void>;
  /** Host's "Correct" / "Wrong" judgment on the buzzed team. */
  hostJudgeAnswer: (correct: boolean) => Promise<void>;
  /** Force-arm buzzers for the current round (after audio play starts). */
  hostArmBuzzers: () => Promise<void>;

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
  answeringTeamId: null,
  answerSecsLeft: null,
  eliminatedThisRound: new Set(),
  scores: {},
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
      }
      // BUZZ is handled in Phase 3 (round flow).
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

  hostStartGame: async (totalRounds) => {
    set((s) => ({
      phase: 'host:playing',
      host: { ...s.host, totalRounds, currentRound: 1 },
    }));
    // Phase 3 will broadcast GAME_START and drive the round loop here.
  },

  hostJudgeAnswer: async (_correct) => {
    // Phase 3 wires up the correct/wrong → next-round / elimination flow.
  },

  hostArmBuzzers: async () => {
    // Phase 3 broadcasts BUZZ_ARMED with eligible team IDs.
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
