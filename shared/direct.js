import { toFrames, createAssembler, DIRECT_PART_CHARS } from './relay.js';

// The direct route: a WebRTC data channel between the phone and the computer
// on the same Wi-Fi, with nothing in between. The relay only introduces them:
// the phone's offer and the computer's answer travel through it as an
// ordinary sealed request ('rtc', see shared/host.js), so the relay sees a box
// it can't open, not even the devices' local addresses.
//
// Over the channel go the same frames as over the relay (shared/relay.js), in
// smaller pieces, carrying the same sealed boxes, answered by the same host
// and checked against the same single-use nonces: a message caught on one
// route can't be replayed on the other.
//
// No STUN or TURN server is used, and only local-network candidates are
// offered, so a channel that opens is always a direct one on the same network.

export const RTC_CONFIG = { iceServers: [] };
const GATHER_MS = 2500;
const MAX_SDP = 20_000;

// Only local-network candidates: "direct" must mean on the same network,
// never a path opened across the internet.
export function hostOnly(sdp) {
  return sdp
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('a=candidate:') || / typ host( |$)/.test(line))
    .join('\r\n');
}

// The whole description, candidates included, once gathering is done or has
// had its time: one message each way, no trickling.
export async function gathered(pc, ms = GATHER_MS) {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise((resolve) => {
      const done = () => pc.iceGatheringState === 'complete' && resolve();
      if (pc.addEventListener) pc.addEventListener('icegatheringstatechange', done);
      else pc.onicegatheringstatechange = done;
      setTimeout(resolve, ms);
    });
  }
  return { type: pc.localDescription.type, sdp: hostOnly(pc.localDescription.sdp) };
}

export function validDescription(d, type) {
  return d && d.type === type && typeof d.sdp === 'string' && d.sdp.length > 0 && d.sdp.length <= MAX_SDP;
}

// Send frames without overfilling the channel's buffer: browsers close a
// channel whose buffer grows too large.
export async function sendFrames(channel, frames) {
  if ('bufferedAmountLowThreshold' in channel) channel.bufferedAmountLowThreshold = 256 * 1024;
  for (const frame of frames) {
    while (typeof channel.bufferedAmount === 'number' && channel.bufferedAmount > 1024 * 1024) {
      if (channel.readyState !== 'open') throw new Error('channel closed');
      await new Promise((resolve) => {
        channel.onbufferedamountlow = () => resolve();
        setTimeout(resolve, 50);
      });
    }
    if (channel.readyState !== 'open') throw new Error('channel closed');
    channel.send(frame);
  }
}

// The computer's side: answers the phone's offers and serves each channel
// with `handle(endpoint, box) -> { status, body }`, the same handler the relay
// uses. When a request has fully arrived it first sends a receipt
// ({ id, rc: 1 }), which lets the phone time the upload on each route.
//
// createDirectHost({ loadRTC, rtcConfig, handle, onChange })
//   loadRTC() -> the RTCPeerConnection class (the browser's own, or a library's
//                loaded on first use)
//   answer(offer) -> answer       for the 'rtc' request
//   open                          how many direct channels are open now
//   close()
export function createDirectHost({ loadRTC, rtcConfig = RTC_CONFIG, handle, onChange = () => {}, maxPeers = 4 }) {
  const peers = new Set();
  let open = 0;
  const changed = (delta) => {
    open = Math.max(0, open + delta);
    onChange({ open });
  };

  function serve(channel) {
    const assembler = createAssembler({ partChars: DIRECT_PART_CHARS });
    let counted = false;
    const opened = () => {
      if (counted) return;
      counted = true;
      changed(1);
    };
    channel.onopen = opened;
    if (channel.readyState === 'open') opened();
    channel.onclose = () => {
      if (counted) changed(-1);
      counted = false;
    };
    channel.onmessage = async ({ data }) => {
      if (typeof data !== 'string') return;
      let done;
      try {
        done = assembler.push(data);
      } catch {
        return; // a malformed frame: drop it
      }
      if (!done) return;
      const { id, ep } = done.head;
      let result;
      try {
        channel.send(toFrames({ id, rc: 1 }, '')[0]);
        result = await handle(ep, JSON.parse(done.body));
      } catch {
        result = { status: 400, body: { error: 'bad request' } };
      }
      try {
        await sendFrames(channel, toFrames({ id, st: result.status }, result.body, DIRECT_PART_CHARS));
      } catch {
        // the channel went away; the phone asks again over the relay
      }
    };
  }

  return {
    async answer(offer) {
      if (!validDescription(offer, 'offer')) throw new Error('bad offer');
      // the oldest connection makes way for a new one
      if (peers.size >= maxPeers) {
        const oldest = peers.values().next().value;
        peers.delete(oldest);
        oldest.close();
      }
      const RTCPeerConnectionImpl = await loadRTC();
      const pc = new RTCPeerConnectionImpl(rtcConfig);
      peers.add(pc);
      pc.ondatachannel = ({ channel }) => serve(channel);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          peers.delete(pc);
          pc.close();
        }
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      return gathered(pc);
    },
    get open() {
      return open;
    },
    close() {
      for (const pc of peers) pc.close();
      peers.clear();
    },
  };
}
