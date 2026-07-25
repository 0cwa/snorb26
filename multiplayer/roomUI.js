import { AuthorityRole } from '../authority.js';
import { createHostIdentity, createRoomCapability, encodeInvite, parseInviteFragment } from './roomCapability.js';
import { roomSession } from './sessionController.js';
import { createRtcConfig, testTurnConfiguration } from './webrtcRoom.js';

const dialog = document.getElementById('roomDialog');
const status = document.getElementById('roomStatus');
const tracker = document.getElementById('roomTracker');
const turnUrls = document.getElementById('roomTurnUrls');
const turnUsername = document.getElementById('roomTurnUsername');
const turnCredential = document.getElementById('roomTurnCredential');
const copyButton = document.getElementById('copyInviteBtn');
const allowEdits = document.getElementById('allowGuestEdits');
const inviteInput = document.getElementById('roomInviteInput');
const inviteState = document.getElementById('roomInviteState');
const joinButton = document.getElementById('joinRoomBtn');
const reconnectButton = document.getElementById('reconnectRoomBtn');
const indicator = document.getElementById('multiplayerIndicator');
const menuButton = document.getElementById('openMultiplayerBtn');
let inviteCapability = null;
let currentInvite = '';
const eventLog = document.getElementById('roomEventLog');
const testTurnButton = document.getElementById('testTurnBtn');
const turnTestResult = document.getElementById('turnTestResult');
const turnVerifiedIcon = document.getElementById('turnVerifiedIcon');
const copyRoomLogButton = document.getElementById('copyRoomLogBtn');
const TURN_STORAGE_KEY = 'snorb.multiplayer.turn.v1';
let verifiedTurnSignature = null;

function turnSettingsFromForm() {
  return {
    turnUrls: turnUrls.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    username: turnUsername.value.trim(),
    credential: turnCredential.value,
  };
}

function turnSignature(settings = turnSettingsFromForm()) {
  return JSON.stringify(settings);
}

function setTurnVerification(verified, message = '') {
  turnVerifiedIcon.textContent = verified ? '✓' : '○';
  turnVerifiedIcon.dataset.verified = String(verified);
  turnVerifiedIcon.setAttribute('aria-label', verified ? 'TURN relay verified' : 'TURN relay not verified');
  if (message) turnTestResult.textContent = message;
}

function persistTurnSettings() {
  try { localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify(turnSettingsFromForm())); }
  catch { /* Storage can be unavailable in private or hardened browser modes. */ }
}

function applyTurnSettings(settings, { persist = true } = {}) {
  if (!settings) return;
  turnUrls.value = Array.isArray(settings.turnUrls) ? settings.turnUrls.join('\n') : '';
  turnUsername.value = typeof settings.username === 'string' ? settings.username : '';
  turnCredential.value = typeof settings.credential === 'string' ? settings.credential : '';
  verifiedTurnSignature = null;
  setTurnVerification(false);
  if (persist) persistTurnSettings();
}

function restoreTurnSettings() {
  try { applyTurnSettings(JSON.parse(localStorage.getItem(TURN_STORAGE_KEY)), { persist: false }); }
  catch { /* Ignore absent or invalid older settings. */ }
}

async function writeClipboardText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* Fall through for browsers that deny the async clipboard API. */ }
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Clipboard copy was denied');
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function renderEvent(event) {
  // A staged GitHub Pages deploy can briefly serve this module with an older
  // cached document that has no event list. Status updates must still work.
  if (!eventLog) return;
  const item = document.createElement('li');
  item.dataset.level = event.level;
  item.textContent = `${new Date(event.timestamp).toLocaleTimeString()} — ${event.message}`;
  eventLog.append(item);
  while (eventLog.children.length > 40) eventLog.firstChild.remove();
  eventLog.scrollTop = eventLog.scrollHeight;
}

function connectionState(role, phase, peers) {
  if (phase === 'hosting') return 'Hosting';
  if (phase === 'joining') return 'Joining…';
  if (phase === 'connected') return role === AuthorityRole.HOST
    ? `Hosting · ${peers} peer${peers === 1 ? '' : 's'}`
    : 'Connected';
  if (phase === 'reconnect-needed') return 'Reconnect needed';
  return 'Single-player';
}

function updateConnectionIndicator(role = roomSession.role, phase = roomSession.phase, peers = roomSession.peers.size) {
  const state = connectionState(role, phase, peers);
  indicator.textContent = `Multiplayer: ${state}`;
  menuButton.textContent = state === 'Single-player' ? 'Multiplayer…' : `Multiplayer · ${state}`;
}

function updateInviteState() {
  const loaded = Boolean(inviteCapability);
  inviteState.textContent = loaded ? 'Invite loaded: ready to join.' : 'No invite loaded.';
  reconnectButton.disabled = !loaded;
  if (roomSession.phase === 'single-player') updateConnectionIndicator();
}

function parseInviteText(value) {
  const text = value.trim();
  if (!text) throw new Error('Paste an invite link first.');
  let hash = text;
  if (!text.startsWith('#')) {
    try { hash = new URL(text, location.href).hash; }
    catch { throw new Error('Invalid invite link.'); }
  }
  const capability = parseInviteFragment(hash, { clear: false });
  if (!capability) throw new Error('This is not a valid Snorb invite link.');
  return capability;
}

