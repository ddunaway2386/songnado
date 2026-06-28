# Buzz Mode — multi-device game mode

The v1.0 marquee feature. Each team uses its own phone as a buzzer.
Host phone runs the full game (audio, scoring, reveal). Clients show
a giant BUZZ button. Decision locked June 28; full spec in
`memory/launch-strategy-june10.md`.

## Round flow

1. Host plays a 30-second preview clip.
2. All client BUZZ buttons go "armed" (team color).
3. A team taps BUZZ → host pauses audio, that team gets a 5-second
   answer window. All other buzzers disarm (visually grey out, but
   the team that buzzed gets a "your turn" UI).
4. Host taps **Correct** → team wins round, points awarded.
   Host taps **Wrong** OR 5s timer expires → that team is eliminated
   for this round, audio resumes from paused position, remaining
   teams' buzzers re-arm.
5. If everyone gets eliminated → round ends "nobody got it", host
   reveals the answer with no points awarded.

## Topology

```
        ┌─────────────┐
        │  HOST phone │ (runs the game, plays audio, scores)
        │  • TCP svr  │
        │  • Game UI  │
        └──────┬──────┘
               │ local Wi-Fi
       ┌───────┼───────┬───────────┐
       ▼       ▼       ▼           ▼
   ┌─────┐ ┌─────┐ ┌─────┐ ... ┌─────┐
   │TEAM │ │TEAM │ │TEAM │     │TEAM │  (max 6 teams)
   │ 1   │ │ 2   │ │ 3   │     │ 6   │
   │BUZZ │ │BUZZ │ │BUZZ │     │BUZZ │
   └─────┘ └─────┘ └─────┘     └─────┘
```

## Networking

- **Connectivity**: local Wi-Fi only. No cloud server, no internet.
- **Transport**: TCP sockets via `react-native-tcp-socket` (native module).
- **Protocol**: newline-delimited JSON (NDJSON) — simpler than implementing
  WebSocket on top of TCP. One message per line.
- **Discovery**: host shows a QR code containing `<host-ip>:<port>:<session-id>`.
  Clients scan with in-app camera. (Manual code-entry fallback in lobby UX.)
- **Host runs server on port range 49152-65535** (ephemeral range, picks first
  available). Port included in QR code.
- **Why TCP not UDP**: we want reliable delivery (lost buzz = bad UX) and
  message ordering. The latency cost over local Wi-Fi (~5-15ms) is fine.

## Why TCP not WebSocket

WebSocket requires a server-side HTTP upgrade handshake + frame parsing.
On React Native, implementing that on top of `react-native-tcp-socket`
would add ~200 lines of fragile protocol code without buying us anything
the JSON-line protocol doesn't already give us:

- ✅ Persistent bidirectional connection — TCP gives us this
- ✅ Reliable ordered delivery — TCP gives us this
- ✅ Frame boundaries — newline delimiters give us this for free
- ❌ Browser interop — not relevant, this is a closed phone-to-phone protocol

The trade-off: no `wss://` support means we can't talk to a browser. For a
LAN-only party-game protocol, that's a non-issue.

## State authority

The host phone is the source of truth for all game state. Clients are dumb
buzzer-displayers that send actions and receive state updates. No
client-side state speculation or optimistic updates.

This avoids consensus problems (e.g. "two teams swear they buzzed first")
at the cost of one extra round-trip per buzz (~30ms over LAN). Worth it.

## Buzz race timing

- Each client measures its round-trip ping to host at lobby join time.
  Stored as `team.networkOffsetMs`.
- When client sends BUZZ, message includes client timestamp.
- Host compares (server-receive-time - team.networkOffsetMs/2) across all
  buzzes in a small window (~100ms) and picks the earliest.
- 100ms window is short enough that human reaction-time variance dominates,
  not network jitter. So latency comp only matters for ties within ~50ms.

## Message protocol

See `protocol.ts` for the full TypeScript message types. High-level:

**Client → Host:**
- `JOIN` — sent on connection with team name + preferred color
- `BUZZ` — sent when user taps BUZZ button (includes client timestamp)
- `PING` — keepalive

**Host → Clients (broadcast):**
- `LOBBY_STATE` — current list of joined teams, ready/not
- `ROUND_START` — round N is starting (audio cue on host)
- `BUZZ_ARMED` — buzzers are now active; client should enable button
- `BUZZ_LOCKED` — buzzers are now locked (during reveal / between rounds)
- `BUZZ_WINNER` — team X has buzzed first (only winning client shows
  "your turn", others show "waiting")
- `TEAM_ELIMINATED` — team X is out for this round
- `ROUND_END` — round is over with reveal + scores
- `GAME_END` — game is over with final standings

## Module layout

```
lib/buzz/
  README.md              ← this file
  protocol.ts            ← message types, serializer/deserializer
  server.ts              ← host-side TCP server wrapper
  client.ts              ← client-side TCP connection wrapper
  ping.ts                ← latency measurement
  qr.ts                  ← QR generation/parsing for lobby join
stores/
  buzzGameStore.ts       ← zustand store for buzz game state
                            (parallel to existing gameStore for non-buzz modes)
```

## Build phases (locked, see launch-strategy-june10.md)

- **Phase 0 (this session, June 28)**: design doc + types + store skeleton
- **Phase 1 (July 5-12)**: install `react-native-tcp-socket`, rebuild dev
  client, implement server.ts + client.ts + ping.ts
- **Phase 2 (July 13-17)**: lobby UX — host QR generation, client scan, team
  color assignment, ready-state aggregation
- **Phase 3 (July 20-26)**: game state machine — buzz mode flows in
  buzzGameStore, integrate with audio player for pause/resume
- **Phase 4 (July 27 - Aug 2)**: host + client UI screens
- **Phase 5 (Aug 3-9)**: edge cases — reconnect, dropped clients, host
  backgrounded by iOS

## Not in v1.0

- Custom buzz sounds per team (cute but distracting)
- Spectator mode (watch without buzzing)
- Replay mode (re-listen to a missed round)
- Saving multi-device games to history
- Cross-Wi-Fi support (different SSIDs on same network)

These are v2 ideas if buzz mode takes off.
