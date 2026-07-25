import { deriveInfoHash } from './roomCapability.js';
import { WebTorrentTrackerClient } from './trackerClient.js';
import { acceptHostWebRtcOffer, applyGuestWebRtcAnswer, createGuestWebRtcOffer } from './webrtcTransport.js';
const MAX_TURN_URLS = 4;
const MAX_TURN_URL_LENGTH = 256;
const MAX_TURN_USERNAME_LENGTH = 256;
const MAX_TURN_CREDENTIAL_LENGTH = 1024;
const JOIN_TIMEOUT_MS = 45_000;

const SAFE_CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx', 'relay']);
const SAFE_PROTOCOLS = new Set(['udp', 'tcp', 'tls']);
function iceCandidateErrorCategory(errorCode) {
  return errorCode === 701 ? 'server-unreachable' : Number.isFinite(errorCode) ? 'server-error' : 'unknown';
}

function validTurnUrl(value) {
  if (value.length > MAX_TURN_URL_LENGTH) throw new Error('TURN URL is too long');
  const match = /^(turn|turns):(?:\/\/)?([^/?#\s]+)(?:\?([^#\s]*))?$/i.exec(value);
  if (!match) throw new Error('Invalid TURN URL');
  const [, scheme, hostPort, query = ''] = match;
  if (hostPort.includes('@') || !validTurnHostPort(hostPort)) throw new Error('Invalid TURN host or port');
  const params = new URLSearchParams(query);
  if ([...params.keys()].some(key => key !== 'transport') || params.getAll('transport').length > 1) throw new Error('TURN URL only supports a transport query parameter');
  const transport = params.get('transport');
  if (transport && !['udp', 'tcp'].includes(transport.toLowerCase())) throw new Error('TURN transport must be udp or tcp');
  if (scheme.toLowerCase() === 'turns' && transport?.toLowerCase() === 'udp') throw new Error('TURNS requires TCP transport');
  return value;
}

function validTurnHostPort(value) {
  const match = value.startsWith('[')
    ? /^\[[0-9a-f:.]+\](?::(\d{1,5}))?$/i.exec(value)
    : /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(value);
  if (!match) return false;
  const port = value.startsWith('[') ? match[1] : match[2];
  return !port || (Number(port) > 0 && Number(port) <= 65535);
}

function candidateSummary(candidate) {
  if (!candidate) return null;
  const summary = {};
  if (SAFE_CANDIDATE_TYPES.has(candidate.candidateType)) summary.type = candidate.candidateType;
  if (SAFE_PROTOCOLS.has(candidate.protocol)) summary.protocol = candidate.protocol;
  if (SAFE_PROTOCOLS.has(candidate.relayProtocol)) summary.relayProtocol = candidate.relayProtocol;
  return Object.keys(summary).length ? summary : null;
}

function gatheredCandidateSummary(candidate) {
  if (!candidate) return null;
  const summary = {};
  if (SAFE_CANDIDATE_TYPES.has(candidate.type)) summary.type = candidate.type;
  if (SAFE_PROTOCOLS.has(candidate.protocol)) summary.protocol = candidate.protocol;
  if (SAFE_PROTOCOLS.has(candidate.relayProtocol)) summary.relayProtocol = candidate.relayProtocol;
  return Object.keys(summary).length ? summary : null;
}

function iceServerSummary(pc) {
  if (typeof pc.getConfiguration !== 'function') return null;
  const counts = { stun: 0, turn: 0 };
  for (const server of pc.getConfiguration()?.iceServers || []) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    for (const value of urls) {
      const scheme = String(value || '').split(':', 1)[0].toLowerCase();
      if (scheme === 'stun' || scheme === 'stuns') counts.stun++;
      else if (scheme === 'turn' || scheme === 'turns') counts.turn++;
    }
  }
  return counts;
}

export function summarizeIceStats(stats) {
  const entries = [...stats.values()];
  const pair = entries.find(item => item.type === 'candidate-pair' && item.selected)
    || entries.find(item => item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded')
    || entries.find(item => item.type === 'candidate-pair' && item.state === 'failed');
  if (!pair) return null;
  const byId = new Map(entries.map(item => [item.id, item]));
  const summary = { state: typeof pair.state === 'string' ? pair.state : 'unknown' };
  const local = candidateSummary(byId.get(pair.localCandidateId));
  const remote = candidateSummary(byId.get(pair.remoteCandidateId));
  if (local) summary.local = local;
  if (remote) summary.remote = remote;
  return summary;
}

export function observeIceDiagnostics(pc, onDiagnostic) {
  if (typeof onDiagnostic !== 'function') return () => {};
  let statsReported = false;
  const emit = event => onDiagnostic({ ...event, at: Date.now() });
  const servers = iceServerSummary(pc);
  if (servers) emit({ type: 'ice-server-config', ...servers });
  const reportFailureStats = () => {
    if (statsReported || typeof pc.getStats !== 'function') return;
    statsReported = true;
    Promise.resolve(pc.getStats()).then(stats => {
      emit({ type: 'ice-failure-stats', selectedCandidatePair: summarizeIceStats(stats) });
    }).catch(() => emit({ type: 'ice-failure-stats', selectedCandidatePair: null }));
  };
  const gathering = () => emit({ type: 'ice-gathering-state', state: pc.iceGatheringState || 'unknown' });
  const iceConnection = () => {
    const state = pc.iceConnectionState || 'unknown';
    emit({ type: 'ice-connection-state', state });
    if (state === 'failed') reportFailureStats();
  };
  const connection = () => {
    const state = pc.connectionState || 'unknown';
    emit({ type: 'peer-connection-state', state });
    if (state === 'failed') reportFailureStats();
  };
  const candidateError = event => {
    const code = Number.isFinite(event.errorCode) ? event.errorCode : 0;
    const serverType = /^(stun|stuns|turn|turns):/i.exec(String(event.url || ''))?.[1]?.toLowerCase() || 'unknown';
    emit({ type: 'ice-candidate-error', code, category: iceCandidateErrorCategory(code), serverType });
  };
  const candidate = event => {
    if (!event.candidate) return emit({ type: 'ice-candidates-complete' });
    const summary = gatheredCandidateSummary(event.candidate);
    if (summary) emit({ type: 'ice-candidate', candidate: summary });
  };
  pc.addEventListener('icegatheringstatechange', gathering);
  pc.addEventListener('iceconnectionstatechange', iceConnection);
  pc.addEventListener('connectionstatechange', connection);
  pc.addEventListener('icecandidateerror', candidateError);
  pc.addEventListener('icecandidate', candidate);
  gathering(); iceConnection(); connection();
  return () => {
    pc.removeEventListener('icegatheringstatechange', gathering);
    pc.removeEventListener('iceconnectionstatechange', iceConnection);
    pc.removeEventListener('connectionstatechange', connection);
    pc.removeEventListener('icecandidateerror', candidateError);
    pc.removeEventListener('icecandidate', candidate);
  };
}

const DEFAULT_RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
};

export function createRtcConfig({ turnUrls = [], username = '', credential = '' } = {}) {
  const urls = Array.isArray(turnUrls) ? turnUrls.map(value => String(value).trim()).filter(Boolean) : [];
  if (urls.length === 0) return { iceServers: [...DEFAULT_RTC_CONFIG.iceServers] };
  if (urls.length > MAX_TURN_URLS) throw new Error(`At most ${MAX_TURN_URLS} TURN URLs are allowed`);
  if (typeof username !== 'string' || !username || username.length > MAX_TURN_USERNAME_LENGTH || typeof credential !== 'string' || !credential || credential.length > MAX_TURN_CREDENTIAL_LENGTH) throw new Error('TURN username and password are required and must be within length limits');
  for (const value of urls) validTurnUrl(value);
  return { iceServers: [...DEFAULT_RTC_CONFIG.iceServers, { urls, username, credential }] };
}

export async function testTurnConfiguration(rtcConfig, { timeoutMs = 10_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) throw new RangeError('TURN test timeout must be between 1 and 30 seconds');
  if (!Array.isArray(rtcConfig?.iceServers) || rtcConfig.iceServers.length < 2) throw new Error('Configure at least one TURN server before testing');
  const pc = new RTCPeerConnection(rtcConfig);
  pc.createDataChannel('snorb-turn-probe');
  let relayCandidate = false;
  let candidateError = null;
  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pc.removeEventListener('icecandidate', candidate);
        pc.removeEventListener('icecandidateerror', candidateFailure);
        pc.removeEventListener('icegatheringstatechange', gatheringComplete);
        resolve(result);
      };
      const candidate = event => { if (event.candidate?.type === 'relay') relayCandidate = true; };
      const candidateFailure = event => {
        const code = Number.isFinite(event.errorCode) ? event.errorCode : 0;
        candidateError = iceCandidateErrorCategory(code);
      };
      const gatheringComplete = () => {
        if (pc.iceGatheringState === 'complete') finish({ relayCandidate, gatheringState: 'complete', timedOut: false, candidateError });
      };
      const timer = setTimeout(() => finish({ relayCandidate, gatheringState: pc.iceGatheringState || 'unknown', timedOut: true, candidateError }), timeoutMs);
      pc.addEventListener('icecandidate', candidate);
      pc.addEventListener('icecandidateerror', candidateFailure);
      pc.addEventListener('icegatheringstatechange', gatheringComplete);
      Promise.resolve(pc.createOffer()).then(offer => pc.setLocalDescription(offer)).then(gatheringComplete).catch(error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
    return result;
  } finally {
    pc.close();
  }
}

