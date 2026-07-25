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
const loadInviteButton = document.getElementById('loadInviteBtn');
const joinButton = document.getElementById('joinRoomBtn');
const reconnectButton = document.getElementById('reconnectRoomBtn');
const indicator = document.getElementById('multiplayerIndicator');
const menuButton = document.getElementById('openMultiplayerBtn');
let inviteCapability = null;
let currentInvite = '';
const eventLog = document.getElementById('roomEventLog');
const testTurnButton = document.getElementById('testTurnBtn');
const turnTestResult = document.getElementById('turnTestResult');

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
  joinButton.disabled = !loaded;
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
  inviteCapability = capability;
  roomSession.loadInvite(capability);
  if (capability.trackerUrls[0]) tracker.value = capability.trackerUrls[0];
  inviteInput.value = '';
  updateInviteState();
}

function rtcConfigFromForm() {
  return createRtcConfig({
    turnUrls: turnUrls.value.split(/\r?\n/),
    username: turnUsername.value.trim(),
    credential: turnCredential.value,
  });
}

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
loadInviteButton.addEventListener('click', () => {
  try { loadInvite(parseInviteText(inviteInput.value)); setStatus('Invite loaded: ready to join.'); }
  catch (error) { setStatus(error.message, true); }
});
inviteInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault(); loadInviteButton.click();
  }
});

document.getElementById('hostRoomBtn').addEventListener('click', async () => {
  try {
    const trackerUrl = new URL(tracker.value).href;
    const capability = await createHostIdentity(createRoomCapability([trackerUrl]));
    currentInvite = encodeInvite(capability);
    copyButton.disabled = false;
    await roomSession.host(capability, { rtcConfig: rtcConfigFromForm() });
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
    turnTestResult.textContent = result.relayCandidate
      ? 'TURN relay candidate gathered.'
      : result.timedOut ? 'No relay candidate before timeout.' : 'No relay candidate gathered.';
  } catch (error) { turnTestResult.textContent = error.message; }
  finally { testTurnButton.disabled = false; }
});

joinButton.addEventListener('click', () => joinLoadedInvite());
reconnectButton.addEventListener('click', () => joinLoadedInvite(true));

copyButton.addEventListener('click', async () => {
  if (!currentInvite) return;
  try { await navigator.clipboard.writeText(currentInvite); setStatus('Invite copied.'); }
  catch { setStatus('Could not access clipboard.', true); }
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => roomSession.leave());
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
