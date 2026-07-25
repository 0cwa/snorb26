import { AuthorityRole } from '../authority.js';
import { createHostIdentity, createRoomCapability, encodeInvite, parseInviteFragment } from './roomCapability.js';
import { roomSession } from './sessionController.js';

const dialog = document.getElementById('roomDialog');
const status = document.getElementById('roomStatus');
const tracker = document.getElementById('roomTracker');
const copyButton = document.getElementById('copyInviteBtn');
const allowEdits = document.getElementById('allowGuestEdits');
let inviteCapability = null;
let currentInvite = '';

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

inviteCapability = parseInviteFragment(location.hash, { clear: true });
if (inviteCapability) {
  if (inviteCapability.trackerUrls[0]) tracker.value = inviteCapability.trackerUrls[0];
  setStatus('Invite loaded. Choose “Join invite”.');
  dialog.showModal();
}

document.getElementById('closeRoomBtn').addEventListener('click', () => dialog.close());
allowEdits.addEventListener('change', () => { roomSession.allowGuestEdits = allowEdits.checked; });

document.getElementById('hostRoomBtn').addEventListener('click', async () => {
  try {
    const trackerUrl = new URL(tracker.value).href;
    const capability = await createHostIdentity(createRoomCapability([trackerUrl]));
    currentInvite = encodeInvite(capability);
    copyButton.disabled = false;
    await roomSession.host(capability);
  } catch (error) { setStatus(error.message, true); }
});

document.getElementById('joinRoomBtn').addEventListener('click', async () => {
  if (!inviteCapability) return setStatus('Open a Snorb invite URL first.', true);
  try { await roomSession.join(inviteCapability); inviteCapability = null; }
  catch (error) { setStatus(error.message, true); }
});

copyButton.addEventListener('click', async () => {
  if (!currentInvite) return;
  try { await navigator.clipboard.writeText(currentInvite); setStatus('Invite copied.'); }
  catch { setStatus('Could not access clipboard.', true); }
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => roomSession.leave());
roomSession.addEventListener('status', event => {
  const { role, peers, message, error } = event.detail;
  setStatus(`${message} · ${role} · ${peers} peer${peers === 1 ? '' : 's'}`, error);
  allowEdits.disabled = role !== AuthorityRole.HOST;
});
window.addEventListener('beforeunload', () => roomSession.leave());
