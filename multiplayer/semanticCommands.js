const MAX_RADIUS = 64;
const MAX_ID_LENGTH = 96;
const MAX_TEXTURE_URL_LENGTH = 2048;
const ALLOWED_TYPES = new Set([
  'terrain.raise',
  'terrain.smooth',
  'terrain.level',
  'building.place',
  'building.remove',
]);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isInteger(value);

function exactKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.has(key));
}

function pointInMap(x, y, context) {
  return integer(x) && integer(y) && x >= 0 && y >= 0 && x < context.width && y < context.height;
}

export function validateSemanticCommand(input, context) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Command must be an object');
  if (!ALLOWED_TYPES.has(input.type)) throw new TypeError(`Unsupported semantic command: ${input.type}`);
  if (!context || !integer(context.width) || !integer(context.height)) throw new TypeError('Invalid map context');

  if (input.type === 'terrain.raise') {
    if (!exactKeys(input, new Set(['type', 'x', 'y', 'radius', 'delta']))) throw new TypeError('Unexpected terrain.raise field');
    if (!pointInMap(input.x, input.y, context)) throw new RangeError('Terrain center is outside the map');
    if (!integer(input.radius) || input.radius < 1 || input.radius > MAX_RADIUS) throw new RangeError('Invalid terrain radius');
    if (!finite(input.delta) || input.delta === 0 || Math.abs(input.delta) > 255) throw new RangeError('Invalid terrain delta');
  } else if (input.type === 'terrain.smooth') {
    if (!exactKeys(input, new Set(['type', 'x', 'y', 'radius', 'strength']))) throw new TypeError('Unexpected terrain.smooth field');
    if (!pointInMap(input.x, input.y, context)) throw new RangeError('Terrain center is outside the map');
    if (!integer(input.radius) || input.radius < 1 || input.radius > MAX_RADIUS) throw new RangeError('Invalid terrain radius');
    if (!finite(input.strength) || input.strength < 0 || input.strength > 1) throw new RangeError('Invalid smoothing strength');
  } else if (input.type === 'terrain.level') {
    if (!exactKeys(input, new Set(['type', 'x0', 'y0', 'x1', 'y1', 'elevation']))) throw new TypeError('Unexpected terrain.level field');
    if (!pointInMap(input.x0, input.y0, context) || !pointInMap(input.x1, input.y1, context)) throw new RangeError('Level bounds are outside the map');
    if (!integer(input.elevation) || input.elevation < 0 || input.elevation > 255) throw new RangeError('Invalid elevation');
  } else if (input.type === 'building.place') {
    if (!exactKeys(input, new Set(['type', 'x', 'y', 'buildingType', 'id', 'textureUrl']))) throw new TypeError('Unexpected building.place field');
    if (!pointInMap(input.x, input.y, context)) throw new RangeError('Building is outside the map');
    if (!integer(input.buildingType) || input.buildingType < 1 || input.buildingType > 255) throw new RangeError('Invalid building type');
    if (typeof input.id !== 'string' || input.id.length < 1 || input.id.length > MAX_ID_LENGTH) throw new RangeError('Invalid building id');
    const builtInTypes = context.builtInBuildingTypes ?? 4;
    if (input.textureUrl === undefined) {
      if (input.buildingType > builtInTypes) throw new RangeError('Custom building requires a texture URL');
    } else {
      if (typeof input.textureUrl !== 'string' || input.textureUrl.length < 1 || input.textureUrl.length > MAX_TEXTURE_URL_LENGTH) throw new RangeError('Invalid texture URL');
      const url = new URL(input.textureUrl, globalThis.location?.href || 'https://localhost/');
      if (!['https:', 'http:'].includes(url.protocol)) throw new RangeError('Unsupported texture URL');
      if (input.buildingType <= builtInTypes) throw new RangeError('Built-in building cannot specify a texture URL');
    }
  } else {
    if (!exactKeys(input, new Set(['type', 'id']))) throw new TypeError('Unexpected building.remove field');
    if (typeof input.id !== 'string' || input.id.length < 1 || input.id.length > MAX_ID_LENGTH) throw new RangeError('Invalid building id');
  }

  return Object.freeze({ ...input });
}

const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));

