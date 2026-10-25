// A stand-in for WebRTC in tests: peer connections that "connect" when the
// phone side gets an answer from a computer side on the same fake network,
// and data channels that pass messages between the two ends.
//
//   const net = fakeNetwork();          // net.reachable = false: no direct path
//   globalThis.RTCPeerConnection = net.RTCPeerConnection;
//   net.cut();                          // drop every open channel
//   net.offers                          // offers the computer side received

class FakeChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.peer = null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('channel not open');
    const peer = this.peer;
    queueMicrotask(() => peer.readyState === 'open' && peer.onmessage?.({ data }));
  }
  close() {
    for (const ch of [this, this.peer]) {
      if (!ch || ch.readyState === 'closed') continue;
      ch.readyState = 'closed';
      ch.onclose?.();
    }
  }
}

export function fakeNetwork() {
  const answering = new Map(); // offer token -> computer-side connection
  const channels = new Set();
  let count = 0;
  const net = { reachable: true, offers: [], connections: 0 };

  class RTCPeerConnection {
    constructor(config) {
      this.config = config;
      this.token = `t${count++}`;
      this.iceGatheringState = 'complete';
      this.connectionState = 'new';
      this.created = [];
      this.ondatachannel = null;
      this.onconnectionstatechange = null;
    }
    createDataChannel(label) {
      const ch = new FakeChannel(label);
      this.created.push(ch);
      return ch;
    }
    async createOffer() {
      return {
        type: 'offer',
        sdp: `v=0\r\na=candidate:1 1 udp 1 192.168.0.9 50000 typ host\r\na=candidate:2 1 udp 1 203.0.113.9 50000 typ srflx raddr 0.0.0.0 rport 0\r\na=fake:${this.token}`,
      };
    }
    async createAnswer() {
      return { type: 'answer', sdp: `v=0\r\na=candidate:1 1 udp 1 192.168.0.8 50001 typ host\r\na=fake:${this.offerToken}` };
    }
    async setLocalDescription(d) {
      this.localDescription = d;
    }
    async setRemoteDescription(d) {
      this.remoteDescription = d;
      if (d.type === 'offer') {
        this.offerToken = /a=fake:(\S+)/.exec(d.sdp)?.[1];
        answering.set(this.offerToken, this);
        net.offers.push(d.sdp);
        return;
      }
      // the phone side has its answer: connect, if there's a way through
      const computer = answering.get(this.token);
      if (!net.reachable || !computer) return;
      for (const ch of this.created) {
        const other = new FakeChannel(ch.label);
        ch.peer = other;
        other.peer = ch;
        channels.add(ch);
        other.readyState = 'open';
        computer.ondatachannel?.({ channel: other });
        setTimeout(() => {
          ch.readyState = 'open';
          ch.onopen?.();
        }, 0);
      }
      net.connections++;
      this.connectionState = 'connected';
    }
    close() {
      this.connectionState = 'closed';
      for (const ch of this.created) ch.close();
    }
  }

  net.RTCPeerConnection = RTCPeerConnection;
  net.cut = () => {
    for (const ch of channels) ch.close();
    channels.clear();
  };
  return net;
}
