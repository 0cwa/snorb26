import { deriveInfoHash } from './roomCapability.js';
import { WebTorrentTrackerClient } from './trackerClient.js';
import { acceptHostWebRtcOffer, applyGuestWebRtcAnswer, createGuestWebRtcOffer } from './webrtcTransport.js';

const DEFAULT_RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export function createRtcConfig({ turnUrls = [], username = '', credential = '' } = {}) {
  const urls = Array.isArray(turnUrls) ? turnUrls.map(value => String(value).trim()).filter(Boolean) : [];
  if (urls.length === 0) return { iceServers: [...DEFAULT_RTC_CONFIG.iceServers] };
  if (!username || !credential) throw new Error('TURN username and password are required when a TURN URL is configured');
  for (const value of urls) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Invalid TURN URL'); }
    if (!['turn:', 'turns:'].includes(url.protocol) || !url.pathname) throw new Error('TURN URLs must use turn: or turns:');
  }
  return { iceServers: [...DEFAULT_RTC_CONFIG.iceServers, { urls, username, credential }] };
}

export async function hostWebRtcRoom(capability, { onTransport, onWarning, rtcConfig = DEFAULT_RTC_CONFIG } = {}) {
  const url = capability.trackerUrls?.[0];
  if (!url) throw new Error('A WSS tracker URL is required');
  const infoHash = await deriveInfoHash(capability);
  let activeNegotiations = 0;
  const recentOffers = [];
  const tracker = new WebTorrentTrackerClient({
    url, infoHash, peerId: capability.hostPeerId, onWarning,
    onOffer: async ({ offer, offerId, peerId }) => {
      const now = performance.now();
      while (recentOffers.length && now - recentOffers[0] > 10_000) recentOffers.shift();
      if (activeNegotiations >= 8 || recentOffers.length >= 20) return onWarning?.('Tracker offer limit exceeded');
      recentOffers.push(now); activeNegotiations++;
      try {
        const { transport, answer } = await acceptHostWebRtcOffer(offer, rtcConfig);
        tracker.answer({ answer, offerId, toPeerId: peerId });
        onTransport?.(transport, peerId);
      } catch (error) { onWarning?.(error.message); }
      finally { activeNegotiations--; }
    },
  });
  tracker.connect();
  return { close: () => tracker.close(), tracker };
}

export async function joinWebRtcRoom(capability, { onTransport, onWarning, rtcConfig = DEFAULT_RTC_CONFIG } = {}) {
  const url = capability.trackerUrls?.[0];
  if (!url) throw new Error('A WSS tracker URL is required');
  const infoHash = await deriveInfoHash(capability);
  const peerId = crypto.getRandomValues(new Uint8Array(20));
  const { transport, offer } = await createGuestWebRtcOffer(rtcConfig);
  const tracker = new WebTorrentTrackerClient({
    url, infoHash, peerId, onWarning,
    onAnswer: async ({ answer, token }) => {
      if (token !== transport) return;
      try { await applyGuestWebRtcAnswer(transport, answer); onTransport?.(transport); }
      catch (error) { onWarning?.(error.message); }
    },
  });
  tracker.connect();
  const announceOffer = () => tracker.announceOffers([{ offer, token: transport }]);
  const originalOpen = tracker.socket?.onopen;
  // connect() creates the socket synchronously.
  tracker.socket.onopen = event => { originalOpen?.(event); announceOffer(); };
  return { close: () => { tracker.close(); transport.close('left'); }, tracker, transport };
}
