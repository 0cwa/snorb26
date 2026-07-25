import {
  GRID_W,
  GRID_H,
  brush,
  BUILD_SPRITES,
  selected,
  customBuildingRegistry,
} from './state.js';
import {
  rebuildBuildingInstances,
  loadCustomTexture,
} from './renderer.js';
import { saveMapToLocal } from './storage.js';
import {
  getBuildingIdAt,
  submitSemanticCommand,
  submitSemanticCommands,
} from './multiplayer/commandBus.js';
import { randomId } from './multiplayer/ids.js';

function parseUrls(input) {
  return String(input || '').split(',').map(url => url.trim()).filter(Boolean);
}

function typeForUrl(url, registry = customBuildingRegistry) {
  let index = registry.indexOf(url);
  if (index === -1) {
    registry.push(url);
    index = registry.length - 1;
  }
  return BUILD_SPRITES + 1 + index;
}

export function placeBuildingAtSelected() {
  if (!selected.has) return;
  const result = submitSemanticCommand({
    type: 'building.place',
    x: selected.x,
    y: selected.y,
    buildingType: 1 + Math.floor(Math.random() * BUILD_SPRITES),
    id: randomId('building'),
  });
  if (!result.applied) return result;
  rebuildBuildingInstances();
  saveMapToLocal();
  return result;
}

export function placeCustomBuildingAtSelected(input) {
  if (!selected.has) return;
  const urls = parseUrls(input);
  if (urls.length === 0) return;
  const url = urls[Math.floor(Math.random() * urls.length)];
  const registryPreview = [...customBuildingRegistry];
  const result = submitSemanticCommand({
    type: 'building.place',
    x: selected.x,
    y: selected.y,
    buildingType: typeForUrl(url, registryPreview),
    id: randomId('building'),
    textureUrl: url,
  });
  if (!result.applied) return result;
  loadCustomTexture(url);
  rebuildBuildingInstances();
  saveMapToLocal();
  return result;
}

export function removeBuildingAtSelected(cx, cy) {
  const radius = Math.max(0, (brush.radius - 1) | 0);
  const commands = [];
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const x = cx + ox;
      const y = cy + oy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H || ox * ox + oy * oy > radius * radius) continue;
      const id = getBuildingIdAt(x, y);
      if (id) commands.push({ type: 'building.remove', id });
    }
  }
  const result = submitSemanticCommands(commands);
  if (!result.applied) return result;
  if (commands.length) {
    rebuildBuildingInstances();
    saveMapToLocal();
  }
  return result;
}

export function brushForest(cx, cy, input) {
  const radius = Math.max(1, brush.radius | 0);
  const density = brush.smooth || 0.25;
  const urls = parseUrls(input);
  if (urls.length === 0) return;

  // Canonicalize all random choices into explicit place commands before they
  // enter Loro, so replay never calls Math.random().
  const registryPreview = [...customBuildingRegistry];
  const commands = [];
  const usedUrls = new Set();
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const x = cx + ox;
      const y = cy + oy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H || ox * ox + oy * oy > radius * radius) continue;
      if (Math.random() >= density) continue;
      const url = urls[Math.floor(Math.random() * urls.length)];
      usedUrls.add(url);
      commands.push({
        type: 'building.place',
        x,
        y,
        buildingType: typeForUrl(url, registryPreview),
        id: randomId('building'),
        textureUrl: url,
      });
    }
  }

  const result = submitSemanticCommands(commands);
  if (!result.applied) return result;
  for (const url of usedUrls) loadCustomTexture(url);
  if (commands.length) {
    rebuildBuildingInstances();
    saveMapToLocal();
  }
  return result;
}
