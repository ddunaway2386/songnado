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

import fs from 'node:fs';
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

/**
 * Every usable IPv4 address on this machine. Plural on purpose: a desktop
 * commonly has Ethernet AND Wi-Fi, plus virtual adapters from Hyper-V, WSL,
 * VirtualBox or a VPN. Picking just the first one is how you end up scanning
 * a subnet the phone was never on.
 */
function localIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    }
  }
  return out;
}

/** Primary LAN IP — supplies the subnet for a short room code. */
function localIp() {
  return localIps()[0]?.address ?? null;
}

/**
 * Sweep every local /24 for anything listening on the buzz port. Saves
 * squinting at the phone for the room code, and — more usefully —
 * distinguishes "wrong code" from "phone can't be reached at all", which
 * look identical from a lone ETIMEDOUT.
 */
async function scan() {
  const ips = localIps();
  if (!ips.length) {
    console.error('No non-loopback IPv4 address found on this machine.');
    process.exit(1);
  }

  console.log('this machine:');
  for (const { name, address } of ips) console.log(`  ${address}  (${name})`);
  console.log('');

  const probe = (host) =>
    new Promise((resolve) => {
      const sock = net.createConnection({ host, port: DEFAULT_PORT });
      const done = (hit) => {
        sock.destroy();
        resolve(hit ? host : null);
      };
      sock.setTimeout(1200);
      sock.on('connect', () => done(true));
      sock.on('timeout', () => done(false));
      sock.on('error', () => done(false));
    });

  const subnets = [...new Set(ips.map((i) => i.address.split('.').slice(0, 3).join('.')))];
  const found = [];

  for (const prefix of subnets) {
    process.stdout.write(`scanning ${prefix}.1-254 on port ${DEFAULT_PORT} `);
    // Batched so we don't open 254 sockets at once and trip Windows' limits.
    for (let start = 1; start <= 254; start += 32) {
      const batch = [];
      for (let i = start; i < start + 32 && i <= 254; i++) {
        batch.push(probe(`${prefix}.${i}`));
      }
      for (const hit of await Promise.all(batch)) if (hit) found.push(hit);
      process.stdout.write('.');
    }
    console.log('');
  }
  console.log('');

  if (!found.length) {
    console.log('No buzz host found. Check, in this order:');
    console.log('  1. the phone is on the Buzz LOBBY screen RIGHT NOW (the');
    console.log('     server only listens while that screen is open)');
    console.log('  2. the small grey line under the room code on the phone —');
    console.log('     if its IP does not start with one of the subnets above,');
    console.log('     the phone is on a different network (guest Wi-Fi, or a');
    console.log('     mesh band that is isolated from this computer)');
    console.log('  3. router client/AP isolation is off');
    console.log('');
    console.log('You can always paste that grey line here verbatim:');
    console.log('  node scripts/fake-buzz-clients.mjs 192.168.1.42:50505:ab12cd');
    return;
  }
  for (const host of found) {
    console.log(`FOUND host at ${host}  ->  room code ${host.split('.')[3]}`);
    console.log(`  node scripts/fake-buzz-clients.mjs ${host.split('.')[3]}`);
  }
}

if (args.includes('--scan')) {
  await scan();
  process.exit(0);
}

if (!target) {
  console.error('Usage: node scripts/fake-buzz-clients.mjs <roomCode|ip:port> [--teams N]');
  console.error('       node scripts/fake-buzz-clients.mjs --scan   (find the host)');
  process.exit(1);
}

/**
 * Accepts every form the lobby screen shows, so you can read the phone
 * literally rather than translating:
 *   64                                     room code
 *   192.168.1.42                           bare IP (default port assumed)
 *   192.168.1.42:50505                     ip:port
 *   192.168.1.42:50505:ab12cd              the grey fallback line
 *   songnado-buzz:v1:192.168.1.42:50505:ab12cd   the QR payload
 */
