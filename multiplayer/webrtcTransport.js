import { MAX_TRANSIENT_PAYLOAD } from './protocol.js';
import { MultiplayerTransport, assertBinary } from './transport.js';

const CHUNK_MAGIC = 0x43484e4b;
const CHUNK_HEADER = 20;
const CHUNK_DATA = 16 * 1024;
let messageId = 0;

function waitIceComplete(pc, timeout = 8000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('ICE gathering timed out')); }, timeout);
    const change = () => { if (pc.iceGatheringState === 'complete') { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', change); };
    pc.addEventListener('icegatheringstatechange', change);
  });
}

export class WebRtcTransport extends MultiplayerTransport {
  constructor(pc) {
    super(); this.pc = pc; this.reliable = null; this.transient = null; this.closed = false;
    this.assemblies = new Map();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this._error(new Error('WebRTC connection failed'));
      if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) this.close(pc.connectionState);
    };
    pc.ondatachannel = event => this.#bindChannel(event.channel);
  }
  async open() { /* Signaling factories drive opening. */ }
  attachCreatedChannels() {
    this.#bindChannel(this.pc.createDataChannel('snorb-reliable', { ordered: true }));
    this.#bindChannel(this.pc.createDataChannel('snorb-snapshot', { ordered: false, maxRetransmits: 0 }));
  }
  #bindChannel(channel) {
    channel.binaryType = 'arraybuffer';
    if (channel.label === 'snorb-reliable') this.reliable = channel;
    else if (channel.label === 'snorb-snapshot') this.transient = channel;
    else { channel.close(); return; }
    channel.onmessage = event => {
      if (!(event.data instanceof ArrayBuffer)) return this._error(new Error('WebRTC text payload rejected'));
      this.#receiveChunk(channel.label, new Uint8Array(event.data));
    };
    channel.onerror = () => this._error(new Error(`DataChannel error: ${channel.label}`));
    channel.onopen = () => { if (this.reliable?.readyState === 'open' && this.transient?.readyState === 'open') this._open({ type: 'webrtc' }); };
  }
  #receiveChunk(label, bytes) {
    if (bytes.length < CHUNK_HEADER) return this._error(new Error('Truncated WebRTC chunk'));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0) !== CHUNK_MAGIC) return this._error(new Error('Invalid WebRTC chunk'));
    const id = view.getUint32(4), index = view.getUint16(8), count = view.getUint16(10), total = view.getUint32(12), size = view.getUint32(16);
    if (!count || index >= count || total > MAX_TRANSIENT_PAYLOAD || size !== bytes.length - CHUNK_HEADER) return this._error(new Error('Invalid WebRTC chunk bounds'));
    const key = `${label}:${id}`;
    let assembly = this.assemblies.get(key);
    if (!assembly) { assembly = { count, total, chunks: new Array(count), received: 0, timer: setTimeout(() => this.assemblies.delete(key), 5000) }; this.assemblies.set(key, assembly); }
    if (assembly.count !== count || assembly.total !== total || assembly.chunks[index]) return;
    assembly.chunks[index] = bytes.slice(CHUNK_HEADER); assembly.received += size;
    if (assembly.chunks.every(Boolean)) {
      clearTimeout(assembly.timer); this.assemblies.delete(key);
      if (assembly.received !== total) return this._error(new Error('WebRTC reassembly mismatch'));
      const message = new Uint8Array(total); let offset = 0;
      for (const chunk of assembly.chunks) { message.set(chunk, offset); offset += chunk.length; }
      label === 'snorb-reliable' ? this._reliable(message) : this._transient(message);
    }
  }
  #send(channel, bytes) {
    assertBinary(bytes);
    if (!channel || channel.readyState !== 'open' || channel.bufferedAmount > 4 * 1024 * 1024) return false;
    const id = ++messageId >>> 0, count = Math.ceil(bytes.length / CHUNK_DATA) || 1;
    for (let index = 0; index < count; index++) {
      const data = bytes.subarray(index * CHUNK_DATA, Math.min(bytes.length, (index + 1) * CHUNK_DATA));
      const chunk = new Uint8Array(CHUNK_HEADER + data.length), view = new DataView(chunk.buffer);
      view.setUint32(0, CHUNK_MAGIC); view.setUint32(4, id); view.setUint16(8, index); view.setUint16(10, count);
      view.setUint32(12, bytes.length); view.setUint32(16, data.length); chunk.set(data, CHUNK_HEADER); channel.send(chunk);
    }
    return true;
  }
  sendReliable(bytes) { return this.#send(this.reliable, bytes); }
  sendTransient(bytes) { if (this.transient?.bufferedAmount > 1024 * 1024) return false; return this.#send(this.transient, bytes); }
  getBufferedAmount() { return (this.reliable?.bufferedAmount || 0) + (this.transient?.bufferedAmount || 0); }
  close(reason = 'closed') {
    if (this.closed) return; this.closed = true;
    for (const value of this.assemblies.values()) clearTimeout(value.timer); this.assemblies.clear();
    this.reliable?.close(); this.transient?.close(); this.pc.close(); this._close(reason);
  }
}

export async function createGuestWebRtcOffer(rtcConfig = {}) {
  const pc = new RTCPeerConnection(rtcConfig), transport = new WebRtcTransport(pc);
  transport.attachCreatedChannels();
  await pc.setLocalDescription(await pc.createOffer()); await waitIceComplete(pc);
  return { transport, offer: pc.localDescription };
}

export async function applyGuestWebRtcAnswer(transport, answer) {
  if (answer?.type !== 'answer' || typeof answer.sdp !== 'string') throw new TypeError('Invalid WebRTC answer');
  await transport.pc.setRemoteDescription(answer);
}

export async function acceptHostWebRtcOffer(offer, rtcConfig = {}) {
  if (offer?.type !== 'offer' || typeof offer.sdp !== 'string') throw new TypeError('Invalid WebRTC offer');
  const pc = new RTCPeerConnection(rtcConfig), transport = new WebRtcTransport(pc);
  await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); await waitIceComplete(pc);
  return { transport, answer: pc.localDescription };
}
