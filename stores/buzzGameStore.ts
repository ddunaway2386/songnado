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

// NOT persisted — buzz sessions are ephemeral. If the app backgrounds for
// more than a few seconds the TCP socket will drop anyway; rejoining is
// faster than trying to resume from disk.
export const useBuzzGameStore = create<BuzzState>((set, _get) => ({
  role: 'none',
  phase: 'none',
  host: initialHostState,
  client: initialClientState,

  // ─── host actions (Phase 1 will wire to lib/buzz/server.ts) ──────
  startHosting: async () => {
    set({ role: 'host', phase: 'host:lobby_starting' });
    // TODO Phase 1: resolve local IP, start TCP server, generate sessionId.
    // For now, transition to lobby_open with stub values so UI scaffolding
    // can be built/tested in isolation.
    set((s) => ({
      phase: 'host:lobby_open',
      host: {
        ...s.host,
        localIp: '0.0.0.0',
        port: 0,
        sessionId: 'stub',
      },
    }));
  },

  stopHosting: async () => {
    // TODO Phase 1: SHUTDOWN broadcast + close server socket.
    set({ role: 'none', phase: 'none', host: initialHostState });
  },

  hostStartGame: async (totalRounds) => {
    set((s) => ({
      phase: 'host:playing',
      host: { ...s.host, totalRounds, currentRound: 1 },
    }));
  },

  hostJudgeAnswer: async (_correct) => {
    // TODO Phase 3: implement correct/wrong → next-round or elimination flow.
  },

  hostArmBuzzers: async () => {
    // TODO Phase 1/3: broadcast BUZZ_ARMED.
  },

  // ─── client actions (Phase 1 will wire to lib/buzz/client.ts) ────
  joinAsClient: async (connection, desiredName, desiredColor) => {
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
    // TODO Phase 1: open TCP connection, send JOIN, await JOIN_ACK.
  },

  disconnect: async () => {
    set({ role: 'none', phase: 'none', client: initialClientState });
  },

  pressBuzz: async () => {
    // TODO Phase 1: send BUZZ message with client timestamp.
  },

  setReady: async (_ready) => {
    // TODO Phase 1: send READY message.
  },

  // ─── shared ──────────────────────────────────────────────────────
  reset: () => {
    set({
      role: 'none',
      phase: 'none',
      host: initialHostState,
      client: initialClientState,
    });
  },
}));
