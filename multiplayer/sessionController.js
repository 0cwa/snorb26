import { AuthorityRole, setAuthorityRole } from '../authority.js';
import { appState, deserializeMap, serializeMap, customBuildingRegistry, mapId } from '../state.js';
import { rebuildBuildingInstances, rebuildCubeBuffers, rebuildExtrusionBuffers, updatePaletteTexture, uploadElevations, loadCustomTexture } from '../renderer.js';
import { saveMapToLocal } from '../storage.js';
import { stopWorker, syncWorkerState } from '../workerClient.js';
import { exportLoroSnapshot, importLoroUpdate, initializeLoroCommandLog } from './loroCommandLog.js';
import { initializeCommandBus, rebuildBuildingIdIndex, setGuestRequestHandler, submitSemanticCommand, submitSemanticCommands, subscribeAcceptedCommands } from './commandBus.js';
import { MessageKind, decodeFrame, decodeJsonPayload, encodeFrame, encodeJsonPayload } from './protocol.js';
import { roomIdString } from './roomCapability.js';
import { SnapshotPublisher, SnapshotReceiver } from './snapshotFlow.js';
import { applySimulationSnapshot, captureSimulationSnapshot, encodeSimulationSnapshot } from './snapshotCodec.js';
import { hostWebRtcRoom, joinWebRtcRoom } from './webrtcRoom.js';
import { applyRuntimeAction, setGuestRuntimeActionHandler } from './runtimeActions.js';

const MAX_PEERS = 8;
const encoder = new TextEncoder();
const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

function authMessage(roomId, role, challenge) { return encoder.encode(`snorb-auth-v1\0${roomId}\0${role}\0${challenge}`); }
async function guestAuthProof(secret, roomId, challenge) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, authMessage(roomId, 'guest', challenge))));
}
async function hostAuthProof(privateKey, roomId, challenge) {
  if (!privateKey) throw new Error('Missing host private identity');
  return toHex(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, authMessage(roomId, 'host', challenge))));
}
async function verifyHostProof(publicBytes, roomId, challenge, signatureHex) {
  if (!(publicBytes instanceof Uint8Array) || !/^[a-f0-9]+$/.test(signatureHex || '')) return false;
  const key = await crypto.subtle.importKey('raw', publicBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signature = Uint8Array.from(signatureHex.match(/../g), value => parseInt(value, 16));
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, authMessage(roomId, 'host', challenge));
}

function refreshWorld() {
  updatePaletteTexture(); uploadElevations(); rebuildBuildingInstances(); rebuildExtrusionBuffers(); rebuildCubeBuffers();
  for (const url of customBuildingRegistry) if (url) loadCustomTexture(url);
}

