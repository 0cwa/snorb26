import { appState, brush, camera, clamp } from './state.js';

// Camera and UI preferences are intentionally stored separately from map data.
// They are never valid multiplayer/shared-map input.
export const LOCAL_PREFERENCES_STORAGE_KEY = 'snorb_local_preferences_v1';
export const LOCAL_PREFERENCES_VERSION = 1;

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;

export function captureLocalPreferences() {
  return {
    version: LOCAL_PREFERENCES_VERSION,
    camera: {
      panX: camera.targetPanX,
      panY: camera.targetPanY,
      zoom: camera.targetZoom,
      tilt: camera.targetTilt,
      rotation: camera.targetRotation,
    },
    brush: { radius: brush.radius, smooth: brush.smooth },
    view: {
      showGrid: appState.showGrid,
      showUnderground: appState.showUnderground,
      eventNotifications: appState.eventNotifications,
    },
  };
}

export function applyLocalPreferences(value) {
  if (!value || typeof value !== 'object') return false;

  const savedCamera = value.camera || {};
  const panX = finite(savedCamera.panX, camera.targetPanX);
  const panY = finite(savedCamera.panY, camera.targetPanY);
  const zoom = clamp(finite(savedCamera.zoom, camera.targetZoom), camera.minZoom, camera.maxZoom);
  const tilt = clamp(finite(savedCamera.tilt, camera.targetTilt), camera.minTilt, camera.maxTilt);
  const rotation = finite(savedCamera.rotation, camera.targetRotation);
  camera.panX = camera.targetPanX = panX;
  camera.panY = camera.targetPanY = panY;
  camera.zoom = camera.targetZoom = zoom;
  camera.tilt = camera.targetTilt = tilt;
  camera.rotation = camera.targetRotation = rotation;

  const savedBrush = value.brush || {};
  brush.radius = Math.max(1, Math.min(64, Math.round(finite(savedBrush.radius, brush.radius))));
  brush.smooth = clamp(finite(savedBrush.smooth, brush.smooth), 0, 1);

  const view = value.view || {};
  appState.showGrid = boolean(view.showGrid, appState.showGrid);
  appState.showUnderground = boolean(view.showUnderground, appState.showUnderground);
  appState.eventNotifications = boolean(view.eventNotifications, appState.eventNotifications);

  if (typeof document !== 'undefined') {
    const radius = document.getElementById('brushSize');
    const smooth = document.getElementById('brushSmooth');
    if (radius) radius.value = brush.radius;
    if (smooth) smooth.value = brush.smooth;
  }
  return true;
}

export function encodeLocalPreferences(value = captureLocalPreferences()) {
  return JSON.stringify(value);
}

export function decodeLocalPreferences(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text);
    return value && value.version === LOCAL_PREFERENCES_VERSION ? value : null;
  } catch {
    return null;
  }
}

function legacyBlock(text, name) {
  const match = new RegExp(`${name}\\s*\\{([^}]*)\\}`).exec(text || '');
  if (!match) return {};
  const result = {};
  for (const segment of match[1].split(';')) {
    const colon = segment.indexOf(':');
    if (colon < 0) continue;
    const key = segment.slice(0, colon).replace(/\/\/.*$/gm, '').trim();
    const value = segment.slice(colon + 1).replace(/\/\/.*$/gm, '').trim();
    if (key) result[key] = value;
  }
  return result;
}

// Used only for one-time migration of this browser's v2 localStorage save.
// Never call this for an uploaded or network-provided map.
export function extractLegacyLocalPreferences(text) {
  const savedCamera = legacyBlock(text, 'camera');
  const savedBrush = legacyBlock(text, 'brush');
  const savedMap = legacyBlock(text, 'map');
  if (!Object.keys(savedCamera).length && !Object.keys(savedBrush).length) return null;

  return {
    version: LOCAL_PREFERENCES_VERSION,
    camera: {
      panX: finite(savedCamera.panX, camera.targetPanX),
      panY: finite(savedCamera.panY, camera.targetPanY),
      zoom: finite(savedCamera.zoom, camera.targetZoom),
      tilt: finite(savedCamera.tilt, camera.targetTilt),
      rotation: finite(savedCamera.rotation, camera.targetRotation),
    },
    brush: {
      radius: finite(savedBrush.radius, brush.radius),
      smooth: finite(savedBrush.smooth, brush.smooth),
    },
    view: {
      showGrid: savedMap.showGrid === 'true',
      showUnderground: savedMap.showUnderground === 'true',
      eventNotifications: savedMap.eventNotifications !== 'false',
    },
  };
}
