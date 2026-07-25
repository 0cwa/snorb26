const MAGIC = 0x534e5242; // SNRB
export const PROTOCOL_VERSION = 1;
export const HEADER_BYTES = 24;
export const MAX_RELIABLE_PAYLOAD = 256 * 1024;
export const MAX_TRANSIENT_PAYLOAD = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const MessageKind = Object.freeze({
  HELLO: 1, PRESENCE: 2, LORO_SYNC: 3, LORO_UPDATE: 4,
  SIM_SNAPSHOT: 5, COMMAND_REQUEST: 6, COMMAND_RESULT: 7,
  ERROR: 8, PING: 9, PONG: 10,
});
const validKinds = new Set(Object.values(MessageKind));

export function encodeFrame({ kind, roomId, hostEpoch = 0, sequence = 0, flags = 0, payload = new Uint8Array() }) {
  if (!validKinds.has(kind)) throw new TypeError('Unknown protocol kind');
  const room = encoder.encode(String(roomId || ''));
  if (!room.length || room.length > 128) throw new RangeError('Invalid room id');
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const limit = kind === MessageKind.SIM_SNAPSHOT ? MAX_TRANSIENT_PAYLOAD : MAX_RELIABLE_PAYLOAD;
  if (body.length > limit) throw new RangeError('Protocol payload too large');
  if (!Number.isSafeInteger(hostEpoch) || hostEpoch < 0 || !Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('Invalid frame sequence');
  const bytes = new Uint8Array(HEADER_BYTES + room.length + body.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC); view.setUint8(4, PROTOCOL_VERSION); view.setUint8(5, kind);
  view.setUint16(6, flags); view.setUint32(8, hostEpoch); view.setUint32(12, sequence);
  view.setUint16(16, room.length); view.setUint16(18, 0); view.setUint32(20, body.length);
  bytes.set(room, HEADER_BYTES); bytes.set(body, HEADER_BYTES + room.length);
  return bytes;
}

export function decodeFrame(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_BYTES) throw new RangeError('Truncated protocol frame');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MAGIC || view.getUint8(4) !== PROTOCOL_VERSION) throw new Error('Unsupported protocol frame');
  const kind = view.getUint8(5);
  if (!validKinds.has(kind)) throw new Error('Unknown protocol kind');
  const roomLength = view.getUint16(16), payloadLength = view.getUint32(20);
  const expected = HEADER_BYTES + roomLength + payloadLength;
  if (!roomLength || roomLength > 128 || expected !== bytes.length) throw new RangeError('Protocol frame length mismatch');
  const limit = kind === MessageKind.SIM_SNAPSHOT ? MAX_TRANSIENT_PAYLOAD : MAX_RELIABLE_PAYLOAD;
  if (payloadLength > limit) throw new RangeError('Protocol payload too large');
  return {
    v: PROTOCOL_VERSION, kind, flags: view.getUint16(6), hostEpoch: view.getUint32(8), sequence: view.getUint32(12),
    roomId: decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + roomLength)),
    payload: bytes.slice(HEADER_BYTES + roomLength),
  };
}

export function encodeJsonPayload(value, maxBytes = 16 * 1024) {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > maxBytes) throw new RangeError('JSON payload too large');
  return bytes;
}
export function decodeJsonPayload(bytes, maxBytes = 16 * 1024) {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) throw new RangeError('JSON payload too large');
  return JSON.parse(decoder.decode(bytes));
}
