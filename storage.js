import {
  customBuildingRegistry,
  deserializeMap,
  serializeMap,
} from './state.js';
import {
  uploadElevations,
  updatePaletteTexture,
  rebuildBuildingInstances,
  rebuildExtrusionBuffers,
  rebuildCubeBuffers,
  loadCustomTexture,
} from './renderer.js';
import { updateViewMenuUI, updateActiveToolMenuItem } from './menuSystem.js';
import { syncWorkerState } from './workerClient.js';
import { AuthorityRole, getAuthorityRole } from './authority.js';
import {
  LOCAL_PREFERENCES_STORAGE_KEY,
  applyLocalPreferences,
  captureLocalPreferences,
  decodeLocalPreferences,
  encodeLocalPreferences,
  extractLegacyLocalPreferences,
} from './localState.js';
import { initializeCommandBus, rebuildBuildingIdIndex } from './multiplayer/commandBus.js';

export const MAP_STORAGE_KEY = 'snorb_map_data';

let saveTimeout = null;
let preferenceSaveTimeout = null;

function writeLocalPreferences() {
  localStorage.setItem(
    LOCAL_PREFERENCES_STORAGE_KEY,
    encodeLocalPreferences(captureLocalPreferences()),
  );
  preferenceSaveTimeout = null;
}

export function saveLocalPreferences(immediate = false) {
  if (preferenceSaveTimeout) clearTimeout(preferenceSaveTimeout);
  if (immediate) writeLocalPreferences();
  else preferenceSaveTimeout = setTimeout(writeLocalPreferences, 250);
}

export function loadLocalPreferences() {
  const preferences = decodeLocalPreferences(
    localStorage.getItem(LOCAL_PREFERENCES_STORAGE_KEY),
  );
  return preferences ? applyLocalPreferences(preferences) : false;
}

export function saveMapToLocal(fromWorker = false) {
  saveLocalPreferences();
  // A guest's remote room view must never overwrite their local map.
  if (getAuthorityRole() === AuthorityRole.GUEST) return;
  if (!fromWorker) syncWorkerState();
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (getAuthorityRole() === AuthorityRole.GUEST) { saveTimeout = null; return; }
    localStorage.setItem(MAP_STORAGE_KEY, serializeMap());
    saveTimeout = null;
  }, 500);
}

export function loadMapFromLocal() {
  const saved = localStorage.getItem(MAP_STORAGE_KEY);
  const storedPreferences = decodeLocalPreferences(
    localStorage.getItem(LOCAL_PREFERENCES_STORAGE_KEY),
  );

  if (!saved) {
    if (storedPreferences) applyLocalPreferences(storedPreferences);
    return false;
  }

  // Migrate local camera/UI values from a legacy v2 save once. Imported files
  // bypass this path, so they can never control this client's view.
  const preferences = storedPreferences || extractLegacyLocalPreferences(saved);
  const loaded = deserializeMap(saved);
  if (!loaded) {
    if (storedPreferences) applyLocalPreferences(storedPreferences);
    return false;
  }
  rebuildBuildingIdIndex();
  initializeCommandBus().catch(error => console.error('Could not open map command history', error));

  if (preferences) {
    applyLocalPreferences(preferences);
    if (!storedPreferences) {
      localStorage.setItem(LOCAL_PREFERENCES_STORAGE_KEY, encodeLocalPreferences(preferences));
    }
  }
  return true;
}

export function downloadMapFile() {
  const dataText = serializeMap();
  const blob = new Blob([dataText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `map_${new Date().toISOString().slice(0,10)}.snorb`;
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadMapFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json,.snorb,text/plain,application/json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        resolve(false);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const success = deserializeMap(event.target.result);
          if (!success) {
            resolve(false);
            return;
          }
          rebuildBuildingIdIndex();
          initializeCommandBus().catch(error => console.error('Could not open map command history', error));
          updatePaletteTexture();
          updateViewMenuUI();
          updateActiveToolMenuItem();
          uploadElevations();
          rebuildExtrusionBuffers();
          rebuildCubeBuffers();
          rebuildBuildingInstances();
          customBuildingRegistry.forEach(url => { if(url) loadCustomTexture(url); });
          saveMapToLocal();
          resolve(success);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    };

    input.click();
  });
}