export async function hostWebRtcRoom(capability, { onTransport, onWarning, onDiagnostic, rtcConfig = DEFAULT_RTC_CONFIG } = {}) {
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
        const { transport, answer, iceGatheringComplete } = await acceptHostWebRtcOffer(offer, rtcConfig, { onPeerConnection: pc => observeIceDiagnostics(pc, onDiagnostic) });
        if (!iceGatheringComplete) onWarning?.('ICE gathering timed out; sending answer with gathered candidates');
        tracker.answer({ answer, offerId, toPeerId: peerId });
        onTransport?.(transport, peerId);
      } catch (error) { onWarning?.(error.message); }
      finally { activeNegotiations--; }
    },
  });
  tracker.connect();
  return { close: () => tracker.close(), tracker };
}

export async function joinWebRtcRoom(capability, { onTransport, onWarning, onDiagnostic, rtcConfig = DEFAULT_RTC_CONFIG } = {}) {
  let tracker = null;
  let transport = null;
  let timedOut = false;
  let connected = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    onWarning?.('Timed out waiting for a WebRTC room answer');
    tracker?.close();
    transport?.close('join-timeout');
  }, JOIN_TIMEOUT_MS);
  const url = capability.trackerUrls?.[0];
  try {
    if (!url) throw new Error('A WSS tracker URL is required');
    const infoHash = await deriveInfoHash(capability);
    const peerId = crypto.getRandomValues(new Uint8Array(20));
    const created = await createGuestWebRtcOffer(rtcConfig, { onPeerConnection: pc => observeIceDiagnostics(pc, onDiagnostic) });
    transport = created.transport;
    if (timedOut) {
      transport.close('join-timeout');
      throw new Error('Timed out waiting for a WebRTC room answer');
    }
    if (!created.iceGatheringComplete) onWarning?.('ICE gathering timed out; sending offer with gathered candidates');
    tracker = new WebTorrentTrackerClient({
      url, infoHash, peerId, onWarning,
      onOpen: () => tracker.announceOffers([{ offer: created.offer, token: transport }]),
      onAnswer: async ({ answer, token }) => {
        if (token !== transport || connected || timedOut) return;
        try {
          await applyGuestWebRtcAnswer(transport, answer);
          if (timedOut) return;
          await onTransport?.(transport);
          if (timedOut) return;
          connected = true;
          clearTimeout(timeout);
        } catch (error) { onWarning?.(error.message); }
      },
    });
    tracker.connect();
    return {
      close: () => {
        clearTimeout(timeout);
        tracker.close();
        transport.close('left');
      },
      tracker,
      transport,
    };
  } catch (error) {
    clearTimeout(timeout);
    tracker?.close();
    transport?.close('join-failed');
    throw error;
  }
}
