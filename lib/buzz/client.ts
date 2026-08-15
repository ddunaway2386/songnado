/**
 * Client-side TCP connection for buzz mode.
 *
 * Wraps `react-native-tcp-socket` with our NDJSON protocol. Single-use:
 * construct → connect() → ... → disconnect(). Throw away to retry.
 *
 * Responsibilities:
 *  - Open the TCP connection to the host
 *  - Send JOIN and wait for JOIN_ACK (or JOIN_REJECT)
 *  - Buffer incoming bytes, parse NDJSON, emit typed messages
 *  - Manage a PING loop, track round-trip latency
 *  - Surface disconnects cleanly
 *
 * Phase 1 scope. Phase 5 adds reconnection. Phase 2-3 layer game logic
 * on top using the events this emits.
 */

import TcpSocket from 'react-native-tcp-socket';

import { PingTracker } from './ping';
import {
  PROTOCOL_VERSION,
  decode,
  encode,
  newMsgId,
} from './protocol';
import type {
  ClientJoinMsg,
  ClientMsg,
  ConnectionString,
  HostMsg,
  HostJoinAckMsg,
  HostJoinRejectMsg,
  TeamColor,
} from './protocol';

const JOIN_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 3_000;

export interface BuzzClientJoinResult {
  teamId: string;
  assignedName: string;
  assignedColor: TeamColor;
}

export interface BuzzClientEvents {
  /** Underlying TCP socket opened (before JOIN). */
  socketOpen: () => void;
  /** JOIN_ACK received; team identity established. */
  joined: (result: BuzzClientJoinResult) => void;
  /** Any host message OTHER than JOIN_ACK/JOIN_REJECT/PONG. */
  hostMessage: (msg: HostMsg) => void;
  /** PING round-trip recorded; emits the current median ms. */
  pingUpdate: (medianMs: number) => void;
  /** Connection lost — could be intentional or network drop. */
  disconnected: (reason: 'host_shutdown' | 'socket_closed' | 'error') => void;
  /** Any error during connect / send / parse. */
  error: (err: Error) => void;
}

type Listener<K extends keyof BuzzClientEvents> = BuzzClientEvents[K];

export class BuzzClient {
  private socket: TcpSocket.Socket | null = null;
  private buffer = '';
  private joined = false;
  private joinResult: BuzzClientJoinResult | null = null;
  private ping = new PingTracker();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private outstandingPings = new Map<string, number>(); // id → sent epoch ms
  private listeners: { [K in keyof BuzzClientEvents]?: Listener<K>[] } = {};
  private disposed = false;

