import { AuthorityRole, getAuthorityRole } from '../authority.js';
import { GRID_H, GRID_W, appState } from '../state.js';
import { cleaveLemmingAt, placeLemmingAt } from '../lemmingTools.js';
import { randomId } from './ids.js';

let guestRequestHandler = null;

function hasOnlyKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

function coordinate(value, maximum, name) {
  if (!Number.isInteger(value) || value < 0 || value >= maximum) throw new RangeError(`Invalid ${name}`);
  return value;
}

// Runtime actions are intentionally transient: the host reduces them and
// simulation snapshots distribute the result. Durable map edits use Loro.
export function validateRuntimeAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string') throw new TypeError('Invalid runtime action');
  if (input.type === 'simulation.setPlaying') {
    if (!hasOnlyKeys(input, ['type', 'isPlaying']) || typeof input.isPlaying !== 'boolean') throw new TypeError('Invalid playing action');
    return { type: input.type, isPlaying: input.isPlaying };
  }
  if (input.type === 'simulation.setSpeed') {
    if (!hasOnlyKeys(input, ['type', 'gameSpeed']) || !Number.isFinite(input.gameSpeed) || input.gameSpeed < 0.1 || input.gameSpeed > 5) throw new RangeError('Invalid game speed');
    return { type: input.type, gameSpeed: input.gameSpeed };
  }
  if (input.type === 'lemming.plop' || input.type === 'lemming.cleave') {
    if (!hasOnlyKeys(input, ['type', 'x', 'y'])) throw new TypeError('Invalid lemming action');
    return { type: input.type, x: coordinate(input.x, GRID_W, 'x'), y: coordinate(input.y, GRID_H, 'y') };
  }
  throw new TypeError('Unknown runtime action');
}

export function applyRuntimeAction(input) {
  const action = validateRuntimeAction(input);
  if (action.type === 'simulation.setPlaying') appState.isPlaying = action.isPlaying;
  else if (action.type === 'simulation.setSpeed') appState.gameSpeed = action.gameSpeed;
  else if (action.type === 'lemming.plop') placeLemmingAt(action.x, action.y);
  else cleaveLemmingAt(action.x, action.y);
  return action;
}

export function setGuestRuntimeActionHandler(handler) {
  guestRequestHandler = typeof handler === 'function' ? handler : null;
}

export function submitRuntimeAction(input) {
  const action = validateRuntimeAction(input);
  if (getAuthorityRole() === AuthorityRole.GUEST) {
    const requestId = randomId('request');
    guestRequestHandler?.({ requestId, action });
    return { applied: false, pending: true, requestId, action };
  }
  return { applied: true, pending: false, action: applyRuntimeAction(action) };
}
