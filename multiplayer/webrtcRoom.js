import { deriveInfoHash } from './roomCapability.js';
import { WebTorrentTrackerClient } from './trackerClient.js';
import { acceptHostWebRtcOffer, applyGuestWebRtcAnswer, createGuestWebRtcOffer } from './webrtcTransport.js';

const DEFAULT_RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export async function hostWebRtcRoom(capability, { onTransport, onWarning, rtcConfig = DEFAULT_RTC_CONFIG } = {}) {
  const url = capability.trackerUrls?.[0];
  if (!url) throw new Error('A WSS tracker URL is required');
  const infoHash = await deriveInfoHash(capability);
  const tracker = new WebTorrentTrackerClient({
    url, infoHash, peerId: capability.hostPeerId, onWarning,
    onOffer: async ({ offer, offerId, peerId }) => {
      try {
        const { transport, answer } = await acceptHostWebRtcOffer(offer, rtcConfig);
        tracker.answer({ answer, offerId, toPeerId: peerId });
        onTransport?.(transport, peerId);
      } catch (error) { onWarning?.(error.message); }
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
