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
  /** Reverse lookup: teamId → connId. */
  private teamToConn = new Map<string, number>();
  /** Used team colors (so we don't double-assign). */
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

    socket.on('data', (data) => {
      const chunk =
        typeof data === 'string' ? data : data.toString('utf8');
      conn.buffer += chunk;
      const { messages, remainder } = decode<ClientMsg>(conn.buffer);
      conn.buffer = remainder;
      for (const msg of messages) {
        this.routeClientMessage(connId, conn, msg);
      }
    });

    socket.on('error', (err) => {
      this.emit(
        'error',
        err instanceof Error ? err : new Error(String(err))
      );
    });

    socket.on('close', () => {
      this.conns.delete(connId);
      if (conn.teamId) {
        this.teamToConn.delete(conn.teamId);
        if (conn.color) this.usedColors.delete(conn.color);
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
