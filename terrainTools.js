import {
  GRID_W,
  GRID_H,
  clamp,
  elevations,
  brush,
  levelSel,
} from './state.js';
import {
  uploadElevations,
} from './renderer.js';
import { saveMapToLocal } from './storage.js';
import { submitSemanticCommand } from './multiplayer/commandBus.js';

// Brush stamps can arrive many times per second. Keep rendering responsive, but
// defer worker sync and persistence until the user pauses (or pointer-up saves
// the map immediately in main.js).
const TERRAIN_SAVE_IDLE_MS = 750;
let terrainSaveTimer = null;

function scheduleTerrainSave() {
  if (terrainSaveTimer) clearTimeout(terrainSaveTimer);
  terrainSaveTimer = setTimeout(() => {
    terrainSaveTimer = null;
    saveMapToLocal();
  }, TERRAIN_SAVE_IDLE_MS);
}

export function flushTerrainSave() {
  if (!terrainSaveTimer) return false;
  clearTimeout(terrainSaveTimer);
  terrainSaveTimer = null;
  saveMapToLocal();
  return true;
}

export function seedDemo(config = null) {
  // Keep terrain feature density constant per tile. A larger map therefore
  // contains more landscape detail rather than a stretched 256-tile sample.

  // Default to the original island look if no config is provided
  const cfg = config || { canyons: 0, islands: 80, valleys: 0, beaches: 0, deserts: 0, mountains: 0, erosion: 0 };

  const c_canyon = cfg.canyons / 100;
  const c_island = cfg.islands / 100;
  const c_valley = cfg.valleys / 100;
  const c_beach = cfg.beaches / 100;
  const c_desert = cfg.deserts / 100;
  const c_mountain = cfg.mountains / 100;
  const c_erosion = cfg.erosion / 100;

  // Random offsets ensure a unique map every time
  const ox = Math.random() * 10000;
  const oy = Math.random() * 10000;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const nx = x + ox;
      const ny = y + oy;

      // Base island falloff (distance from center)
      const r = Math.hypot((x - GRID_W * 0.5) / GRID_W, (y - GRID_H * 0.5) / GRID_H);
      const islandFactor = c_island > 0 ? 1.0 - (r * (3.0 - c_island * 1.5)) : 1.0;
      let h = c_island > 0 ? Math.max(0, islandFactor) * 120 : 86;

      // Noise layers for structural variety
      const nLow = (Math.sin(nx * 0.03) * Math.cos(ny * 0.02) + Math.sin((nx + ny) * 0.015)) * 0.5;
      const nMid = (Math.sin(nx * 0.09) * Math.cos(ny * 0.07) + Math.sin((nx - ny) * 0.05)) * 0.5;
      const nHigh = (Math.sin(nx * 0.2) * Math.cos(ny * 0.15)) * 0.5;

      // Mountains (High amplitude, low frequency)
      h += Math.max(0, nLow) * c_mountain * 200;
      h += nMid * c_mountain * 50;

      // Valleys (Carve out low-frequency trenches)
      h -= Math.max(0, nLow) * c_valley * 100;

      // Canyons (Sharp inverted ridges)
      const canyonRidge = Math.abs(nMid);
      if (c_canyon > 0 && canyonRidge < 0.15) {
        h -= (0.15 - canyonRidge) * 10 * c_canyon * 120;
      }

      // Deserts (High frequency dunes)
      if (c_desert > 0) {
         h += nHigh * c_desert * 25;
      }

      // Beaches (Flatten out terrain near the water line)
      if (c_beach > 0) {
         const distToWater = Math.abs(h - 86);
         if (distToWater < 30 * c_beach) {
             h = 86 + (Math.sign(h - 86) * distToWater * (1.0 - c_beach));
         }
      }

      // Erosion (Finer detail, following contours via domain warping)
      if (c_erosion > 0 && h > 86) {
         const altitudeFactor = (h - 86) / 100;

         // Warp the coordinates using the underlying mountain noise to make gullies curve with the terrain
         const wx = nx + (nMid * 25);
         const wy = ny + (nLow * 25);

         // Sample a higher frequency noise for finer grained detail
         const nFine = Math.sin(wx * 0.55) * Math.cos(wy * 0.55);

         // Create sharp, narrow crevices by squaring the inverted absolute noise
         const gully = 1.0 - Math.abs(nFine);

         // Subtract the gully depth, scaling by altitude and erosion slider
         h -= (gully * gully) * altitudeFactor * c_erosion * 65;
      }

      // Base surface texture (From original)
      h += (nMid + 1) * 18;

      elevations[y * GRID_W + x] = clamp(Math.floor(h), 0, 255);
    }
  }
}

export function brushApplyDelta(cx, cy, delta) {
  const result = submitSemanticCommand({
    type: 'terrain.raise',
    x: cx,
    y: cy,
    radius: Math.max(1, brush.radius | 0),
    delta,
  });
  if (!result.applied) return result;
  uploadElevations();
  scheduleTerrainSave();
  return result;
}

export function brushSmoothTouched(cx, cy) {
  const result = submitSemanticCommand({
    type: 'terrain.smooth',
    x: cx,
    y: cy,
    radius: Math.max(1, brush.radius | 0),
    strength: brush.smooth || 0.25,
  });
  if (!result.applied) return result;
  uploadElevations();
  scheduleTerrainSave();
  return result;
}

export function commitLevelSelection() {
  if (!levelSel.active) return;
  const result = submitSemanticCommand({
    type: 'terrain.level',
    x0: levelSel.startX,
    y0: levelSel.startY,
    x1: levelSel.endX,
    y1: levelSel.endY,
    elevation: clamp(levelSel.base, 0, 255),
  });
  if (result.applied) {
    uploadElevations();
    scheduleTerrainSave();
  }
  levelSel.active = false;
  levelSel.pointerId = null;
  return result;
}

