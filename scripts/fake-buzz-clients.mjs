#!/usr/bin/env node
/**
 * Fake Buzz clients — test multi-device Buzz mode without borrowing phones.
 *
 * Your phone hosts as normal. This connects from your computer as one or
 * more pretend teams, speaking the real newline-delimited-JSON protocol
 * over a real TCP socket, so it exercises the actual transport rather than
 * simulating it. If a round works here, it works with phones.
 *
 * USAGE
 *   1. On your phone: New Game -> Buzz -> pick packs -> Open Buzz Lobby.
 *      Note the room code (e.g. 42).
 *   2. On this computer, on the SAME Wi-Fi:
 *
 *        node scripts/fake-buzz-clients.mjs 42
 *
 *      Or give a full address if the room code doesn't resolve:
 *
 *        node scripts/fake-buzz-clients.mjs 192.168.1.42:50505
 *
 *      Add more teams with --teams:
 *
 *        node scripts/fake-buzz-clients.mjs 42 --teams 3
 *
 *   3. Press 1, 2, 3... to buzz as that team. Everything the host sends is
 *      printed as it arrives.
 *
 * Press both keys fast to test the race — the host should lock exactly one.
 */

import net from 'node:net';
import os from 'node:os';
import readline from 'node:readline';

const PROTOCOL_VERSION = 1;
const DEFAULT_PORT = 50505;
const COLORS = ['#E63946', '#F4A261', '#E9C46A', '#2A9D8F', '#457B9D', '#B5179E'];
const NAMES = ['Test Alpha', 'Test Bravo', 'Test Charlie', 'Test Delta'];

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const teamCount = Math.min(
  parseInt(args[args.indexOf('--teams') + 1] ?? '2', 10) || 2,
  NAMES.length
);

if (!target) {
  console.error('Usage: node scripts/fake-buzz-clients.mjs <roomCode|ip:port> [--teams N]');
  process.exit(1);
}

/** This machine's LAN IP — supplies the subnet for a short room code. */
function localIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

function resolveTarget(t) {
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(t)) {
    const [host, port] = t.split(':');
    return { host, port: Number(port) };
  }
  if (/^\d{1,3}$/.test(t)) {
    const ip = localIp();
    if (!ip) throw new Error('Could not determine this computer\'s LAN IP.');
    const parts = ip.split('.');
    return { host: `${parts[0]}.${parts[1]}.${parts[2]}.${t}`, port: DEFAULT_PORT };
  }
  throw new Error(`Unrecognized target "${t}" — use a room code or ip:port.`);
}

const { host, port } = resolveTarget(target);
console.log(`connecting ${teamCount} fake team(s) to ${host}:${port}`);
console.log(`(this machine: ${localIp() ?? 'unknown'})\n`);

const msgId = () => Math.random().toString(36).slice(2, 10);

class FakeClient {
  constructor(index) {
    this.index = index;
    this.name = NAMES[index];
    this.color = COLORS[index % COLORS.length];
    this.teamId = null;
    this.buf = '';
    this.armed = false;
  }

  log(msg) {
    console.log(`[${this.index + 1}] ${this.name}: ${msg}`);
  }

  connect() {
    this.sock = net.createConnection({ host, port }, () => {
      this.log('connected — sending JOIN');
      this.send({
        t: 'JOIN',
        id: msgId(),
        protocolVersion: PROTOCOL_VERSION,
        desiredName: this.name,
        desiredColor: this.color,
      });
    });

    this.sock.on('data', (chunk) => {
      this.buf += chunk.toString('utf8');
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.trim()) this.handle(JSON.parse(line));
      }
    });

    this.sock.on('error', (e) => this.log(`socket error: ${e.message}`));
    this.sock.on('close', () => this.log('disconnected'));
  }

  send(msg) {
    this.sock?.write(JSON.stringify(msg) + '\n');
  }

  handle(m) {
    switch (m.t) {
      case 'JOIN_ACK':
        this.teamId = m.teamId ?? m.team?.teamId ?? null;
        this.log(`JOIN_ACK — teamId ${this.teamId}`);
        break;
      case 'JOIN_REJECT':
        this.log(`JOIN REJECTED: ${m.reason ?? 'no reason given'}`);
        break;
      case 'LOBBY_STATE':
        this.log(`lobby: ${(m.teams ?? []).map((t) => t.name).join(', ')}`);
        break;
      case 'GAME_START':
        this.log(`GAME START — ${m.totalRounds} rounds`);
        break;
      case 'ROUND_START':
        this.log(`round ${m.roundNumber} starting`);
        break;
      case 'BUZZ_ARMED':
        this.armed = !m.eligibleTeamIds || m.eligibleTeamIds.includes(this.teamId);
        this.log(this.armed ? '🔔 ARMED — press ' + (this.index + 1) + ' to buzz' : 'not eligible this round');
        break;
      case 'BUZZ_LOCKED':
        this.armed = false;
        this.log(`locked — ${m.teamId === this.teamId ? 'YOU buzzed first' : 'another team buzzed'}`);
        break;
      case 'BUZZ_WINNER':
        this.log(`winner: ${m.teamId === this.teamId ? 'YOU' : m.teamId}`);
        break;
      case 'TEAM_ELIMINATED':
        if (m.teamId === this.teamId) this.log('eliminated this round');
        break;
      case 'ROUND_END':
        this.armed = false;
        this.log(`round end — ${m.songTitle ?? '?'} by ${m.artist ?? '?'}`);
        break;
      case 'GAME_END':
        this.log(`GAME OVER — ranking ${JSON.stringify(m.ranking)} scores ${JSON.stringify(m.scores)}`);
        break;
      case 'PONG':
        break;
      case 'SHUTDOWN':
        this.log('host ended the session');
        break;
      default:
        this.log(`(${m.t})`);
    }
  }

  buzz() {
    if (!this.armed) {
      this.log('not armed — buzz ignored (this matches the app)');
      return;
    }
    this.log('BUZZ!');
    this.send({ t: 'BUZZ', id: msgId(), clientTsMs: Date.now() });
  }
}

const clients = Array.from({ length: teamCount }, (_, i) => new FakeClient(i));
clients.forEach((c) => c.connect());

// Keypress handling: 1..N buzz as that team, q quits.
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log(`\nPress 1-${teamCount} to buzz as that team. Press both fast to test the race. q to quit.\n`);

process.stdin.on('keypress', (str, key) => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    clients.forEach((c) => c.sock?.end());
    process.exit(0);
  }
  const n = parseInt(str, 10);
  if (n >= 1 && n <= clients.length) clients[n - 1].buzz();
});
