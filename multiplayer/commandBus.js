import {
  BUILD_SPRITES,
  GRID_H,
  GRID_W,
  buildingAt,
  customBuildingRegistry,
  durableBuildingIds,
  elevations,
  mapId,
} from '../state.js';
import { AuthorityRole, getAuthorityRole } from '../authority.js';
import {
  appendLoroTransaction,
  initializeLoroCommandLog,
  preflightLoroTransaction,
} from './loroCommandLog.js';
import { baselineBuildingId, randomId } from './ids.js';
import { applySemanticCommandsAtomically, validateSemanticCommand } from './semanticCommands.js';

const actorId = randomId('actor');
const buildingsById = new Map();
const buildingIdsByCell = new Map();
let activeTransaction = null;
let guestRequestHandler = null;
let acceptedSequence = 0;
let readyLogKey = null;

function context() {
  return {
    width: GRID_W,
    height: GRID_H,
    elevations,
    buildingAt,
    buildingsById,
    buildingIdsByCell,
    customBuildingRegistry,
    durableBuildingIds,
    builtInBuildingTypes: BUILD_SPRITES,
  };
}

function canonicalRecord(command) {
  return Object.freeze({
    v: 1,
    commandId: randomId('command'),
    actorId,
    sequence: ++acceptedSequence,
    command,
  });
}

function appendRecords(records, logKey = mapId) {
  if (!records.length) return;
  appendLoroTransaction(records, logKey).catch(error => console.error('Failed to append Loro transaction', error));
}

export function initializeCommandBus() {
  // Flush any completed samples to the old map's captured log before switching.
  commitSemanticTransaction();
  rebuildBuildingIdIndex();
  const openingKey = mapId;
  readyLogKey = null;
  return initializeLoroCommandLog(openingKey).then(result => {
    if (mapId === openingKey) readyLogKey = openingKey;
    return result;
  });
}

export function rebuildBuildingIdIndex() {
  buildingsById.clear();
  buildingIdsByCell.clear();
  const previousIds = new Map(durableBuildingIds);
  durableBuildingIds.clear();
  for (let cell = 0; cell < buildingAt.length; cell++) {
    const buildingType = buildingAt[cell];
    if (!buildingType) continue;
    const x = cell % GRID_W;
    const y = Math.floor(cell / GRID_W);
    const preferredId = previousIds.get(cell) || baselineBuildingId(x, y, buildingType);
    let id = preferredId;
    if (buildingsById.has(id)) id = `${preferredId}-${cell}`;
    durableBuildingIds.set(cell, id);
    buildingsById.set(id, { x, y, buildingType });
    buildingIdsByCell.set(cell, id);
  }
}

export function beginSemanticTransaction(label = 'edit') {
  if (activeTransaction) throw new Error('A semantic transaction is already active');
  activeTransaction = { label, logKey: mapId, records: [] };
}

export function commitSemanticTransaction() {
  if (!activeTransaction) return 0;
  const { records, logKey } = activeTransaction;
  activeTransaction = null;
  appendRecords(records, logKey);
  return records.length;
}

export function cancelSemanticTransaction() {
  // Commands are already authoritative locally; cancellation only closes the
  // grouping boundary and still records what was applied.
  return commitSemanticTransaction();
}

export function setGuestRequestHandler(handler) {
  guestRequestHandler = typeof handler === 'function' ? handler : null;
}

export function submitSemanticCommand(input) {
  const command = validateSemanticCommand(input, context());
  if (getAuthorityRole() === AuthorityRole.GUEST) {
    const requestId = randomId('request');
    guestRequestHandler?.({ requestId, command });
    return { applied: false, pending: true, requestId, command };
  }
  if (readyLogKey !== mapId) {
    return { applied: false, pending: true, reason: 'history-initializing', command };
  }

  const record = canonicalRecord(command);
  const prospectiveRecords = activeTransaction ? [...activeTransaction.records, record] : [record];
  preflightLoroTransaction(prospectiveRecords);
  const dirty = applySemanticCommandsAtomically([command], context());
  if (activeTransaction) activeTransaction.records.push(record);
  else appendRecords([record], mapId);
  return { applied: true, pending: false, command, record, dirty };
}

export function submitSemanticCommands(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) return { applied: true, results: [] };
  const commands = inputs.map(input => validateSemanticCommand(input, context()));
  if (getAuthorityRole() === AuthorityRole.GUEST) {
    const requests = commands.map(command => {
      const requestId = randomId('request');
      guestRequestHandler?.({ requestId, command });
      return { requestId, command };
    });
    return { applied: false, pending: true, requests };
  }
  if (readyLogKey !== mapId) {
    return { applied: false, pending: true, reason: 'history-initializing', commands };
  }

  const records = commands.map(command => canonicalRecord(command));
  const prospectiveRecords = activeTransaction ? [...activeTransaction.records, ...records] : records;
  preflightLoroTransaction(prospectiveRecords);
  const dirty = applySemanticCommandsAtomically(commands, context());
  const results = commands.map((command, index) => ({ applied: true, command, record: records[index], dirty }));
  if (activeTransaction) activeTransaction.records.push(...records);
  else appendRecords(records, mapId);
  return { applied: true, pending: false, results };
}

export function applyAcceptedSemanticCommand(input) {
  const command = validateSemanticCommand(input, context());
  return applySemanticCommandsAtomically([command], context());
}

export function getBuildingIdAt(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
  const cell = y * GRID_W + x;
  let id = buildingIdsByCell.get(cell);
  const buildingType = buildingAt[cell];
  if (!buildingType) return null;
  if (!id) {
    id = baselineBuildingId(x, y, buildingType);
    buildingIdsByCell.set(cell, id);
    durableBuildingIds.set(cell, id);
    buildingsById.set(id, { x, y, buildingType });
  }
  return id;
}

export function customBuildingType(registryIndex) {
  return BUILD_SPRITES + 1 + registryIndex;
}

export function getCommandBusStatus() {
  return {
    actorId,
    acceptedSequence,
    transactionActive: Boolean(activeTransaction),
    indexedBuildings: buildingsById.size,
    historyReady: readyLogKey === mapId,
  };
}
