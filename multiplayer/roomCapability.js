const encoder = new TextEncoder();

function randomBytes(length) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('WebCrypto is required for multiplayer rooms');
  return crypto.getRandomValues(new Uint8Array(length));
}
function base64url(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unbase64url(text, expected) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid room capability');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length !== expected) throw new Error('Invalid room capability length');
  return bytes;
}

export function createRoomCapability(trackerUrls = []) {
  return { roomId: randomBytes(16), secret: randomBytes(32), hostPeerId: randomBytes(20), trackerUrls };
}

export function encodeInvite(capability, baseUrl = location.href) {
  const url = new URL(baseUrl); url.hash = '';
  const params = new URLSearchParams({
    room: base64url(capability.roomId), key: base64url(capability.secret), host: base64url(capability.hostPeerId),
  });
  for (const tracker of capability.trackerUrls || []) params.append('tracker', tracker);
  url.hash = params.toString();
  return url.href;
}

export function parseInviteFragment(hash = location.hash, { clear = true } = {}) {
  if (!hash || hash === '#') return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('room') || !params.has('key') || !params.has('host')) return null;
  const capability = {
    roomId: unbase64url(params.get('room'), 16),
    secret: unbase64url(params.get('key'), 32),
    hostPeerId: unbase64url(params.get('host'), 20),
    trackerUrls: params.getAll('tracker').slice(0, 4),
  };
  if (clear && globalThis.history) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return capability;
}

export async function deriveInfoHash(capability) {
  const domain = encoder.encode('snorb-room-v1\0');
  const input = new Uint8Array(domain.length + capability.roomId.length + capability.secret.length);
  input.set(domain); input.set(capability.roomId, domain.length); input.set(capability.secret, domain.length + capability.roomId.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input)).slice(0, 20);
}

export function roomIdString(capability) { return base64url(capability.roomId); }
export function peerIdString(bytes) { return base64url(bytes); }
