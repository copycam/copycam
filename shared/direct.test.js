// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { hostOnly, createDirectHost } from './direct.js';
import { createHost } from './host.js';
import { seal, open, newKey } from './crypto.js';
import { toFrames, createAssembler, DIRECT_PART_CHARS } from './relay.js';
import { fakeNetwork } from '../src/test/fake-rtc.js';

describe('hostOnly', () => {
  it('keeps local candidates and drops any that would cross the internet', () => {
    const sdp = [
      'v=0',
      'a=candidate:1 1 udp 2122260223 192.168.0.9 50000 typ host generation 0',
      'a=candidate:2 1 udp 2122260223 4f1c-uuid.local 50000 typ host',
      'a=candidate:3 1 udp 1686052607 203.0.113.9 50000 typ srflx raddr 0.0.0.0 rport 0',
      'a=candidate:4 1 udp 41885439 198.51.100.7 3478 typ relay raddr 0.0.0.0 rport 0',
    ].join('\r\n');
    const kept = hostOnly(sdp);
    expect(kept).toContain('192.168.0.9');
    expect(kept).toContain('.local');
    expect(kept).not.toContain('srflx');
    expect(kept).not.toContain('typ relay');
    expect(kept.startsWith('v=0')).toBe(true);
  });
});

// A phone end of a direct channel: sends a request, collects what comes back.
function phoneEnd(channel) {
  const assembler = createAssembler({ partChars: DIRECT_PART_CHARS });
  const got = [];
  channel.onmessage = ({ data }) => {
    const done = assembler.push(data);
    if (done) got.push(done);
  };
  return {
    got,
    send: (id, ep, box) => toFrames({ id, ep }, box, DIRECT_PART_CHARS).forEach((f) => channel.send(f)),
  };
}

async function directPair() {
  const key = newKey();
  const net = fakeNetwork();
  const onEvent = vi.fn();
  const host = createHost({ key, name: 'your PC', deps: { ocr: vi.fn(), clipboard: vi.fn(), onEvent } });
  const changes = [];
  const direct = createDirectHost({ loadRTC: () => net.RTCPeerConnection, handle: host, onChange: (c) => changes.push(c.open) });
  const phone = new net.RTCPeerConnection({});
  const channel = phone.createDataChannel('copycam');
  await phone.setLocalDescription(await phone.createOffer());
  const answer = await direct.answer({ type: 'offer', sdp: phone.localDescription.sdp });
  await phone.setRemoteDescription(answer);
  await new Promise((r) => setTimeout(r, 5));
  return { key, net, host, direct, answer, channel, changes, onEvent };
}

describe('createDirectHost', () => {
  it('answers with local candidates only, and opens a channel', async () => {
    const { answer, net, changes, direct } = await directPair();
    expect(answer.type).toBe('answer');
    expect(answer.sdp).toContain('typ host');
    // it never saw the phone's internet-facing candidate: the phone filters too
    // (see src/mobile/relay.js), but the computer offers only local ones itself
    expect(net.connections).toBe(1);
    expect(changes.at(-1)).toBe(1);
    expect(direct.open).toBe(1);
  });

  it('serves requests over the channel with a receipt, then the sealed answer', async () => {
    const { key, channel } = await directPair();
    const end = phoneEnd(channel);
    end.send('a1', 'hello', seal(key, {}, 'hello'));
    await new Promise((r) => setTimeout(r, 5));
    expect(end.got[0].head).toEqual({ id: 'a1', rc: 1 });
    expect(end.got[1].head).toEqual({ id: 'a1', st: 200 });
    expect(open(key, JSON.parse(end.got[1].body), 'hello-ack').name).toBe('your PC');
  });

  it('turns away a message already used on the other route', async () => {
    const { key, host, channel } = await directPair();
    const box = seal(key, { text: 'hi' }, 'clip');
    // first through the relay (the same handler) ...
    expect((await host('clip', box)).status).toBe(200);
    // ... then the same box again, direct
    const end = phoneEnd(channel);
    end.send('r1', 'clip', box);
    await new Promise((r) => setTimeout(r, 5));
    expect(end.got.find((g) => g.head.st).head.st).toBe(400);
  });

  it('notices when the channel goes away', async () => {
    const { net, changes } = await directPair();
    net.cut();
    expect(changes.at(-1)).toBe(0);
  });

  it('refuses an offer that is not one', async () => {
    const net = fakeNetwork();
    const direct = createDirectHost({ loadRTC: () => net.RTCPeerConnection, handle: vi.fn() });
    await expect(direct.answer({ type: 'answer', sdp: 'v=0' })).rejects.toThrow();
    await expect(direct.answer({ type: 'offer', sdp: 'x'.repeat(30_000) })).rejects.toThrow();
  });
});