function resolveTarget(t) {
  const s = t.replace(/^songnado-buzz:v\d+:/i, '');

  const m = s.match(/^(\d+\.\d+\.\d+\.\d+)(?::(\d+))?(?::[a-z0-9]+)?$/i);
  if (m) return { host: m[1], port: m[2] ? Number(m[2]) : DEFAULT_PORT };

  if (/^\d{1,3}$/.test(s)) {
    const ip = localIp();
    if (!ip) throw new Error('Could not determine this computer\'s LAN IP.');
    const parts = ip.split('.');
    return { host: `${parts[0]}.${parts[1]}.${parts[2]}.${s}`, port: DEFAULT_PORT };
  }

  throw new Error(
    `Unrecognized target "${t}".\n` +
      'Use the room code (e.g. 64), a full address (192.168.1.42:50505),\n' +
      'or run with --scan to find the host.'
  );
}

const { host, port } = resolveTarget(target);

const msgId = () => Math.random().toString(36).slice(2, 10);

// ─── session log ──────────────────────────────────────────────────────
//
// Terminal scrollback disappears when the process exits, which is exactly
// when you want to know what happened. Everything printed also lands in a
// file so a test can be examined afterwards instead of re-run from memory.

const LOG_PATH =
  args[args.indexOf('--log') + 1] && args.includes('--log')
    ? args[args.indexOf('--log') + 1]
    : 'buzz-test.log';
const START = Date.now();
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });

/** Print to the terminal and append to the log with a relative timestamp. */
function out(line) {
  console.log(line);
  const t = ((Date.now() - START) / 1000).toFixed(3).padStart(8);
  logStream.write(`[${t}s] ${line}\n`);
}

out(`connecting ${teamCount} fake team(s) to ${host}:${port}`);
out(`(this machine: ${localIp() ?? 'unknown'})`);
out(`logging this session to ${LOG_PATH}\n`);

class FakeClient {
  constructor(index) {
    this.index = index;
    this.name = NAMES[index];
    this.color = COLORS[index % COLORS.length];
    this.teamId = null;
    /** teamId held before a rejoin, so we can tell if the host recognized us. */
    this.previousTeamId = null;
    /** When we last dropped out, for measuring the rejoin gap. */
    this.droppedAt = null;
    this.buf = '';
    this.armed = false;
    this.connected = false;
  }

  log(msg) {
    out(`[${this.index + 1}] ${this.name}: ${msg}`);
  }