export function applySemanticCommand(command, context) {
  const dirty = { terrain: false, buildings: false, customTextureUrl: null };

  if (command.type === 'terrain.raise') {
    const radius = command.radius;
    for (let y = Math.max(0, command.y - radius); y <= Math.min(context.height - 1, command.y + radius); y++) {
      for (let x = Math.max(0, command.x - radius); x <= Math.min(context.width - 1, command.x + radius); x++) {
        const distance = Math.hypot(x - command.x, y - command.y);
        if (distance > radius) continue;
        const weight = Math.max(0.15, 1 - distance / (radius + 0.0001));
        const amount = Math.sign(command.delta) * Math.max(1, Math.round(Math.abs(command.delta) * weight));
        const index = y * context.width + x;
        context.elevations[index] = clampByte(context.elevations[index] + amount);
      }
    }
    dirty.terrain = true;
  } else if (command.type === 'terrain.smooth') {
    const values = new Map();
    for (let y = Math.max(0, command.y - command.radius); y <= Math.min(context.height - 1, command.y + command.radius); y++) {
      for (let x = Math.max(0, command.x - command.radius); x <= Math.min(context.width - 1, command.x + command.radius); x++) {
        if (Math.hypot(x - command.x, y - command.y) > command.radius) continue;
        let sum = 0;
        let count = 0;
        for (const [ox, oy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const sx = x + ox;
          const sy = y + oy;
          if (sx >= 0 && sy >= 0 && sx < context.width && sy < context.height) {
            sum += context.elevations[sy * context.width + sx];
            count++;
          }
        }
        const index = y * context.width + x;
        const average = count ? sum / count : context.elevations[index];
        values.set(index, clampByte(context.elevations[index] * (1 - command.strength) + average * command.strength));
      }
    }
    for (const [index, value] of values) context.elevations[index] = value;
    dirty.terrain = true;
  } else if (command.type === 'terrain.level') {
    const minX = Math.min(command.x0, command.x1);
    const maxX = Math.max(command.x0, command.x1);
    const minY = Math.min(command.y0, command.y1);
    const maxY = Math.max(command.y0, command.y1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      context.elevations[y * context.width + x] = command.elevation;
    }
    dirty.terrain = true;
  } else if (command.type === 'building.place') {
    if (command.textureUrl) {
      let registryIndex = context.customBuildingRegistry.indexOf(command.textureUrl);
      if (registryIndex === -1) registryIndex = context.customBuildingRegistry.length;
      const expectedType = context.builtInBuildingTypes + 1 + registryIndex;
      if (command.buildingType !== expectedType || expectedType > 255) {
        throw new RangeError('Custom building type does not match registry');
      }
      if (registryIndex === context.customBuildingRegistry.length) {
        context.customBuildingRegistry.push(command.textureUrl);
      }
    }
    const existing = context.buildingsById.get(command.id);
    if (existing && (existing.x !== command.x || existing.y !== command.y)) throw new Error('Building id already exists');
    const cell = command.y * context.width + command.x;
    const replacedId = context.buildingIdsByCell.get(cell);
    if (replacedId && replacedId !== command.id) context.buildingsById.delete(replacedId);
    context.buildingAt[cell] = command.buildingType;
    context.buildingsById.set(command.id, { x: command.x, y: command.y, buildingType: command.buildingType });
    context.buildingIdsByCell.set(cell, command.id);
    context.durableBuildingIds.set(cell, command.id);
    dirty.buildings = true;
    dirty.customTextureUrl = command.textureUrl || null;
  } else if (command.type === 'building.remove') {
    const building = context.buildingsById.get(command.id);
    if (building) {
      const cell = building.y * context.width + building.x;
      context.buildingAt[cell] = 0;
      context.buildingsById.delete(command.id);
      context.buildingIdsByCell.delete(cell);
      context.durableBuildingIds.delete(cell);
      dirty.buildings = true;
    }
  }

  return dirty;
}

export function applySemanticCommandsAtomically(commands, context) {
  const preview = {
    ...context,
    elevations: context.elevations.slice(),
    buildingAt: context.buildingAt.slice(),
    buildingsById: new Map(context.buildingsById),
    buildingIdsByCell: new Map(context.buildingIdsByCell),
    durableBuildingIds: new Map(context.durableBuildingIds),
    customBuildingRegistry: [...context.customBuildingRegistry],
  };
  const dirty = { terrain: false, buildings: false, customTextureUrls: [] };
  for (const command of commands) {
    const result = applySemanticCommand(command, preview);
    dirty.terrain ||= result.terrain;
    dirty.buildings ||= result.buildings;
    if (result.customTextureUrl) dirty.customTextureUrls.push(result.customTextureUrl);
  }

  context.elevations.set(preview.elevations);
  context.buildingAt.set(preview.buildingAt);
  context.buildingsById.clear();
  for (const [key, value] of preview.buildingsById) context.buildingsById.set(key, value);
  context.buildingIdsByCell.clear();
  for (const [key, value] of preview.buildingIdsByCell) context.buildingIdsByCell.set(key, value);
  context.durableBuildingIds.clear();
  for (const [key, value] of preview.durableBuildingIds) context.durableBuildingIds.set(key, value);
  context.customBuildingRegistry.length = 0;
  context.customBuildingRegistry.push(...preview.customBuildingRegistry);
  return dirty;
}

export function validateCanonicalCommandRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid command record');
  const keys = new Set(['v', 'commandId', 'actorId', 'sequence', 'command']);
  if (!exactKeys(value, keys) || value.v !== 1) throw new TypeError('Invalid command record envelope');
  if (typeof value.commandId !== 'string' || value.commandId.length < 1 || value.commandId.length > MAX_ID_LENGTH) throw new RangeError('Invalid command record id');
  if (typeof value.actorId !== 'string' || value.actorId.length < 1 || value.actorId.length > MAX_ID_LENGTH) throw new RangeError('Invalid actor id');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) throw new RangeError('Invalid command sequence');
  // Envelope-level validation forbids arrays and known state payload keys. Map
  // coordinate validation is repeated by the reducer against the active map.
  const forbidden = new Set(['elevations', 'buildingAt', 'lemmings', 'camera', 'workerState', 'snapshot']);
  for (const key of Object.keys(value.command || {})) if (forbidden.has(key)) throw new TypeError(`Forbidden command field: ${key}`);
  if (!ALLOWED_TYPES.has(value.command?.type)) throw new TypeError('Invalid command type');
  return value;
}

export const SEMANTIC_COMMAND_TYPES = Object.freeze([...ALLOWED_TYPES]);
