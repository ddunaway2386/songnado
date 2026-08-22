/**
 * Host-side TCP server for buzz mode.
 *
 * Wraps `react-native-tcp-socket` with our newline-delimited JSON
 * protocol and a typed event interface. The buzzGameStore drives this
 * — server.ts is dumb plumbing that emits "client X joined", "client
 * X sent message Y" events upward and accepts "broadcast" / "send to
 * one client" commands downward.
 *
 * Lifecycle is single-use: construct → start() → ... → stop(). To start
 * a new game, throw the old instance away and construct a fresh one.
 * This avoids any "reuse-bug-after-stop" surface area.
 *
 * What this layer DOES NOT do (out of scope for Phase 1):
 *  - Lobby state management (Phase 2)
 *  - Buzz-race adjudication (Phase 3)
 *  - Reconnection of dropped clients (Phase 5)
 *
 * It does handle:
 *  - TCP listen on an ephemeral port
 *  - Local-IP discovery via expo-network
 *  - Session ID generation
 *  - Per-socket buffer for NDJSON parsing
 *  - JOIN/JOIN_ACK handshake with version check
 *  - Mapping socket ↔ teamId
 *  - Clean broadcast / send-to-one
 *  - SHUTDOWN broadcast on stop()
 */

import * as Network from 'expo-network';
import TcpSocket from 'react-native-tcp-socket';

import {
  BUZZ_DEFAULT_PORT,
  PROTOCOL_VERSION,
  TEAM_COLORS,
  decode,
  encode,
  newMsgId,
} from './protocol';
import type {
  ClientMsg,
  HostJoinAckMsg,
  HostJoinRejectMsg,
  HostMsg,
  HostShutdownMsg,
  TeamColor,
} from './protocol';

/** Ephemeral port range — RFC 6335 dynamic/private. */
const PORT_MIN = 49152;
const PORT_MAX = 65535;
const MAX_TEAMS = 6;
/** Largest NDJSON line we'll buffer from one peer before hanging up. */
const MAX_BUFFER_BYTES = 64 * 1024;
/** How long a connection may stay silent before we assume it isn't a client. */
const UNJOINED_GRACE_MS = 10_000;

function randomPort(): number {
  // eslint-disable-next-line no-restricted-syntax -- non-crypto port pick is fine
  return PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN));
}

function randomSessionId(): string {
  // 6-hex chars; lives only for the duration of one game.
  // eslint-disable-next-line no-restricted-syntax -- session id is not a secret
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
}

function randomTeamId(): string {
  // eslint-disable-next-line no-restricted-syntax -- team id is not a secret
  return 't_' + Math.random().toString(36).slice(2, 10);
}

export interface BuzzServerListeningInfo {
  localIp: string;
  port: number;
  sessionId: string;
}

export interface BuzzServerEvents {
  /** Server bound to a port and is accepting connections. */
  listening: (info: BuzzServerListeningInfo) => void;
  /** A client completed JOIN and is now a recognized team. */
  clientJoined: (teamId: string, name: string, color: TeamColor) => void;
  /** A joined client sent a parsed protocol message. */
  clientMessage: (teamId: string, msg: ClientMsg) => void;
  /** A joined client's socket dropped (intentional or not). */
  clientDisconnected: (teamId: string) => void;
  /**
   * A previously-dropped team reattached on a new socket. Distinct from
   * clientJoined so the host can restore them mid-game instead of treating
   * them as a newcomer — their score and place in the pick rotation survive.
   */
  clientRejoined: (teamId: string, name: string, color: TeamColor) => void;
  /** Server-level error (couldn't bind, accept failed, etc.). */
  error: (err: Error) => void;
  /** Server closed (stop() completed). */
  closed: () => void;
}

type Listener<K extends keyof BuzzServerEvents> = BuzzServerEvents[K];

interface ClientConn {
  socket: TcpSocket.Socket;
  buffer: string;
  /** Set after successful JOIN. */
  teamId: string | null;
  name: string | null;
  color: TeamColor | null;
}

export class BuzzServer {
  private server: TcpSocket.Server | null = null;
  private info: BuzzServerListeningInfo | null = null;
  /** All open connections keyed by an internal incremental id. */
  private conns = new Map<number, ClientConn>();
  private nextConnId = 0;
  /** Reverse lookup: teamId → connId. Only currently-connected teams. */
  private teamToConn = new Map<string, number>();
  /**
   * Every team seen this session, including ones that have dropped. This is
   * what makes a rejoin possible: the identity outlives the socket.
   */
  private knownTeams = new Map<string, { name: string; color: TeamColor }>();
  /**
   * Used team colors (so we don't double-assign). Colors are deliberately
   * NOT released on disconnect — a team that comes back should come back
   * the same color, and with MAX_TEAMS === TEAM_COLORS.length there's no
   * shortage to reclaim.
   */
  private usedColors = new Set<TeamColor>();
  private listeners: { [K in keyof BuzzServerEvents]?: Listener<K>[] } = {};
  private stopped = false;