class RoomSession extends EventTarget {
  constructor() {
    super(); this.role = AuthorityRole.SINGLE_PLAYER; this.capability = null; this.roomId = '';
    this.hostEpoch = 0; this.sequence = 0; this.peers = new Set(); this.signaling = null;
    this.publisher = null; this.receiver = new SnapshotReceiver(snapshot => { applySimulationSnapshot(snapshot); rebuildBuildingIdIndex(); refreshWorld(); });
    this.localBackup = null; this.unsubscribeCommands = null; this.loroBroadcastTimer = null;
    this.allowGuestEdits = true; this.phase = 'single-player'; this.generation = 0;
  }
  #status(detail) { this.dispatchEvent(new CustomEvent('status', { detail: { role: this.role, phase: this.phase, peers: this.peers.size, allowGuestEdits: this.allowGuestEdits, ...detail } })); }
  async host(capability, { rtcConfig } = {}) {
    await this.leave(); const generation = ++this.generation; this.capability = capability; this.roomId = roomIdString(capability);
    this.hostEpoch = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    encodeSimulationSnapshot(captureSimulationSnapshot({ hostEpoch: this.hostEpoch, sequence: 1 }));
    this.role = AuthorityRole.HOST; this.phase = 'hosting'; setAuthorityRole(this.role);
    try {
      this.signaling = await hostWebRtcRoom(capability, { rtcConfig, onTransport: transport => generation === this.generation ? this.#attach(transport, true) : transport.close('stale-session'), onWarning: message => this.#status({ message, error: true }) });
    } catch (error) { await this.leave(); throw error; }
    this.publisher = new SnapshotPublisher(bytes => {
      const frame = encodeFrame({ kind: MessageKind.SIM_SNAPSHOT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: ++this.sequence, payload: bytes });
      for (const peer of this.peers) if (peer.authenticated) peer.transport.sendTransient(frame);
    }, { hz: 4, hostEpoch: this.hostEpoch });
    this.publisher.start();
    this.unsubscribeCommands = subscribeAcceptedCommands(() => this.#scheduleLoroBroadcast());
    this.#status({ message: 'Hosting room' });
  }
  async join(capability, { rtcConfig } = {}) {
    await this.leave(); const generation = ++this.generation; this.localBackup = { map: serializeMap(), gameTime: appState.gameTime }; this.capability = capability; this.roomId = roomIdString(capability);
    this.role = AuthorityRole.GUEST; this.phase = 'joining'; setAuthorityRole(this.role); stopWorker();
    this.receiver = new SnapshotReceiver(snapshot => { applySimulationSnapshot(snapshot); rebuildBuildingIdIndex(); refreshWorld(); });
    setGuestRequestHandler(request => this.#sendCommandRequest(request));
    setGuestRuntimeActionHandler(request => this.#sendCommandRequest(request));
    try {
      this.signaling = await joinWebRtcRoom(capability, { rtcConfig, onTransport: transport => generation === this.generation ? this.#attach(transport, false) : transport.close('stale-session'), onWarning: message => this.#status({ message, error: true }) });
    } catch (error) { await this.leave(); throw error; }
    this.#status({ message: 'Joining room…' });
  }
  async #attach(transport, hosting) {
    if (this.peers.size >= MAX_PEERS) { transport.close('room-full'); return; }
    const peer = { transport, authenticated: false, requests: [], hosting, authTimer: null, lastRequestSequence: 0, challenge: null };
    this.peers.add(peer);
    peer.authTimer = setTimeout(() => { if (!peer.authenticated) transport.close('authentication-timeout'); }, 10_000);
    transport.setHandlers({
      onOpen: async () => {
        peer.expectedRole = hosting ? 'guest' : 'host';
        if (hosting) return; // Host responds only after receiving a fresh guest challenge.
        peer.challenge = toHex(crypto.getRandomValues(new Uint8Array(32)));
        const proof = await guestAuthProof(this.capability.secret, this.roomId, peer.challenge);
        transport.sendReliable(encodeFrame({ kind: MessageKind.HELLO, roomId: this.roomId, hostEpoch: 0, payload: encodeJsonPayload({ role: 'guest', challenge: peer.challenge, proof }) }));
      },
      onReliableMessage: bytes => this.#message(peer, bytes, false).catch(error => { this.#status({ message: error.message, error: true }); transport.close('protocol-error'); }),
      onTransientMessage: bytes => this.#message(peer, bytes, true).catch(error => { this.#status({ message: error.message, error: true }); transport.close('protocol-error'); }),
      onClose: reason => { clearTimeout(peer.authTimer); this.peers.delete(peer); this.#status({ message: `Peer left: ${reason}` }); if (this.role === AuthorityRole.GUEST) this.leave(); },
      onError: error => this.#status({ message: error.message, error: true }),
    });
    await transport.open();
  }
  async #message(peer, bytes, transient) {
    const frame = decodeFrame(bytes);
    if (frame.roomId !== this.roomId) throw new Error('Wrong room');
    if (!peer.authenticated) {
      if (frame.kind !== MessageKind.HELLO || transient) throw new Error('Authentication required');
      const hello = decodeJsonPayload(frame.payload);
      if (hello.role !== peer.expectedRole) throw new Error('Wrong peer role');
      if (typeof hello.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(hello.challenge)) throw new Error('Invalid authentication challenge');
      if (hello.role === 'host' && hello.challenge !== peer.challenge) throw new Error('Mismatched host challenge');
      const validProof = hello.role === 'host'
        ? await verifyHostProof(this.capability.hostPublicKey, this.roomId, hello.challenge, hello.proof)
        : hello.proof === await guestAuthProof(this.capability.secret, this.roomId, hello.challenge);
      if (!validProof) throw new Error('Invalid room proof');
      peer.authenticated = true;
      clearTimeout(peer.authTimer);
      if (this.role === AuthorityRole.HOST) {
        const proof = await hostAuthProof(this.capability.hostPrivateKey, this.roomId, hello.challenge);
        peer.transport.sendReliable(encodeFrame({ kind: MessageKind.HELLO, roomId: this.roomId, hostEpoch: this.hostEpoch, payload: encodeJsonPayload({ role: 'host', challenge: hello.challenge, proof, mapId, allowGuestEdits: this.allowGuestEdits }) }));
      }
      if (this.role === AuthorityRole.GUEST) {
        if (!/^[a-f0-9]{32}$/.test(hello.mapId || '')) throw new Error('Invalid host map id');
        if (typeof hello.allowGuestEdits !== 'boolean') throw new Error('Invalid room permissions');
        this.allowGuestEdits = hello.allowGuestEdits;
        await initializeLoroCommandLog(hello.mapId);
      }
      if (this.role === AuthorityRole.HOST) await this.#sendBaseline(peer);
      this.phase = 'connected';
      this.#status({ message: 'Peer authenticated' });
      return;
    }
    if (this.role === AuthorityRole.GUEST && frame.hostEpoch) this.hostEpoch ||= frame.hostEpoch;
    if (this.hostEpoch && frame.hostEpoch && frame.hostEpoch !== this.hostEpoch) throw new Error('Wrong host epoch');
    if (frame.kind === MessageKind.SIM_SNAPSHOT && transient && this.role === AuthorityRole.GUEST) this.receiver.receive(frame.payload);
    else if ([MessageKind.LORO_SYNC, MessageKind.LORO_UPDATE].includes(frame.kind) && this.role === AuthorityRole.GUEST) await importLoroUpdate(frame.payload);
    else if (frame.kind === MessageKind.COMMAND_REQUEST && this.role === AuthorityRole.HOST) await this.#acceptCommand(peer, frame);
    else if (frame.kind === MessageKind.COMMAND_RESULT && this.role === AuthorityRole.GUEST) {
      const result = decodeJsonPayload(frame.payload);
      this.#status({ message: result.accepted ? 'Action accepted' : `Action rejected: ${result.error || 'unknown error'}`, error: !result.accepted, action: { requestId: result.requestId, status: result.accepted ? 'accepted' : 'rejected', error: result.error } });
    }
    else if (frame.kind === MessageKind.PING) peer.transport.sendReliable(encodeFrame({ kind: MessageKind.PONG, roomId: this.roomId, hostEpoch: this.hostEpoch }));
    else throw new Error('Unexpected room message');
  }
  async #sendBaseline(peer) {
    const loro = await exportLoroSnapshot();
    peer.transport.sendReliable(encodeFrame({ kind: MessageKind.LORO_SYNC, roomId: this.roomId, hostEpoch: this.hostEpoch, payload: loro }));
    const snapshot = this.publisher.nextSnapshot();
    peer.transport.sendTransient(encodeFrame({ kind: MessageKind.SIM_SNAPSHOT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: ++this.sequence, payload: snapshot }));
  }
  async #acceptCommand(peer, frame) {
    if (frame.sequence <= peer.lastRequestSequence) throw new Error('Duplicate command sequence');
    peer.lastRequestSequence = frame.sequence;
    const request = decodeJsonPayload(frame.payload);
    if (!this.allowGuestEdits) {
      peer.transport.sendReliable(encodeFrame({ kind: MessageKind.COMMAND_RESULT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: frame.sequence, payload: encodeJsonPayload({ requestId: request.requestId, accepted: false, error: 'Guest edits are disabled' }) }));
      return;
    }
    const now = performance.now(); peer.requests = peer.requests.filter(time => now - time < 1000);
    if (request.action) {
      if (peer.requests.length >= 8) {
        peer.transport.sendReliable(encodeFrame({ kind: MessageKind.COMMAND_RESULT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: frame.sequence, payload: encodeJsonPayload({ requestId: request.requestId, accepted: false, error: 'Action rate exceeded', kind: 'action' }) }));
        return;
      }
      peer.requests.push(now);
      let accepted = false, error = null;
      try { applyRuntimeAction(request.action); accepted = true; } catch (cause) { error = cause.message; }
      peer.transport.sendReliable(encodeFrame({ kind: MessageKind.COMMAND_RESULT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: frame.sequence, payload: encodeJsonPayload({ requestId: request.requestId, accepted, error, kind: 'action' }) }));
      if (accepted) { syncWorkerState(); saveMapToLocal(); }
      return;
    }
    const commands = Array.isArray(request.commands) ? request.commands : [request.command];
    const commandCost = commands.reduce((sum, command) => {
      if (command?.type === 'terrain.level') return sum + (Math.abs(command.x1 - command.x0) + 1) * (Math.abs(command.y1 - command.y0) + 1);
      if (command?.type?.startsWith('terrain.')) return sum + Math.PI * (command.radius || 1) ** 2;
      return sum + 1;
    }, 0);
    if (peer.requests.length >= 8 || commandCost > 65_536) {
      peer.transport.sendReliable(encodeFrame({ kind: MessageKind.COMMAND_RESULT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: frame.sequence, payload: encodeJsonPayload({ requestId: request.requestId, accepted: false, error: 'Edit rate or cost exceeded' }) }));
      return;
    }
    peer.requests.push(now);
    let accepted = false, error = null;
    try {
      accepted = Boolean(Array.isArray(request.commands)
        ? submitSemanticCommands(request.commands).applied
        : submitSemanticCommand(request.command).applied);
    } catch (cause) { error = cause.message; }
    peer.transport.sendReliable(encodeFrame({ kind: MessageKind.COMMAND_RESULT, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: frame.sequence, payload: encodeJsonPayload({ requestId: request.requestId, accepted, error }) }));
    if (accepted) { refreshWorld(); syncWorkerState(); saveMapToLocal(); this.#scheduleLoroBroadcast(); }
  }
  #sendCommandRequest(request) {
    const peer = [...this.peers].find(value => value.authenticated);
    if (!peer) { this.#status({ message: 'Not connected; action was not sent', error: true, action: { requestId: request.requestId, status: 'rejected', error: 'Not connected' } }); return; }
    this.#status({ message: 'Action pending', action: { requestId: request.requestId, status: 'pending' } });
    peer.transport.sendReliable(encodeFrame({ kind: MessageKind.COMMAND_REQUEST, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: ++this.sequence, payload: encodeJsonPayload(request) }));
  }
  #scheduleLoroBroadcast() {
    clearTimeout(this.loroBroadcastTimer);
    const generation = this.generation;
    this.loroBroadcastTimer = setTimeout(async () => {
      const update = await exportLoroSnapshot();
      if (generation !== this.generation || this.role !== AuthorityRole.HOST) return;
      const frame = encodeFrame({ kind: MessageKind.LORO_UPDATE, roomId: this.roomId, hostEpoch: this.hostEpoch, sequence: ++this.sequence, payload: update });
      for (const peer of this.peers) if (peer.authenticated) peer.transport.sendReliable(frame);
    }, 350);
  }
  async leave() {
    this.generation++;
    clearTimeout(this.loroBroadcastTimer); this.publisher?.stop(); this.publisher = null;
    this.unsubscribeCommands?.(); this.unsubscribeCommands = null; setGuestRequestHandler(null); setGuestRuntimeActionHandler(null);
    this.signaling?.close(); this.signaling = null;
    for (const peer of this.peers) peer.transport.close('room-left'); this.peers.clear();
    const restore = this.role === AuthorityRole.GUEST ? this.localBackup : null;
    this.role = AuthorityRole.SINGLE_PLAYER; this.phase = 'single-player'; setAuthorityRole(this.role); this.capability = null; this.roomId = ''; this.hostEpoch = 0;
    if (restore) { deserializeMap(restore.map); appState.gameTime = restore.gameTime; await initializeCommandBus(); refreshWorld(); syncWorkerState(); }
    this.localBackup = null; this.#status({ message: 'Single-player' });
  }
}

export const roomSession = new RoomSession();
