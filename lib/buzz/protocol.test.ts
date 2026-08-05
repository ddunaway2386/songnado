import {
  BUZZ_DEFAULT_PORT,
  encodeShortCode,
  decodeShortCode,
  decode,
  decodeConnectionString,
  encode,
  encodeConnectionString,
  newMsgId,
  PROTOCOL_VERSION,
} from './protocol';
import type { ClientBuzzMsg, ClientJoinMsg, HostMsg } from './protocol';

describe('encode / decode (NDJSON)', () => {
  test('round-trips a single message', () => {
    const join: ClientJoinMsg = {
      t: 'JOIN',
      id: 'abc',
      protocolVersion: PROTOCOL_VERSION,
      desiredName: 'Team Red',
      desiredColor: '#E63946',
    };
    const wire = encode(join);
    expect(wire.endsWith('\n')).toBe(true);
    const { messages, remainder } = decode<ClientJoinMsg>(wire);
    expect(messages).toEqual([join]);
    expect(remainder).toBe('');
  });

  test('parses multiple messages in one chunk', () => {
    const a: ClientJoinMsg = {
      t: 'JOIN',
      id: '1',
      protocolVersion: 1,
      desiredName: 'A',
      desiredColor: '#E63946',
    };
    const b: ClientBuzzMsg = { t: 'BUZZ', id: '2', clientTsMs: 1000 };
    const wire = encode(a) + encode(b);
    const { messages, remainder } = decode<ClientJoinMsg | ClientBuzzMsg>(wire);
    expect(messages).toHaveLength(2);
    expect(messages[0].t).toBe('JOIN');
    expect(messages[1].t).toBe('BUZZ');
    expect(remainder).toBe('');
  });

  test('holds partial trailing line as remainder', () => {
    const a: ClientBuzzMsg = { t: 'BUZZ', id: '1', clientTsMs: 100 };
    const wire = encode(a) + '{"t":"BUZZ","id":"2","clientTs';
    const { messages, remainder } = decode<ClientBuzzMsg>(wire);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('1');
    expect(remainder).toBe('{"t":"BUZZ","id":"2","clientTs');
  });

  test('continuation: previous remainder + new chunk parses cleanly', () => {
    const a: ClientBuzzMsg = { t: 'BUZZ', id: '99', clientTsMs: 500 };
    const wireFull = encode(a);
    // Split mid-message
    const split = Math.floor(wireFull.length / 2);
    const first = wireFull.slice(0, split);
    const second = wireFull.slice(split);
    const r1 = decode<ClientBuzzMsg>(first);
    expect(r1.messages).toHaveLength(0);
    expect(r1.remainder).toBe(first);
    const r2 = decode<ClientBuzzMsg>(r1.remainder + second);
    expect(r2.messages).toEqual([a]);
    expect(r2.remainder).toBe('');
  });

  test('drops malformed lines but keeps surrounding good ones', () => {
    const a: ClientBuzzMsg = { t: 'BUZZ', id: '1', clientTsMs: 1 };
    const c: ClientBuzzMsg = { t: 'BUZZ', id: '3', clientTsMs: 3 };
    const wire = encode(a) + 'this is not json\n' + encode(c);
    const { messages, remainder } = decode<ClientBuzzMsg>(wire);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.id)).toEqual(['1', '3']);
    expect(remainder).toBe('');
  });

  test('empty lines are skipped silently', () => {
    const a: ClientBuzzMsg = { t: 'BUZZ', id: '1', clientTsMs: 1 };
    const wire = '\n\n' + encode(a) + '\n\n';
    const { messages } = decode<ClientBuzzMsg>(wire);
    expect(messages).toHaveLength(1);
  });
});

describe('newMsgId', () => {
  test('returns distinct ids on rapid successive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newMsgId());
    expect(ids.size).toBe(1000);
  });
});