  connect(rejoinTeamId) {
    this.buf = '';
    this.armed = false;
    this.connected = false;
    this.sock = net.createConnection({ host, port }, () => {
      this.connected = true;
      this.log(
        rejoinTeamId ? `connected — JOIN (rejoin ${rejoinTeamId})` : 'connected — sending JOIN'
      );
      this.send({
        t: 'JOIN',
        id: msgId(),
        protocolVersion: PROTOCOL_VERSION,
        desiredName: this.name,
        desiredColor: this.color,
        ...(rejoinTeamId ? { rejoinTeamId } : {}),
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
    this.sock.on('close', () => {
      this.connected = false;
      this.armed = false;
      this.log('disconnected');
    });
  }

  /** Simulate the player's phone dropping out (call, swipe-away, dead battery). */
  dropOut() {
    if (!this.connected) {
      this.log('already disconnected');
      return;
    }
    this.log('>>> dropping out (socket destroyed, no goodbye)');
    this.droppedAt = Date.now();
    // destroy(), not end() — a phone that rings or dies doesn't send FIN.
    this.sock?.destroy();
  }

  /** Try to get back into the game after dropping out. */
  rejoin() {
    if (this.connected) {
      this.log('already connected');
      return;
    }
    this.previousTeamId = this.teamId;
    this.teamId = null;
    const gap = this.droppedAt ? Date.now() - this.droppedAt : null;
    this.log(`>>> rejoining… (${gap == null ? 'unknown' : gap + 'ms'} after dropping)`);
    if (gap != null && gap < 250) {
      // The host only frees the team for reattachment once IT sees the
      // socket close. Rejoining faster than that can land while the old
      // connection still looks alive, and the host makes a new team instead.
      this.log('    ⚠️  that was fast — if the rejoin fails, wait a second and retry');
    }
    // Ask to be reattached to our old team, exactly as the app does.
    this.connect(this.previousTeamId ?? undefined);
  }

  send(msg) {
    this.sock?.write(JSON.stringify(msg) + '\n');
  }

  handle(m) {
    switch (m.t) {
      case 'JOIN_ACK':
        this.teamId = m.teamId ?? m.team?.teamId ?? null;
        this.log(`JOIN_ACK — teamId ${this.teamId}`);
        // The whole point of the rejoin test: did the host recognize us, or
        // are we a stranger now? A new teamId means our old team is still
        // sitting in the host's list holding our score while we start at 0.
        if (this.previousTeamId) {
          this.log(
            this.teamId === this.previousTeamId
              ? '    ✅ same teamId — the host reconnected us to our old team'
              : `    ⚠️  NEW teamId (was ${this.previousTeamId}) — we came back as a different team; the old one keeps our score`
          );
          this.previousTeamId = null;
        }
        break;
      case 'JOIN_REJECT':
        this.log(`JOIN REJECTED: ${m.reason ?? 'no reason given'}`);
        break;
      case 'LOBBY_STATE': {
        // Only client 1 prints the roster — all of them would print the same
        // thing on every change and bury everything else.
        if (this.index !== 0) break;
        const teams = m.teams ?? [];
        this.log(`roster (${teams.length} team${teams.length === 1 ? '' : 's'}):`);
        for (const t of teams) {
          this.log(
            `    ${t.connected ? '●' : '○'} ${t.name}  ${t.teamId}${t.connected ? '' : '  (disconnected)'}`
          );
        }
        // A duplicate name is the visible symptom of a failed rejoin: the old
        // team lingers holding the score while a stranger plays on at zero.
        const names = teams.map((t) => t.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        if (dupes.length) {
          this.log(`    ⚠️  DUPLICATE TEAM(S): ${[...new Set(dupes)].join(', ')}`);
          this.log('    the rejoin did NOT reattach — score is stranded on the old team');
        }
        break;
      }
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
        this.log(m.paused ? '⏸  PAUSED by the host' : 'buzzers locked');
        break;
      case 'BUZZ_WINNER':
        this.log(`winner: ${m.teamId === this.teamId ? 'YOU' : m.teamId}`);
        break;
      case 'TEAM_ELIMINATED':
        if (m.teamId === this.teamId) this.log('eliminated this round');
        break;
      case 'ROUND_END': {
        this.armed = false;
        const rev = m.reveal ?? {};
        this.log(`round end — ${rev.songTitle ?? '?'} by ${rev.artist ?? '?'}`);
        if (this.index !== 0) break;
        // The host broadcasts the full scoreboard every round, so this is
        // the authoritative record of whether a rejoined team kept its
        // points — no need to squint at the phone.
        const scores = m.scores ?? {};
        this.log(
          `    scores: ${Object.entries(scores)
            .map(([id, v]) => `${id}=${v}`)
            .join('  ') || '(none)'}`
        );
        break;
      }
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

// Keypress handling: 1..N buzz as that team, q quits. Skipped when stdin
// isn't a terminal (piped/redirected), where listening would just hang.
if (!process.stdin.isTTY) {
  console.log('\n(stdin is not a terminal — buzzing by keypress is disabled)\n');
  setTimeout(() => {
    clients.forEach((c) => c.sock?.end());
    process.exit(0);
  }, 5000);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
/** Shifted number row — the "drop out" key for each team. */
const SHIFTED = ['!', '@', '#', '$'];

function printKeys() {
  console.log('');
  console.log(`  1-${teamCount}      buzz as that team (two fast = race test)`);
  console.log(
    `  ${SHIFTED.slice(0, teamCount).join(' ')}${teamCount < 4 ? '   ' : ''}    drop that team out (phone rings / dies)`
  );
  console.log('  r        rejoin every dropped team');
  console.log('  ?        show these keys again');
  console.log('  q        quit ALL clients and exit');
  console.log('');
}
printKeys();

process.stdin.on('keypress', (str, key) => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    clients.forEach((c) => c.sock?.destroy());
    process.exit(0);
  }

  if (str === '?') {
    printKeys();
    return;
  }

  if (str === 'r') {
    const down = clients.filter((c) => !c.connected);
    if (!down.length) {
      console.log('(nobody is disconnected)');
      return;
    }
    down.forEach((c) => c.rejoin());
    return;
  }

  const dropIdx = SHIFTED.indexOf(str);
  if (dropIdx >= 0 && dropIdx < clients.length) {
    clients[dropIdx].dropOut();
    return;
  }

  const n = parseInt(str, 10);
  if (n >= 1 && n <= clients.length) clients[n - 1].buzz();
});
