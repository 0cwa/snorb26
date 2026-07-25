import {
  GRID_H, GRID_W, SHARED_SIMULATION_STATE_KEYS, appState, buildingAt,
  cubes, customBuildingRegistry, durableBuildingIds, elevations, extrusions,
  lemmings, mapSettings, resizeMapState,
} from '../state.js';

const MAGIC = 0x534e4150; // SNAP
const VERSION = 1;
const FIXED_HEADER = 28;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_MAP_DIMENSION = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function captureSimulationSnapshot({ hostEpoch = 1, sequence = 1, durableSequence = 0 } = {}) {
  const simulation = {};
  for (const key of SHARED_SIMULATION_STATE_KEYS) simulation[key] = appState[key];
  return {
    hostEpoch, sequence, durableSequence, width: GRID_W, height: GRID_H,
    gameTime: appState.gameTime,
    waterLevel: mapSettings.waterLevel,
    simulation,
    elevations: elevations.slice(),
    buildingAt: buildingAt.slice(),
    durableBuildingIds: [...durableBuildingIds],
    customBuildingRegistry: structuredClone(customBuildingRegistry),
    cubes: structuredClone(cubes),
    extrusions: structuredClone(extrusions),
    lemmings: structuredClone(lemmings),
  };
}

function validateMetadata(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid snapshot metadata');
  for (const key of ['hostEpoch', 'sequence', 'durableSequence', 'width', 'height']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new RangeError(`Invalid snapshot ${key}`);
  }
  if (value.width < 16 || value.height < 16 || value.width > MAX_MAP_DIMENSION || value.height > MAX_MAP_DIMENSION) throw new RangeError('Snapshot dimensions out of range');
  if (!Number.isFinite(value.gameTime) || !Number.isInteger(value.waterLevel) || value.waterLevel < 0 || value.waterLevel > 255) throw new RangeError('Invalid snapshot world settings');
  if (!Array.isArray(value.cubes) || value.cubes.length > 2048 || !Array.isArray(value.extrusions) || value.extrusions.length > 1024 || !Array.isArray(value.lemmings) || value.lemmings.length > 4096) throw new RangeError('Snapshot entity limit exceeded');
  if (!Array.isArray(value.customBuildingRegistry) || value.customBuildingRegistry.length > 251 || !Array.isArray(value.durableBuildingIds) || value.durableBuildingIds.length > value.width * value.height) throw new RangeError('Snapshot registry limit exceeded');
  for (const url of value.customBuildingRegistry) if (url != null && (typeof url !== 'string' || url.length > 2048)) throw new RangeError('Invalid snapshot texture URL');
  return value;
}

export function encodeSimulationSnapshot(snapshot) {
  if (!(snapshot.elevations instanceof Uint8Array) || !(snapshot.buildingAt instanceof Uint8Array)) throw new TypeError('Snapshot grids must be Uint8Array');
  const metadata = validateMetadata({ ...snapshot, elevations: undefined, buildingAt: undefined });
  const cells = metadata.width * metadata.height;
  if (snapshot.elevations.length !== cells || snapshot.buildingAt.length !== cells) throw new RangeError('Snapshot grid length mismatch');
  const json = encoder.encode(JSON.stringify(metadata));
  const total = FIXED_HEADER + json.length + cells * 2;
  if (total > MAX_SNAPSHOT_BYTES) throw new RangeError('Snapshot too large');
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC); view.setUint16(4, VERSION); view.setUint16(6, 0);
  view.setUint32(8, metadata.hostEpoch); view.setUint32(12, metadata.sequence);
  view.setUint32(16, metadata.durableSequence); view.setUint32(20, json.length);
  view.setUint32(24, cells);
  bytes.set(json, FIXED_HEADER);
  bytes.set(snapshot.elevations, FIXED_HEADER + json.length);
  bytes.set(snapshot.buildingAt, FIXED_HEADER + json.length + cells);
  return bytes;
}

export function decodeSimulationSnapshot(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < FIXED_HEADER || bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new RangeError('Invalid snapshot size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MAGIC || view.getUint16(4) !== VERSION) throw new Error('Unsupported snapshot');
  const hostEpoch = view.getUint32(8), sequence = view.getUint32(12), durableSequence = view.getUint32(16);
  const jsonLength = view.getUint32(20), cells = view.getUint32(24);
  if (FIXED_HEADER + jsonLength + cells * 2 !== bytes.byteLength) throw new RangeError('Snapshot length mismatch');
  const metadata = validateMetadata(JSON.parse(decoder.decode(bytes.subarray(FIXED_HEADER, FIXED_HEADER + jsonLength))));
  if (metadata.hostEpoch !== hostEpoch || metadata.sequence !== sequence || metadata.durableSequence !== durableSequence || metadata.width * metadata.height !== cells) throw new Error('Snapshot header mismatch');
  const gridOffset = FIXED_HEADER + jsonLength;
  return {
    ...metadata,
    elevations: bytes.slice(gridOffset, gridOffset + cells),
    buildingAt: bytes.slice(gridOffset + cells),
  };
}

export function applySimulationSnapshot(snapshot) {
  validateMetadata(snapshot);
  const cells = snapshot.width * snapshot.height;
  if (!(snapshot.elevations instanceof Uint8Array) || snapshot.elevations.length !== cells || !(snapshot.buildingAt instanceof Uint8Array) || snapshot.buildingAt.length !== cells) throw new RangeError('Invalid snapshot grids');
  if (GRID_W !== snapshot.width || GRID_H !== snapshot.height) resizeMapState(snapshot.width, snapshot.height, { resetLocalState: false });
  elevations.set(snapshot.elevations); buildingAt.set(snapshot.buildingAt);
  customBuildingRegistry.length = 0; customBuildingRegistry.push(...structuredClone(snapshot.customBuildingRegistry));
  cubes.length = 0; cubes.push(...structuredClone(snapshot.cubes));
  extrusions.length = 0; extrusions.push(...structuredClone(snapshot.extrusions));
  lemmings.length = 0; lemmings.push(...structuredClone(snapshot.lemmings));
  durableBuildingIds.clear();
  for (const [cell, id] of snapshot.durableBuildingIds) if (Number.isInteger(cell) && cell >= 0 && cell < cells && typeof id === 'string' && id.length <= 96) durableBuildingIds.set(cell, id);
  mapSettings.waterLevel = snapshot.waterLevel;
  for (const key of SHARED_SIMULATION_STATE_KEYS) if (Object.hasOwn(snapshot.simulation, key)) appState[key] = snapshot.simulation[key];
  appState.gameTime = snapshot.gameTime;
}