  on<K extends keyof BuzzClientEvents>(event: K, fn: Listener<K>): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event]!.push(fn);
  }

  off<K extends keyof BuzzClientEvents>(event: K, fn: Listener<K>): void {
    const list = this.listeners[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  private emit<K extends keyof BuzzClientEvents>(
    event: K,
    ...args: Parameters<Listener<K>>
  ): void {
    const list = this.listeners[event];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch (e) {
        console.warn('[BuzzClient] listener threw:', e);
      }
    }
  }

  /**
   * Open the TCP connection, send JOIN, await JOIN_ACK.
   * Rejects on JOIN_REJECT, JOIN timeout, or socket error before ack.
   */
  async connect(
    conn: ConnectionString,
    desiredName: string,
    desiredColor: TeamColor,
    /**
     * TeamId from an earlier JOIN_ACK in this session. Supplying it asks the
     * host to reattach us to that team rather than create a new one, so a
     * player whose phone rang comes back with their score intact.
     */
    rejoinTeamId?: string
  ): Promise<BuzzClientJoinResult> {
    if (this.socket) throw new Error('BuzzClient already connected');
    if (this.disposed) throw new Error('BuzzClient disposed');

    return new Promise<BuzzClientJoinResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const joinTimer = setTimeout(() => {
        settle(() => {
          this.disconnect().catch(() => {});
          reject(new Error('JOIN timed out (no JOIN_ACK from host).'));
        });
      }, JOIN_TIMEOUT_MS);

      const socket = TcpSocket.createConnection(
        { host: conn.host, port: conn.port },
        () => {
          this.emit('socketOpen');
          // Send JOIN once TCP is open
          const join: ClientJoinMsg = {
            t: 'JOIN',
            id: newMsgId(),
            protocolVersion: PROTOCOL_VERSION,
            desiredName,
            desiredColor,
            ...(rejoinTeamId ? { rejoinTeamId } : {}),
          };
          try {
            socket.write(encode(join));
          } catch (e) {
            clearTimeout(joinTimer);
            settle(() => {
              reject(
                e instanceof Error ? e : new Error(String(e))
              );
            });
          }
        }
      );

      socket.on('data', (data) => {
        const chunk =
          typeof data === 'string' ? data : data.toString('utf8');
        this.buffer += chunk;
        const { messages, remainder } = decode<HostMsg>(this.buffer);
        this.buffer = remainder;
        for (const msg of messages) {
          if (!this.joined) {
            if (msg.t === 'JOIN_ACK') {
              clearTimeout(joinTimer);
              this.joined = true;
              const result: BuzzClientJoinResult = {
                teamId: (msg as HostJoinAckMsg).teamId,
                assignedName: (msg as HostJoinAckMsg).assignedName,
                assignedColor: (msg as HostJoinAckMsg).assignedColor,
              };
              this.joinResult = result;
              this.startPingLoop();
              settle(() => resolve(result));
            } else if (msg.t === 'JOIN_REJECT') {
              clearTimeout(joinTimer);
              const reason = (msg as HostJoinRejectMsg).reason;
              const message = (msg as HostJoinRejectMsg).message;
              settle(() => {
                this.disconnect().catch(() => {});
                reject(new Error(`JOIN_REJECT (${reason}): ${message}`));
              });
            }
            // Drop any other pre-join messages.
            continue;
          }
          this.handleHostMessage(msg);
        }
      });

      socket.on('error', (err) => {
        clearTimeout(joinTimer);
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit('error', error);
        settle(() => reject(error));
      });

      socket.on('close', () => {
        clearTimeout(joinTimer);
        this.cleanupSocket('socket_closed');
        if (!settled) {
          settle(() => reject(new Error('Socket closed before JOIN_ACK.')));
        }
      });

      this.socket = socket;
    });
  }

  private handleHostMessage(msg: HostMsg): void {
    if (msg.t === 'PONG') {
      const sentAt = this.outstandingPings.get(msg.id);
      if (sentAt != null) {
        const rtt = Date.now() - sentAt;
        this.outstandingPings.delete(msg.id);
        this.ping.record(rtt);
        const median = this.ping.median();
        if (median != null) this.emit('pingUpdate', median);
      }
      return;
    }
    if (msg.t === 'SHUTDOWN') {
      this.cleanupSocket('host_shutdown');
      return;
    }
    this.emit('hostMessage', msg);
  }

  private startPingLoop(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, PING_INTERVAL_MS);
    // Send one immediately to get a fast initial latency estimate.
    this.sendPing();
  }

  private sendPing(): void {
    if (!this.socket || !this.joined) return;
    const id = newMsgId();
    this.outstandingPings.set(id, Date.now());
    // Drop very old outstanding pings to avoid unbounded growth.
    const cutoff = Date.now() - PING_INTERVAL_MS * 5;
    for (const [pid, t] of this.outstandingPings) {
      if (t < cutoff) this.outstandingPings.delete(pid);
    }
    this.send({
      t: 'PING',
      id,
      clientTsMs: Date.now(),
    });
  }

  /** Send a message to the host. Silently no-ops if not connected/joined. */
  send(msg: ClientMsg): void {
    if (!this.socket) return;
    try {
      this.socket.write(encode(msg));
    } catch (e) {
      this.emit(
        'error',
        e instanceof Error ? e : new Error(String(e))
      );
    }
  }

  /** Current median round-trip ping in ms, or null if not yet measured. */
  medianPingMs(): number | null {
    return this.ping.median();
  }

  joinedTeam(): BuzzClientJoinResult | null {
    return this.joinResult;
  }

  isConnected(): boolean {
    return this.socket != null && !this.disposed;
  }

  /** Clean shutdown. Idempotent. */
  async disconnect(): Promise<void> {
    this.disposed = true;
    this.cleanupSocket('socket_closed');
  }

  private cleanupSocket(
    reason: 'host_shutdown' | 'socket_closed' | 'error'
  ): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      try {
        s.destroy();
      } catch {
        // best-effort
      }
    }
    const wasJoined = this.joined;
    this.joined = false;
    if (wasJoined) {
      this.emit('disconnected', reason);
    }
  }
}