describe('connection-string', () => {
  test('round-trips a valid connection', () => {
    const c = { host: '192.168.1.42', port: 52341, sessionId: '8c4f2a' };
    const s = encodeConnectionString(c);
    expect(s).toBe(`songnado-buzz:v${PROTOCOL_VERSION}:192.168.1.42:52341:8c4f2a`);
    expect(decodeConnectionString(s)).toEqual(c);
  });

  test('rejects wrong scheme', () => {
    expect(decodeConnectionString('http://192.168.1.42:52341')).toBeNull();
    expect(decodeConnectionString('not a uri at all')).toBeNull();
  });

  test('rejects mismatched protocol version', () => {
    expect(
      decodeConnectionString('songnado-buzz:v999:192.168.1.42:52341:abc123')
    ).toBeNull();
  });

  test('rejects malformed IP / port', () => {
    expect(
      decodeConnectionString(`songnado-buzz:v${PROTOCOL_VERSION}:nope:52341:abc`)
    ).toBeNull();
    expect(
      decodeConnectionString(
        `songnado-buzz:v${PROTOCOL_VERSION}:192.168.1.42:notaport:abc`
      )
    ).toBeNull();
  });

  test('uppercase session id is normalized to lowercase', () => {
    const c = decodeConnectionString(
      `songnado-buzz:v${PROTOCOL_VERSION}:192.168.1.42:52341:ABC123`
    );
    expect(c?.sessionId).toBe('abc123');
  });
});

describe('host-message discriminator coverage', () => {
  test('every documented HostMsg type round-trips through encode/decode', () => {
    const examples: HostMsg[] = [
      {
        t: 'JOIN_ACK',
        id: '1',
        protocolVersion: 1,
        teamId: 't_a',
        assignedColor: '#E63946',
        assignedName: 'Red',
      },
      {
        t: 'JOIN_REJECT',
        id: '2',
        reason: 'lobby_full',
        message: 'full',
      },
      {
        t: 'LOBBY_STATE',
        id: '3',
        gameMode: 'buzz',
        playlistName: 'Movie Classics',
        teams: [],
        starting: false,
      },
      { t: 'GAME_START', id: '4', totalRounds: 10 },
      { t: 'ROUND_START', id: '5', roundNumber: 1 },
      { t: 'BUZZ_ARMED', id: '6', eligibleTeamIds: ['t_a'] },
      { t: 'BUZZ_LOCKED', id: '7' },
      {
        t: 'BUZZ_WINNER',
        id: '8',
        winningTeamId: 't_a',
        answerWindowSec: 5,
      },
      { t: 'TEAM_ELIMINATED', id: '9', teamId: 't_a' },
      {
        t: 'ROUND_END',
        id: '10',
        roundNumber: 1,
        winningTeamId: 't_a',
        reveal: {
          songTitle: 'Lose Yourself',
          artist: 'Eminem',
          source: '8 Mile',
          coverUrl: '',
        },
        scores: { t_a: 1 },
      },
      { t: 'GAME_END', id: '11', ranking: ['t_a'], scores: { t_a: 1 } },
      { t: 'PONG', id: '12', clientTsMs: 100, hostTsMs: 105 },
      { t: 'SHUTDOWN', id: '13', reason: 'host_quit' },
    ];
    const wire = examples.map(encode).join('');
    const { messages, remainder } = decode<HostMsg>(wire);
    expect(remainder).toBe('');
    expect(messages).toHaveLength(examples.length);
    expect(messages.map((m) => m.t)).toEqual(examples.map((m) => m.t));
  });
});

describe('short room code', () => {
  it('encodes to just the host final octet on the default port', () => {
    expect(encodeShortCode('192.168.1.42', BUZZ_DEFAULT_PORT)).toBe('42');
    expect(encodeShortCode('10.0.0.7', BUZZ_DEFAULT_PORT)).toBe('7');
  });

  it('refuses to encode when the host fell back to an ephemeral port', () => {
    // Guests must use the long form in that case — a bare octet would
    // send them to the wrong port.
    expect(encodeShortCode('192.168.1.42', 52341)).toBeNull();
  });

  it('rebuilds the host address from the joining phone subnet', () => {
    expect(decodeShortCode('42', '192.168.1.87')).toEqual({
      host: '192.168.1.42',
      port: BUZZ_DEFAULT_PORT,
      sessionId: 'short',
    });
  });

  it('handles a different subnet than the usual 192.168.1.x', () => {
    expect(decodeShortCode('7', '10.0.0.153')?.host).toBe('10.0.0.7');
  });

  it('round-trips host -> code -> host for phones on one network', () => {
    const hostIp = '192.168.4.101';
    const code = encodeShortCode(hostIp, BUZZ_DEFAULT_PORT);
    expect(code).toBe('101');
    expect(decodeShortCode(code!, '192.168.4.9')?.host).toBe(hostIp);
  });

  it('rejects junk and out-of-range octets', () => {
    for (const bad of ['', 'abc', '999', '-1', '1.2.3.4']) {
      expect(decodeShortCode(bad, '192.168.1.5')).toBeNull();
    }
  });

  it('rejects a malformed client IP', () => {
    expect(decodeShortCode('42', 'not-an-ip')).toBeNull();
  });
});