  on<K extends keyof BuzzServerEvents>(event: K, fn: Listener<K>): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event]!.push(fn);
  }

  off<K extends keyof BuzzServerEvents>(event: K, fn: Listener<K>): void {
    const list = this.listeners[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  private emit<K extends keyof BuzzServerEvents>(
    event: K,
    ...args: Parameters<Listener<K>>
  ): void {
    const list = this.listeners[event];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch (e) {
        // listener bug shouldn't kill the server
        console.warn('[BuzzServer] listener threw:', e);
      }
    }
  }

  /**
   * Start listening. Tries BUZZ_DEFAULT_PORT first so guests can join with
   * a short room code (the code carries only the host's final IP octet —
   * see encodeShortCode). Falls back to ephemeral ports if that one is
   * taken, in which case guests need the long-form connection string.
   *
   * Resolves with the (ip, port, sessionId) used.
   */
  async start(): Promise<BuzzServerListeningInfo> {
    if (this.server) throw new Error('BuzzServer already started');

    const ip = await Network.getIpAddressAsync();
    if (!ip || ip === '0.0.0.0') {
      throw new Error(
        'Could not resolve local IP. Is this device on Wi-Fi?'
      );
    }
    const sessionId = randomSessionId();

    let lastErr: Error | null = null;
    const candidates = [
      BUZZ_DEFAULT_PORT,
      ...Array.from({ length: 5 }, () => randomPort()),
    ];
    for (const port of candidates) {
      try {
        await this.bind(port);
        this.info = { localIp: ip, port, sessionId };
        this.emit('listening', this.info);
        return this.info;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        // try the next candidate port
      }
    }
    throw new Error(
      `Could not bind a TCP port after ${candidates.length} attempts: ${lastErr?.message}`
    );
  }

  private bind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = TcpSocket.createServer((socket) =>
        this.handleNewSocket(socket)
      );
      server.on('error', (err) => {
        if (!this.server) {
          reject(err);
        } else {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      });
      server.listen({ port, host: '0.0.0.0', reuseAddress: true }, () => {
        this.server = server;
        resolve();
      });
    });
  }

  private handleNewSocket(socket: TcpSocket.Socket): void {
    const connId = this.nextConnId++;
    const conn: ClientConn = {
      socket,
      buffer: '',
      teamId: null,
      name: null,
      color: null,
    };
    this.conns.set(connId, conn);

    // Anything that connects and never identifies itself gets shown out.
    // Port scanners, other apps probing the LAN, and half-open connections
    // all land here; without this they accumulate for the whole session.
    const joinTimer = setTimeout(() => {
      if (!conn.teamId) {
        console.warn('[BuzzServer] conn', connId, 'never sent JOIN — closing');
        try {
          socket.destroy();
        } catch {
          // already gone
        }
      }
    }, UNJOINED_GRACE_MS);

    socket.on('data', (data) => {
      try {
        const chunk =
          typeof data === 'string' ? data : data.toString('utf8');
        conn.buffer += chunk;

        // A peer that never sends a newline would otherwise grow this
        // forever. Nothing in the protocol comes close to this size, so
        // anything that does is noise, not a client.
        if (conn.buffer.length > MAX_BUFFER_BYTES) {
          console.warn('[BuzzServer] oversized buffer, dropping conn', connId);
          conn.buffer = '';
          socket.destroy();
          return;
        }

        const { messages, remainder } = decode<ClientMsg>(conn.buffer);
        conn.buffer = remainder;
        for (const msg of messages) {
          this.routeClientMessage(connId, conn, msg);
        }
      } catch (e) {
        // One malformed peer must never take the host's game down with it.
        console.warn('[BuzzServer] error handling data:', e);
      }
    });

    socket.on('error', (err) => {
      this.emit(
        'error',
        err instanceof Error ? err : new Error(String(err))
      );
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      this.conns.delete(connId);
      if (conn.teamId) {
        // Only drop the socket mapping. The team stays in knownTeams and
        // keeps its color reserved so a rejoin can restore it intact.
        if (this.teamToConn.get(conn.teamId) === connId) {
          this.teamToConn.delete(conn.teamId);
        }
        this.emit('clientDisconnected', conn.teamId);
      }
    });
  }

  private routeClientMessage(
    connId: number,
    conn: ClientConn,
    msg: ClientMsg
  ): void {
    if (msg.t === 'JOIN') {
      this.handleJoin(connId, conn, msg);
      return;
    }
    // All other messages require a completed JOIN.
    if (!conn.teamId) {
      console.warn(
        `[BuzzServer] dropping ${msg.t} from un-joined conn ${connId}`
      );
      return;
    }
    if (msg.t === 'PING') {
      this.sendOne(conn, {
        t: 'PONG',
        id: newMsgId(),
        clientTsMs: msg.clientTsMs,
        hostTsMs: Date.now(),
      });
      return;
    }
    this.emit('clientMessage', conn.teamId, msg);
  }

  private handleJoin(
    connId: number,
    conn: ClientConn,
    msg: Extract<ClientMsg, { t: 'JOIN' }>
  ): void {
    // Protocol version check
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      const reject: HostJoinRejectMsg = {
        t: 'JOIN_REJECT',
        id: newMsgId(),
        reason: 'version_mismatch',
        message: `Host wants v${PROTOCOL_VERSION}, client sent v${msg.protocolVersion}.`,
      };
      this.sendOne(conn, reject);
      conn.socket.end();
      return;
    }
    // Rejoin: a team we already know, currently without a socket. Checked
    // before capacity and color assignment — coming back isn't taking a new
    // seat, it's sitting back down in the one you already had.
    const rejoinId = msg.rejoinTeamId;
    if (rejoinId) {
      const known = this.knownTeams.get(rejoinId);
      if (known && !this.teamToConn.has(rejoinId)) {
        conn.teamId = rejoinId;
        conn.name = known.name;
        conn.color = known.color;
        this.teamToConn.set(rejoinId, connId);
        this.sendOne(conn, {
          t: 'JOIN_ACK',
          id: newMsgId(),
          protocolVersion: PROTOCOL_VERSION,
          teamId: rejoinId,
          assignedColor: known.color,
          assignedName: known.name,
          rejoined: true,
        });
        this.emit('clientRejoined', rejoinId, known.name, known.color);
        return;
      }
      // Unknown id, or that team is already connected on another socket
      // (duplicate app instance). Fall through and treat as a fresh join
      // rather than kicking the live connection off.
    }

    // Capacity check
    if (this.teamToConn.size >= MAX_TEAMS) {
      const reject: HostJoinRejectMsg = {
        t: 'JOIN_REJECT',
        id: newMsgId(),
        reason: 'lobby_full',
        message: `This game is full (max ${MAX_TEAMS} teams).`,
      };
      this.sendOne(conn, reject);
      conn.socket.end();
      return;
    }
    // Pick a color: requested if free, else first available.
    let assignedColor: TeamColor = msg.desiredColor;
    if (!TEAM_COLORS.includes(assignedColor) || this.usedColors.has(assignedColor)) {
      const free = TEAM_COLORS.find((c) => !this.usedColors.has(c));
      if (!free) {
        // Shouldn't happen with capacity check above, but just in case.
        const reject: HostJoinRejectMsg = {
          t: 'JOIN_REJECT',
          id: newMsgId(),
          reason: 'lobby_full',
          message: 'No team colors available.',
        };
        this.sendOne(conn, reject);
        conn.socket.end();
        return;
      }
      assignedColor = free;
    }
    const assignedName = (msg.desiredName || '').trim().slice(0, 24) || `Team ${this.teamToConn.size + 1}`;
    const teamId = randomTeamId();

    conn.teamId = teamId;
    conn.name = assignedName;
    conn.color = assignedColor;
    this.usedColors.add(assignedColor);
    this.teamToConn.set(teamId, connId);
    this.knownTeams.set(teamId, { name: assignedName, color: assignedColor });

    const ack: HostJoinAckMsg = {
      t: 'JOIN_ACK',
      id: newMsgId(),
      protocolVersion: PROTOCOL_VERSION,
      teamId,
      assignedColor,
      assignedName,
    };
    this.sendOne(conn, ack);
    this.emit('clientJoined', teamId, assignedName, assignedColor);
  }

  /** Send to every joined client. */
  broadcast(msg: HostMsg): void {
    const wire = encode(msg);
    for (const conn of this.conns.values()) {
      if (!conn.teamId) continue;
      this.writeRaw(conn, wire);
    }
  }

  /** Send to one team. No-op if team isn't currently connected. */
  sendTo(teamId: string, msg: HostMsg): void {
    const connId = this.teamToConn.get(teamId);
    if (connId == null) return;
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.sendOne(conn, msg);
  }

  private sendOne(conn: ClientConn, msg: HostMsg): void {
    this.writeRaw(conn, encode(msg));
  }

  private writeRaw(conn: ClientConn, wire: string): void {
    try {
      conn.socket.write(wire);
    } catch (e) {
      console.warn(
        '[BuzzServer] write failed for team',
        conn.teamId,
        e
      );
    }
  }

  /** Broadcast SHUTDOWN and close all sockets + the listening server. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const shutdown: HostShutdownMsg = {
      t: 'SHUTDOWN',
      id: newMsgId(),
      reason: 'host_quit',
    };
    try {
      this.broadcast(shutdown);
    } catch {
      // best-effort
    }
    for (const conn of this.conns.values()) {
      try {
        conn.socket.destroy();
      } catch {
        // best-effort
      }
    }
    this.conns.clear();
    this.teamToConn.clear();
    this.usedColors.clear();
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // best-effort
      }
      this.server = null;
    }
    this.emit('closed');
  }

  /** For UI: how many joined teams currently. */
  joinedCount(): number {
    return this.teamToConn.size;
  }

  listeningInfo(): BuzzServerListeningInfo | null {
    return this.info;
  }
}