function loadInvite(capability) {
  if (capability.turnConfig) createRtcConfig(capability.turnConfig);
  inviteCapability = capability;
  roomSession.loadInvite(capability);
  if (capability.trackerUrls[0]) tracker.value = capability.trackerUrls[0];
  if (capability.turnConfig) {
    applyTurnSettings(capability.turnConfig);
    setTurnVerification(true, 'TURN relay loaded from a host-verified invite.');
  }
  inviteInput.value = '';
  updateInviteState();
}

function rtcConfigFromForm() {
  return createRtcConfig(turnSettingsFromForm());
}

restoreTurnSettings();
inviteCapability = parseInviteFragment(location.hash, { clear: true });
if (inviteCapability) {
  loadInvite(inviteCapability);
  dialog.showModal();
} else {
  updateInviteState();
}
updateConnectionIndicator();

document.getElementById('closeRoomBtn').addEventListener('click', () => dialog.close());
allowEdits.addEventListener('change', () => { roomSession.allowGuestEdits = allowEdits.checked; });
indicator.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); });
inviteInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault(); joinButton.click();
  }
});
for (const input of [turnUrls, turnUsername, turnCredential]) {
  input.addEventListener('input', () => {
    persistTurnSettings();
    verifiedTurnSignature = null;
    setTurnVerification(false, turnSettingsFromForm().turnUrls.length ? 'Verify these settings before they can be shared.' : '');
  });
}

document.getElementById('hostRoomBtn').addEventListener('click', async () => {
  currentInvite = '';
  copyButton.disabled = true;
  try {
    const trackerUrl = new URL(tracker.value).href;
    const capability = await createHostIdentity(createRoomCapability([trackerUrl]));
    const settings = turnSettingsFromForm();
    if (settings.turnUrls.length && verifiedTurnSignature === turnSignature(settings)) capability.turnConfig = settings;
    await roomSession.host(capability, { rtcConfig: rtcConfigFromForm() });
    currentInvite = encodeInvite(capability);
    copyButton.disabled = false;
  } catch (error) { setStatus(error.message, true); }
});

async function joinLoadedInvite(reconnecting = false) {
  if (!inviteCapability) return setStatus('Load an invite before joining.', true);
  try {
    setStatus(reconnecting ? 'Reconnecting with loaded invite…' : 'Joining loaded invite…');
    await (reconnecting
      ? roomSession.reconnect({ rtcConfig: rtcConfigFromForm() })
      : roomSession.join(inviteCapability, { rtcConfig: rtcConfigFromForm() }));
    updateInviteState();
  }
  catch (error) { setStatus(error.message, true); }
}
testTurnButton.addEventListener('click', async () => {
  try {
    testTurnButton.disabled = true;
    turnTestResult.textContent = 'Testing TURN relay…';
    const result = await testTurnConfiguration(rtcConfigFromForm());
    if (result.relayCandidate) {
      verifiedTurnSignature = turnSignature();
      persistTurnSettings();
      setTurnVerification(true, 'TURN relay verified. Hosts will include it in new invite links.');
    } else {
      verifiedTurnSignature = null;
      setTurnVerification(false, result.candidateError === 'server-unreachable'
        ? 'TURN server could not be reached.'
        : 'No relay candidate gathered. Check the TURN URL, credentials, and firewall policy.');
    }
  } catch { verifiedTurnSignature = null; setTurnVerification(false, 'TURN test could not start. Check the TURN configuration.'); }
  finally { testTurnButton.disabled = false; }
});

joinButton.addEventListener('click', () => {
  try {
    if (inviteInput.value.trim()) loadInvite(parseInviteText(inviteInput.value));
    void joinLoadedInvite();
  } catch (error) { setStatus(error.message, true); }
});
reconnectButton.addEventListener('click', () => joinLoadedInvite(true));

copyButton.addEventListener('click', async () => {
  if (!currentInvite) return;
  try { await writeClipboardText(currentInvite); setStatus('Invite copied.'); }
  catch { setStatus('Could not access clipboard.', true); }
});
copyRoomLogButton.addEventListener('click', async () => {
  const lines = roomSession.getRecentEvents().map(event =>
    `${new Date(event.timestamp).toISOString()} [${event.level}] ${event.code}: ${event.message}`);
  const debugLog = [
    `Snorb ${document.querySelector('meta[name="application-name"]')?.content || 'multiplayer'} debug log`,
    `Browser: ${navigator.userAgent}`,
    `State: ${connectionState(roomSession.role, roomSession.phase, roomSession.peers.size)}`,
    ...lines,
  ].join('\n');
  try { await writeClipboardText(debugLog); setStatus('Debug log copied.'); }
  catch { setStatus('Could not copy the debug log.', true); }
});

document.getElementById('leaveRoomBtn').addEventListener('click', async () => {
  try { await roomSession.leave(); }
  finally { currentInvite = ''; copyButton.disabled = true; }
});
roomSession.addEventListener('status', event => {
  const { role, phase, peers, allowGuestEdits } = event.detail;
  const permission = allowGuestEdits ? 'guest actions enabled' : 'guest actions disabled';
  updateConnectionIndicator(role, phase, peers);
  allowEdits.disabled = role !== AuthorityRole.HOST;
  setStatus(`${connectionState(role, phase, peers)} · ${permission}`);
});

roomSession.getRecentEvents().forEach(renderEvent);
roomSession.addEventListener('event', event => renderEvent(event.detail));
window.addEventListener('beforeunload', () => roomSession.leave());
