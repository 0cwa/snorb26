const MAX_TRACKER_MESSAGE = 256 * 1024;
const bytesToBinaryString = bytes => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
const randomOfferId = () => crypto.getRandomValues(new Uint8Array(20));

function validTrackerUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Tracker must use WSS');
  return url.href;
}

export class WebTorrentTrackerClient {
  constructor({ url, infoHash, peerId, onOffer, onAnswer, onWarning }) {
    if (!(infoHash instanceof Uint8Array) || infoHash.length !== 20 || !(peerId instanceof Uint8Array) || peerId.length !== 20) throw new TypeError('Tracker IDs must be 20 bytes');
    this.url = validTrackerUrl(url); this.infoHash = infoHash; this.peerId = peerId;
    this.onOffer = onOffer; this.onAnswer = onAnswer; this.onWarning = onWarning;
    this.socket = null; this.interval = null; this.pendingOffers = new Map();
  }
  connect() {
    if (this.socket) return;
    this.socket = new WebSocket(this.url);
    this.socket.onopen = () => this.announce({ event: 'started', numwant: 0 });
    this.socket.onmessage = event => this.#message(event.data);
    this.socket.onerror = () => this.onWarning?.('Tracker connection error');
    this.socket.onclose = () => { clearTimeout(this.interval); this.interval = null; this.socket = null; };
  }
  announce(extra = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ action: 'announce', info_hash: bytesToBinaryString(this.infoHash), peer_id: bytesToBinaryString(this.peerId), uploaded: 0, downloaded: 0, left: 1, ...extra }));
    return true;
  }
  announceOffers(offers) {
    if (!Array.isArray(offers) || offers.length > 10) throw new RangeError('Too many tracker offers');
    const wireOffers = offers.map(({ offer, token }) => {
      const offerId = randomOfferId();
      this.pendingOffers.set(bytesToBinaryString(offerId), token);
      return { offer_id: bytesToBinaryString(offerId), offer };
    });
    return this.announce({ numwant: wireOffers.length, offers: wireOffers });
  }
  answer({ answer, offerId, toPeerId }) {
    return this.announce({ numwant: 0, answer, offer_id: offerId, to_peer_id: toPeerId });
  }
  #message(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_TRACKER_MESSAGE) return this.onWarning?.('Invalid tracker message');
    let message; try { message = JSON.parse(raw); } catch { return this.onWarning?.('Invalid tracker JSON'); }
    if (message.action !== 'announce') return;
    if (message.failure_reason) return this.onWarning?.(String(message.failure_reason).slice(0, 200));
    if (Number.isFinite(message.interval)) {
      clearTimeout(this.interval);
      this.interval = setTimeout(() => this.announce({ numwant: 0 }), Math.max(15, Math.min(1800, message.interval)) * 1000);
    }
    if (message.offer && message.offer_id && message.peer_id && typeof message.offer.sdp === 'string' && message.offer.sdp.length < 128 * 1024) {
      this.onOffer?.({ offer: message.offer, offerId: message.offer_id, peerId: message.peer_id });
    }
    if (message.answer && message.offer_id && typeof message.answer.sdp === 'string' && message.answer.sdp.length < 128 * 1024) {
      const token = this.pendingOffers.get(message.offer_id);
      if (token) { this.pendingOffers.delete(message.offer_id); this.onAnswer?.({ answer: message.answer, token }); }
    }
  }
  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.announce({ event: 'stopped', numwant: 0 });
    this.socket?.close(); this.socket = null; clearTimeout(this.interval); this.pendingOffers.clear();
  }
}
