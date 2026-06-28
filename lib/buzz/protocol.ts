/**
 * Wire protocol for buzz mode multi-device games.
 *
 * Transport: TCP socket (newline-delimited JSON, one message per line).
 * See `./README.md` for the architectural overview.
 *
 * Conventions:
 *  - All messages carry a discriminator `t` (type) for cheap switch-routing.
 *  - All messages carry an `id` (uuid) so we can ack/correlate if needed.
 *  - Timestamps are integer epoch ms. Client and host clocks are not
 *    assumed to be in sync; we use ping-based offsets for buzz timing
 *    (see ping.ts) rather than wall clocks.
 *
 * Versioning: bump `PROTOCOL_VERSION` on any breaking message change.
 * The host and client exchange versions in JOIN/JOIN_ACK and refuse to
 * play if they don't match.
 */

import type { GameMode } from '../types';

export const PROTOCOL_VERSION = 1 as const;

/** Six distinct team colors; clients pick at lobby join. */
export const TEAM_COLORS = [
  '#E63946', // red
  '#F4A261', // orange
  '#E9C46A', // yellow
  '#2A9D8F', // teal
  '#457B9D', // blue
  '#B5179E', // magenta
] as const;
export type TeamColor = (typeof TEAM_COLORS)[number];

// ─── shared sub-types ─────────────────────────────────────────────────────

export interface LobbyTeam {
  /** Stable team ID assigned by host on JOIN. */
  teamId: string;
  name: string;
  color: TeamColor;
  /** True once the team has tapped "Ready" in lobby. */
  ready: boolean;
  /** Round-trip ping to host in ms; null if not yet measured. */
  pingMs: number | null;
  /** True if the client's TCP socket is currently connected. */
  connected: boolean;
}

export interface RoundReveal {
  songTitle: string;
  artist: string;
  /** Movie/show/musical/brand label, if any. */
  source: string | null;
  coverUrl: string;
}

// ─── client → host ────────────────────────────────────────────────────────

/** First message a client sends on connect. */
export interface ClientJoinMsg {
  t: 'JOIN';
  id: string;
  protocolVersion: number;
  /** Pre-chosen name; host may rename on conflict. */
  desiredName: string;
  /** Pre-chosen color; host reassigns if taken. */
  desiredColor: TeamColor;
}

/** User tapped the buzz button. */
export interface ClientBuzzMsg {
  t: 'BUZZ';
  id: string;
  /** Client clock at the moment of tap. Host adjusts using ping offset. */
  clientTsMs: number;
}

/** User toggled their ready state in lobby. */
export interface ClientReadyMsg {
  t: 'READY';
  id: string;
  ready: boolean;
}

/** Keepalive + latency probe. Host echoes with PONG. */
export interface ClientPingMsg {
  t: 'PING';
  id: string;
  clientTsMs: number;
}

export type ClientMsg =
  | ClientJoinMsg
  | ClientBuzzMsg
  | ClientReadyMsg
  | ClientPingMsg;

// ─── host → client ────────────────────────────────────────────────────────

/** Host's reply to a successful JOIN. */
export interface HostJoinAckMsg {
  t: 'JOIN_ACK';
  id: string;
  protocolVersion: number;
  /** Final team ID + assigned color (may differ from desired). */
  teamId: string;
  assignedColor: TeamColor;
  assignedName: string;
}

/** Host refused the join (version mismatch, lobby full, game in progress). */
export interface HostJoinRejectMsg {
  t: 'JOIN_REJECT';
  id: string;
  reason: 'version_mismatch' | 'lobby_full' | 'game_in_progress';
  message: string;
}

/** Broadcast on every lobby change. */
export interface HostLobbyStateMsg {
  t: 'LOBBY_STATE';
  id: string;
  gameMode: GameMode;
  /** Currently selected playlist name (for client display). */
  playlistName: string;
  teams: LobbyTeam[];
  /** True when the host has tapped "Start Game". */
  starting: boolean;
}

/** Game has begun. */
export interface HostGameStartMsg {
  t: 'GAME_START';
  id: string;
  totalRounds: number;
}

/** A new round is about to begin (host is queuing audio). */
export interface HostRoundStartMsg {
  t: 'ROUND_START';
  id: string;
  roundNumber: number;
}

/** Buzzers are now active — clients should enable their BUZZ button. */
export interface HostBuzzArmedMsg {
  t: 'BUZZ_ARMED';
  id: string;
  /** Teams whose buzzers should be enabled this round. Eliminated teams excluded. */
  eligibleTeamIds: string[];
}

