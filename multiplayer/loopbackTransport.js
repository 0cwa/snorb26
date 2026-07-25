import { MultiplayerTransport, assertBinary } from './transport.js';

class LoopbackTransport extends MultiplayerTransport {
  constructor() { super(); this.peer = null; this.closed = false; this.buffered = 0; }
  async open() { if (this.closed) throw new Error('Transport closed'); queueMicrotask(() => this._open({ type: 'loopback' })); }
  _send(channel, bytes) {
    assertBinary(bytes);
    if (this.closed || !this.peer || this.peer.closed) return false;
    const copy = bytes.slice(); this.buffered += copy.length;
    queueMicrotask(() => { this.buffered -= copy.length; if (!this.closed && !this.peer.closed) this.peer[channel](copy); });
    return true;
  }
  sendReliable(bytes) { return this._send('_reliable', bytes); }
  sendTransient(bytes) { return this._send('_transient', bytes); }
  getBufferedAmount() { return this.buffered; }
  close(reason = 'closed') {
    if (this.closed) return; this.closed = true; this._close(reason);
    if (this.peer && !this.peer.closed) { this.peer.closed = true; this.peer._close(reason); }
  }
}

export function createLoopbackTransportPair() {
  const first = new LoopbackTransport(), second = new LoopbackTransport();
  first.peer = second; second.peer = first;
  return [first, second];
}
