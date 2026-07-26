import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const HOST = '127.0.0.1';
const PORT = 4174;
const PATH = '/announce';
const ORIGIN = 'http://127.0.0.1:4173';
const MAX_MESSAGE = 256 * 1024;
const MAX_SDP = 128 * 1024;
const MAX_CONNECTIONS = 32;
const MAX_SWARMS = 16;
const MAX_PEERS_PER_SWARM = 16;
const swarms = new Map();
const stats = { announces: 0, offers: 0, answers: 0 };
let connections = 0;

function validBinaryId(value) {
  return typeof value === 'string'
    && value.length === 20
    && [...value].every(character => character.charCodeAt(0) <= 255);
}

function validDescription(value, type) {
  return value
    && value.type === type
    && typeof value.sdp === 'string'
    && value.sdp.length <= MAX_SDP;
}

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_MESSAGE) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function removePeer(socket) {
  const identity = socket.identity;
  if (!identity) return;
  const swarm = swarms.get(identity.infoHash);
  if (swarm?.get(identity.peerId) === socket) swarm.delete(identity.peerId);
  if (swarm?.size === 0) swarms.delete(identity.infoHash);
  socket.identity = null;
}

function register(socket, message) {
  if (!validBinaryId(message.info_hash) || !validBinaryId(message.peer_id)) return false;
  if (socket.identity) {
    return socket.identity.infoHash === message.info_hash && socket.identity.peerId === message.peer_id;
  }
  let swarm = swarms.get(message.info_hash);
  if (!swarm) {
    if (swarms.size >= MAX_SWARMS) return false;
    swarm = new Map();
    swarms.set(message.info_hash, swarm);
  }
  const existing = swarm.get(message.peer_id);
  if ((existing && existing !== socket) || swarm.size >= MAX_PEERS_PER_SWARM) return false;
  socket.identity = { infoHash: message.info_hash, peerId: message.peer_id };
  swarm.set(message.peer_id, socket);
  return true;
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      connections,
      swarms: swarms.size,
      ...stats,
    }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

server.on('upgrade', (request, socket, head) => {
  let pathname = '';
  try { pathname = new URL(request.url, `http://${HOST}`).pathname; } catch {}
  if (connections >= MAX_CONNECTIONS || pathname !== PATH || request.headers.origin !== ORIGIN) {
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, client => webSockets.emit('connection', client));
});

webSockets.on('connection', socket => {
  connections++;
  socket.identity = null;
  socket.on('message', (data, isBinary) => {
    if (isBinary || data.length > MAX_MESSAGE) return socket.close(1003);
    let message;
    try { message = JSON.parse(data.toString()); } catch { return socket.close(1007); }
    if (message?.action !== 'announce' || !register(socket, message)) return socket.close(1008);
    stats.announces++;
    if (message.event === 'stopped') {
      removePeer(socket);
      return socket.close(1000);
    }
    send(socket, { action: 'announce', interval: 120 });
    const { infoHash, peerId } = socket.identity;
    const swarm = swarms.get(infoHash);
    const targets = [...swarm.entries()]
      .filter(([candidateId, candidate]) => candidateId !== peerId && candidate.readyState === WebSocket.OPEN)
      .map(([, candidate]) => candidate);
    if (Array.isArray(message.offers) && message.offers.length <= 10 && targets.length) {
      message.offers.forEach((entry, index) => {
        if (!validBinaryId(entry?.offer_id) || !validDescription(entry?.offer, 'offer')) return;
        if (send(targets[index % targets.length], {
          action: 'announce',
          offer: entry.offer,
          offer_id: entry.offer_id,
          peer_id: peerId,
        })) stats.offers++;
      });
    }
    if (validBinaryId(message.offer_id)
      && validBinaryId(message.to_peer_id)
      && validDescription(message.answer, 'answer')) {
      const target = swarm.get(message.to_peer_id);
      if (target && send(target, {
        action: 'announce',
        answer: message.answer,
        offer_id: message.offer_id,
        peer_id: peerId,
      })) stats.answers++;
    }
  });
  socket.on('close', () => {
    removePeer(socket);
    connections = Math.max(0, connections - 1);
  });
  socket.on('error', () => {});
});

server.listen(PORT, HOST);

function shutdown() {
  for (const socket of webSockets.clients) socket.close(1001);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