/** Buzzers locked (during reveal, between rounds, or while a team is answering). */
export interface HostBuzzLockedMsg {
  t: 'BUZZ_LOCKED';
  id: string;
}

/**
 * A team won the buzz race. The winning client should show
 * "your turn" UI; others show "Team X is answering — waiting".
 */
export interface HostBuzzWinnerMsg {
  t: 'BUZZ_WINNER';
  id: string;
  winningTeamId: string;
  /** Seconds the team has to answer before timeout (default 5). */
  answerWindowSec: number;
}

/** A team got eliminated for this round (wrong answer or timeout). */
export interface HostTeamEliminatedMsg {
  t: 'TEAM_ELIMINATED';
  id: string;
  teamId: string;
}

/** Round over — reveal answer + show updated scores. */
export interface HostRoundEndMsg {
  t: 'ROUND_END';
  id: string;
  roundNumber: number;
  /**
   * Winning team for this round, or null if everyone got eliminated.
   * (No-winner rounds are valid game states.)
   */
  winningTeamId: string | null;
  reveal: RoundReveal;
  /** Updated team scores keyed by teamId. */
  scores: Record<string, number>;
}

/** Game over — show final standings. */
export interface HostGameEndMsg {
  t: 'GAME_END';
  id: string;
  /** teamIds in finishing order (first = winner). */
  ranking: string[];
  scores: Record<string, number>;
}

/** Reply to a PING. */
export interface HostPongMsg {
  t: 'PONG';
  id: string;
  clientTsMs: number;
  hostTsMs: number;
}

/** Host is about to disconnect (intentional shutdown). */
export interface HostShutdownMsg {
  t: 'SHUTDOWN';
  id: string;
  reason: 'host_quit' | 'host_backgrounded' | 'error';
}

export type HostMsg =
  | HostJoinAckMsg
  | HostJoinRejectMsg
  | HostLobbyStateMsg
  | HostGameStartMsg
  | HostRoundStartMsg
  | HostBuzzArmedMsg
  | HostBuzzLockedMsg
  | HostBuzzWinnerMsg
  | HostTeamEliminatedMsg
  | HostRoundEndMsg
  | HostGameEndMsg
  | HostPongMsg
  | HostShutdownMsg;

// ─── (de)serialization ────────────────────────────────────────────────────

/** Encode a single message as a JSON line (with trailing newline). */
export function encode(msg: ClientMsg | HostMsg): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Parse zero or more newline-delimited JSON messages from a buffer.
 * Returns the parsed messages and any leftover (incomplete-line) buffer.
 * Lines that fail to parse are dropped silently; caller can log if desired.
 */
export function decode<T extends ClientMsg | HostMsg>(
  buffer: string
): { messages: T[]; remainder: string } {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  const messages: T[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as T);
    } catch {
      // malformed line, skip
    }
  }
  return { messages, remainder };
}

/**
 * Generate a short unique message id without depending on crypto.
 * Format: `${epochMs}-${counter}-${random}`. Not cryptographically secure,
 * but adequate for de-duping and ack-correlation within a single game.
 */
let _idCounter = 0;
export function newMsgId(): string {
  _idCounter = (_idCounter + 1) % 1_000_000;
  // eslint-disable-next-line no-restricted-syntax -- Math.random is acceptable for id generation
  return `${Date.now().toString(36)}-${_idCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ─── connection-string helpers ────────────────────────────────────────────

/**
 * QR-payload format for a buzz session join.
 * Example: `songnado-buzz:v1:192.168.1.42:52341:8c4f2a`
 */
export interface ConnectionString {
  host: string; // IPv4
  port: number;
  sessionId: string; // random 6-char hex
}

export function encodeConnectionString(c: ConnectionString): string {
  return `songnado-buzz:v${PROTOCOL_VERSION}:${c.host}:${c.port}:${c.sessionId}`;
}

export function decodeConnectionString(s: string): ConnectionString | null {
  const m = s.match(
    /^songnado-buzz:v(\d+):(\d+\.\d+\.\d+\.\d+):(\d+):([a-f0-9]+)$/i
  );
  if (!m) return null;
  const version = parseInt(m[1], 10);
  if (version !== PROTOCOL_VERSION) return null;
  return {
    host: m[2],
    port: parseInt(m[3], 10),
    sessionId: m[4].toLowerCase(),
  };
}
