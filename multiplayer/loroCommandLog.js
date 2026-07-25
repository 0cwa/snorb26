import initLoro, { LoroDoc } from '../vendor/loro-crdt/index.js';
import { validateCanonicalCommandRecord, validateSemanticCommand } from './semanticCommands.js';

const DB_NAME = 'snorb_multiplayer_v1';
const STORE_NAME = 'loro_logs';
const SCHEMA_VERSION = 1;
const MAX_UPDATE_BYTES = 8 * 1024 * 1024;
const MAX_COMMANDS = 10_000;
export const MAX_LORO_TRANSACTION_COMMANDS = 512;
export const MAX_LORO_COMMANDS = MAX_COMMANDS;
const MAX_RECORD_BYTES = 16 * 1024;
const validationContext = { width: 1_000_000, height: 1_000_000 };

let wasmPromise = null;
let runtimePromise = null;
let currentLogKey = null;
let doc = null;
let commandList = null;
let persistenceEnabled = true;
let persistenceChain = Promise.resolve();
let operationChain = Promise.resolve();
let snapshotByteLength = 0;
let commandIds = new Set();

function ensureWasm() {
  return wasmPromise ||= initLoro();
}

function storageKey(logKey) {
  if (!/^[a-f0-9]{32}$/.test(logKey)) throw new TypeError('Invalid map log key');
  return `map:${logKey}`;
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredBytes(key) {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? new Uint8Array(request.result) : null);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

async function writeStoredBytes(key, bytes) {
  if (!persistenceEnabled) return;
  const copy = bytes.slice().buffer;
  const writePromise = persistenceChain.then(async () => {
    const database = await openDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(copy, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => database.close());
  });
  persistenceChain = writePromise.catch(() => {});
  return writePromise;
}

function parseAndValidateRecords(list) {
  if (list.length > MAX_COMMANDS) throw new RangeError('Loro command history limit exceeded');
  const records = [];
  const ids = new Set();
  for (const value of list.toArray()) {
    const json = String(value);
    if (new TextEncoder().encode(json).byteLength > MAX_RECORD_BYTES) throw new RangeError('Loro command record is too large');
    const record = validateCanonicalCommandRecord(JSON.parse(json));
    validateSemanticCommand(record.command, validationContext);
    if (ids.has(record.commandId)) throw new Error('Duplicate Loro command id');
    ids.add(record.commandId);
    records.push(record);
  }
  return records;
}

function validateDocument(candidate, requiredRecords = []) {
  const value = candidate.toJSON();
  const roots = Object.keys(value).sort();
  if (roots.length !== 2 || roots[0] !== 'commands' || roots[1] !== 'metadata') throw new Error('Unexpected Loro roots');
  if (candidate.getMap('metadata').get('schemaVersion') !== SCHEMA_VERSION) throw new Error('Unsupported Loro schema');
  const list = candidate.getList('commands');
  const records = parseAndValidateRecords(list);
  const recordsById = new Map(records.map(record => [record.commandId, JSON.stringify(record)]));
  for (const record of requiredRecords) {
    if (recordsById.get(record.commandId) !== JSON.stringify(record)) {
      throw new Error('Loro update rewrote existing history');
    }
  }
  return { list, records };
}

function createEmptyDocument() {
  const candidate = new LoroDoc();
  candidate.getMap('metadata').set('schemaVersion', SCHEMA_VERSION);
  candidate.getList('commands');
  candidate.commit();
  return candidate;
}

async function openLog(logKey) {
  const key = storageKey(logKey);
  if (doc && currentLogKey === logKey) return { commandCount: commandList.length, logKey };
  await ensureWasm();
  let candidate = createEmptyDocument();
  const stored = await readStoredBytes(key).catch(error => {
    console.warn('Could not read local Loro history', error);
    persistenceEnabled = false;
    return null;
  });
  if (stored?.byteLength) {
    try {
      if (stored.byteLength > MAX_UPDATE_BYTES) throw new RangeError('Stored Loro history is too large');
      candidate.import(stored);
      validateDocument(candidate);
    } catch (error) {
      console.warn('Ignoring invalid local Loro history', error);
      candidate = createEmptyDocument();
    }
  }
  currentLogKey = logKey;
  doc = candidate;
  commandList = doc.getList('commands');
  const records = parseAndValidateRecords(commandList);
  commandIds = new Set(records.map(record => record.commandId));
  snapshotByteLength = doc.export({ mode: 'snapshot' }).byteLength;
  return { commandCount: commandList.length, logKey };
}

export function initializeLoroCommandLog(logKey = currentLogKey) {
  runtimePromise = operationChain.then(() => openLog(logKey));
  operationChain = runtimePromise.catch(() => {});
  return runtimePromise;
}

export function preflightLoroTransaction(commands, pendingCount = 0, pendingBytes = 0) {
  if (!Array.isArray(commands) || pendingCount + commands.length > MAX_LORO_TRANSACTION_COMMANDS) throw new RangeError('Loro transaction command limit exceeded');
  if ((commandList?.length || 0) + pendingCount + commands.length > MAX_COMMANDS) throw new RangeError('Loro command history limit exceeded');
  let addedBytes = 0;
  const newIds = new Set();
  for (const record of commands) {
    validateCanonicalCommandRecord(record);
    validateSemanticCommand(record.command, validationContext);
    const recordBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    if (recordBytes > MAX_RECORD_BYTES) throw new RangeError('Loro command record is too large');
    if (commandIds.has(record.commandId) || newIds.has(record.commandId)) throw new Error('Duplicate Loro command id');
    newIds.add(record.commandId);
    addedBytes += recordBytes;
  }
  // Loro's operation encoding adds overhead. A conservative 4x reservation
  // ensures a local edit is rejected before authoritative state is changed.
  if (snapshotByteLength + (pendingBytes + addedBytes) * 4 + 4096 > MAX_UPDATE_BYTES) throw new RangeError('Loro history byte limit exceeded');
  return true;
}

export function appendLoroTransaction(commands, logKey = currentLogKey) {
  preflightLoroTransaction(commands);
  const task = operationChain.then(async () => {
    await openLog(logKey);
    preflightLoroTransaction(commands);
    if (commands.length === 0) return doc.export({ mode: 'snapshot' });

    for (const record of commands) commandList.push(JSON.stringify(record));
    doc.commit();
    const bytes = doc.export({ mode: 'snapshot' });
    if (bytes.byteLength > MAX_UPDATE_BYTES) throw new RangeError('Loro history byte limit exceeded');

    for (const record of commands) commandIds.add(record.commandId);
    snapshotByteLength = bytes.byteLength;
    currentLogKey = logKey;
    await writeStoredBytes(storageKey(logKey), bytes).catch(error => {
      console.warn('Could not persist local Loro history', error);
      persistenceEnabled = false;
    });
    return bytes;
  });
  operationChain = task.catch(() => {});
  return task;
}

export async function importLoroUpdate(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Loro update must be Uint8Array');
  if (bytes.byteLength > MAX_UPDATE_BYTES) throw new RangeError('Loro update is too large');

  const task = operationChain.then(async () => {
    const currentRecords = parseAndValidateRecords(commandList);
    const candidate = new LoroDoc();
    candidate.import(doc.export({ mode: 'snapshot' }));
    candidate.import(bytes);
    const validated = validateDocument(candidate, currentRecords);
    const snapshot = candidate.export({ mode: 'snapshot' });
    if (snapshot.byteLength > MAX_UPDATE_BYTES) throw new RangeError('Merged Loro history is too large');

    doc = candidate;
    commandList = validated.list;
    commandIds = new Set(validated.records.map(record => record.commandId));
    snapshotByteLength = snapshot.byteLength;
    await writeStoredBytes(storageKey(currentLogKey), snapshot);
    return validated.records;
  });
  operationChain = task.catch(() => {});
  return task;
}

export async function exportLoroSnapshot() {
  await initializeLoroCommandLog();
  return doc.export({ mode: 'snapshot' });
}

export async function getLoggedCommands() {
  await initializeLoroCommandLog();
  return parseAndValidateRecords(commandList);
}

export function getLoroLogStatus() {
  return {
    initialized: Boolean(doc),
    logKey: currentLogKey,
    commandCount: commandList?.length || 0,
    persistenceEnabled,
  };
}
