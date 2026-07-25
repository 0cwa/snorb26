export let GRID_W = 256;
export let GRID_H = 256;
export const TILE_W = 64;
export const TILE_H = 32;
export const ELEV_STEP = 6;
export const BUILD_SPRITES = 4;

export let elevations = new Uint8Array(GRID_W * GRID_H);
export let buildingAt = new Uint8Array(GRID_W * GRID_H);
// Sparse stable IDs for durable human-authored buildings, keyed by tile index.
export const durableBuildingIds = new Map();
export const customBuildingRegistry = [];
export const extrusions = [];
export const extrusionSettings = { width: 0.5, height: 2.0, altitude: 0.0, color: [0.5, 0.5, 0.5] };

export const cubes = [];
export const cubeSettings = { width: 4.0, length: 4.0, height: 10.0, rotation: 0.0, color: [1.0, 0.26, 0.26] };

export const lemmings = [];

export const SC3K_COLOR_STOPS = [
  { t:   0, c:[  0/255,  20/255,  60/255] },
  { t:  28, c:[  0/255,  55/255, 110/255] },
  { t:  50, c:[  0/255, 105/255, 165/255] },
  { t:  70, c:[ 62/255, 150/255, 185/255] },
  { t:  86, c:[195/255, 176/255, 120/255] },
  { t: 100, c:[ 70/255, 150/255,  70/255] },
  { t: 140, c:[ 50/255, 125/255,  55/255] },
  { t: 170, c:[120/255, 105/255,  70/255] },
  { t: 200, c:[110/255, 110/255, 110/255] },
  { t: 230, c:[170/255, 170/255, 175/255] },
  { t: 255, c:[240/255, 240/255, 242/255] },
];

function newMapId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export let mapId = newMapId();

export const mapSettings = {
  waterLevel: 86
};

export const camera = {
  panX: 0,
  panY: (256 + 256) * (32 * 0.25),
  zoom: 1.0,
  tilt: 1.0,
  rotation: 0,
  targetPanX: 0,
  targetPanY: (256 + 256) * (32 * 0.25),
  targetZoom: 1.0,
  targetTilt: 1.0,
  targetRotation: 0,
  minZoom: 0.01,
  maxZoom: 5.0,
  defaultZoom: 0.1,
  minTilt: 0.35,
  maxTilt: 2.0,
  lerpFactor: 0.15
};
export const selected = { has: false, x: 0, y: 0, id: 0 };
export const levelSel = { active: false, startX: 0, startY: 0, endX: 0, endY: 0, base: 0, pointerId: null };

export const paintStroke = {
  active: false,
  pointerId: null,
  delta: 0,
  lastX: -9999,
  lastY: -9999,
  touched: new Set(),
};

export const brush = { radius: 2, smooth: 0.25 };
// Multiplayer ownership boundary:
// - Shared simulation settings are host-authoritative and may be exported/shared.
// - Local UI fields never leave this browser (camera and brush live above as local state too).
export const SHARED_SIMULATION_STATE_KEYS = Object.freeze([
  'enableReproduction', 'enableDestressShocks', 'enableDanceSmoothing',
  'enableLemmingSwimming', 'isPlaying', 'gameSpeed', 'loveChance',
  'ageGapPenalty', 'babyChance', 'babyCooldown', 'maxBirthAge', 'deathAge',
  'deathChance', 'maxAdditions',
]);
export const LOCAL_UI_STATE_KEYS = Object.freeze([
  'toolMode', 'showGrid', 'showUnderground', 'activeExtrusion',
  'editPathNodeIndex', 'activeCubeIndex', 'activeCubeHandle', 'queryTarget',
  'eventNotifications', 'cameraShakeTimer',
]);

const defaultAppState = {
  toolMode: 'pan',
  showGrid: false,
  showUnderground: false,
  activeExtrusion: null,
  editPathNodeIndex: -1,
  activeCubeIndex: -1,
  activeCubeHandle: -1,
  queryTarget: null,
  enableReproduction: true,
  enableDestressShocks: true,
  enableDanceSmoothing: true,
  enableLemmingSwimming: true,
  eventNotifications: true,
  isPlaying: true,
  gameSpeed: 1.0,
  gameTime: 0,
  loveChance: 0.3,
  ageGapPenalty: 0.01,
  babyChance: 0.2,
  babyCooldown: 60.0,
  maxBirthAge: 50.0,
  deathAge: 60.0,
  deathChance: 0.0001,
  maxAdditions: 50,
  cameraShakeTimer: 0,
}
export const appState = Object.assign({}, defaultAppState);

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function screenToWorld(sx, sy, canvasWidth, canvasHeight) {
  const wx = (sx - canvasWidth * 0.5) / camera.zoom + camera.panX;
  const wy = (sy - canvasHeight * 0.5) / camera.zoom + camera.panY;
  return [wx, wy];
}

export function tileCenterWorld(tx, ty, rotOverride = null) {
  const px = (tx + 0.5) - GRID_W * 0.5;
  const py = (ty + 0.5) - GRID_H * 0.5;
  const angle = rotOverride !== null ? rotOverride : camera.rotation;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = px * c - py * s;
  const ry = px * s + py * c;

  const wx = (rx - ry) * (TILE_W * 0.5);
  const wy = (rx + ry) * (TILE_H * camera.tilt * 0.5);
  const h = elevations[ty * GRID_W + tx] || 0;
  const parallaxScalar = 0.5 + (0.5 / camera.tilt);
  return [wx, wy - (h * ELEV_STEP * parallaxScalar)];
}

export function screenToWorldAtRotation(sx, sy, canvasWidth, canvasHeight, rot) {
  const x = (sx - canvasWidth * 0.5) / camera.zoom;
  const y = (sy - canvasHeight * 0.5) / camera.zoom;
  return [x, y];
}

export function compileMath(expr) {
  if (!expr) return null;

  // 1. Character Whitelist: Only allow alphanumeric, spaces, and safe math symbols.
  // This explicitly blocks brackets [], braces {}, quotes "", and equals = to stop injection.
  const safeCharRegex = /^[a-zA-Z0-9_\s+\-*/%(),.]*$/;
  if (!safeCharRegex.test(expr)) {
    console.warn(`Snorb math compilation blocked due to unsafe characters in: "${expr}"`);
    return null;
  }

  // 2. Word Whitelist: Extract all letter-based identifiers.
  const words = expr.match(/\b[a-zA-Z_]\w*\b/g) || [];

  // Get all standard properties on the Math object (sin, cos, PI, E, etc.)
  const mathProps = Object.getOwnPropertyNames(Math);
  const allowedKeywords = new Set(['t', 'pi']);
  mathProps.forEach(p => allowedKeywords.add(p.toLowerCase()));

  // Ensure every single word typed belongs strictly to our approved whitelist
  for (const word of words) {
    if (!allowedKeywords.has(word.toLowerCase())) {
      console.warn(`Snorb math compilation blocked unsafe or unknown identifier: "${word}"`);
      return null;
    }
  }

  // 3. Transform shorthand math functions and constants into Math.xxxx
  const jsExpr = expr.replace(/\b[a-zA-Z_]\w*\b/g, (match) => {
    const lower = match.toLowerCase();
    if (lower === 't') return 't';
    if (lower === 'pi') return 'Math.PI';

    // Find the exact property in Math, respecting its original casing
    const mathProp = mathProps.find(p => p.toLowerCase() === lower);
    if (mathProp) {
      return `Math.${mathProp}`;
    }
    return match;
  });

  try {
    // Now that it's sanitized and verified, it is safe to evaluate
    return new Function('t', `try { return ${jsExpr}; } catch(e) { return 0; }`);
  } catch(e) {
    console.warn("Snorb math compilation failed for:", expr, e);
    return null;
  }
}

// --- 1. Core Serialization (Custom CSS-Like Format) ---

export function serializeMap() {
  // Helper to neatly structure blocks and inject their associated comments
  const formatBlock = (type, stateObj, props) => {
    let blockOut = `${type} {\n`;
    const comments = stateObj._comments || {};
    
    props.forEach(([key, val]) => {
      if (comments[key]) {
        // Indent multi-line comments properly
        blockOut += `  ${comments[key].replace(/\n/g, '\n  ')}\n`;
      }
      blockOut += `  ${key}: ${val};\n`;
    });
    
    // Catch-all for comments that were sitting at the very bottom of a block
    if (comments['_trailing']) {
      blockOut += `  ${comments['_trailing'].replace(/\n/g, '\n  ')}\n`;
    }
    blockOut += `}\n\n`;
    return blockOut;
  };

  // Version 3 is the authoritative map payload boundary. Camera, brush,
  // selection, tools, and view preferences are deliberately not included.
  let out = formatBlock('map', mapSettings, [
    ['version', 3],
    ['mapId', mapId],
    ['width', GRID_W],
    ['height', GRID_H],
    ['waterLevel', mapSettings.waterLevel],
    ['isPlaying', appState.isPlaying],
    ['gameSpeed', appState.gameSpeed],
    ['enableReproduction', appState.enableReproduction],
    ['enableDestressShocks', appState.enableDestressShocks],
    ['enableDanceSmoothing', appState.enableDanceSmoothing],
    ['enableLemmingSwimming', appState.enableLemmingSwimming],
    ['loveChance', appState.loveChance],
    ['ageGapPenalty', appState.ageGapPenalty],
    ['babyChance', appState.babyChance],
    ['babyCooldown', appState.babyCooldown],
    ['maxBirthAge', appState.maxBirthAge],
    ['deathAge', appState.deathAge],
    ['deathChance', appState.deathChance],
    ['maxAdditions', appState.maxAdditions],
  ]);

  for (const [cell, id] of durableBuildingIds) {
    const buildingType = buildingAt[cell];
    if (!buildingType) continue;
    out += formatBlock('buildingId', {}, [
      ['id', id],
      ['x', cell % GRID_W],
      ['y', Math.floor(cell / GRID_W)],
      ['buildingType', buildingType],
    ]);
  }

  if (customBuildingRegistry.length > 0) {
    out += `customBuildings {\n`;
    customBuildingRegistry.forEach((url, i) => { out += `  ${i}: ${url};\n`; });
    out += `}\n\n`;
  }

  cubes.forEach(c => {
    const props = [
      ['x', c.x], ['y', c.y], ['w', c.w],
      ['l', c.l !== undefined ? c.l : c.w],
      ['h', c.h], ['r', c.r || 0], ['c', c.c.join(', ')],
    ];
    if (c.customPts) props.push(['customPts', c.customPts.map(n => n.toFixed(3)).join(', ')]);
    if (c.additions && c.additions.length > 0) {
      const serializedAdds = c.additions.map(a =>
        `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.a.toFixed(3)},${a.s.toFixed(3)},${a.c[0].toFixed(3)}_${a.c[1].toFixed(3)}_${a.c[2].toFixed(3)}`
      ).join(' | ');
      props.push(['additions', serializedAdds]);
    }
    if (c.rawDeltas) {
      if (c.rawDeltas.x) props.push(['dx', c.rawDeltas.x]);
      if (c.rawDeltas.y) props.push(['dy', c.rawDeltas.y]);
      if (c.rawDeltas.w) props.push(['dw', c.rawDeltas.w]);
      if (c.rawDeltas.l) props.push(['dl', c.rawDeltas.l]);
      if (c.rawDeltas.h) props.push(['dh', c.rawDeltas.h]);
      if (c.rawDeltas.r) props.push(['dr', c.rawDeltas.r]);
      if (c.rawDeltas.c) props.push(['dc', c.rawDeltas.c]);
    }
    out += formatBlock('cube', c, props);
  });

  extrusions.forEach(ext => {
    const props = [
      ['width', ext.width], ['height', ext.height],
      ['altitude', ext.altitude || 0], ['color', ext.color.join(', ')],
      ['points', ext.points.map(p => `${p.x},${p.y}`).join(' | ')]
    ];
    if (ext.rawDeltas) {
      if (ext.rawDeltas.w) props.push(['dw', ext.rawDeltas.w]);
      if (ext.rawDeltas.h) props.push(['dh', ext.rawDeltas.h]);
      if (ext.rawDeltas.a) props.push(['da', ext.rawDeltas.a]);
      if (ext.rawDeltas.c) props.push(['dc', ext.rawDeltas.c]);
      if (ext.rawDeltas.p) props.push(['dp', ext.rawDeltas.p]);
    }
    out += formatBlock('path', ext, props);
  });

  lemmings.forEach(l => {
    const props = [
      ['id', l.id],
      ['x', l.x], ['y', l.y], ['a', l.a], ['s', l.s],
      ['c', l.c.join(', ')], ['hasBuilt', l.hasBuilt || false],
      ['hasResource', l.hasResource || false],
      ['resourceId', l.resourceId || 0],
    ];
    if (l.isDigging) {
      props.push(['isDigging', l.isDigging]);
      props.push(['digTimer', (l.digTimer || 0).toFixed(2)]);
    }
    if (l.isRaising) {
      props.push(['isRaising', l.isRaising]);
      props.push(['raiseTimer', (l.raiseTimer || 0).toFixed(2)]);
    }
    if (l.isDancing) {
      props.push(['isDancing', l.isDancing]);
      props.push(['danceTimer', (l.danceTimer || 0).toFixed(2)]);
    }
    if (l.danceRestTimer > 0) {
      props.push(['danceRestTimer', l.danceRestTimer.toFixed(2)]);
    }
    if (l.isThinking) {
      props.push(['isThinking', l.isThinking]);
      props.push(['thinkTimer', (l.thinkTimer || 0).toFixed(2)]);
    }
    if (l.partnerId) {
      props.push(['partnerId', l.partnerId]);
    }
    if (l.stress > 0) {
      props.push(['stress', (l.stress || 0).toFixed(2)]);
    }
    if (l.age !== undefined) props.push(['age', l.age.toFixed(2)]);
    if (l.babyCooldown > 0) props.push(['babyCooldown', l.babyCooldown.toFixed(2)]);
    if (l.glistenTimer > 0) props.push(['glistenTimer', l.glistenTimer.toFixed(2)]);
    if (l.targetNewbornId) props.push(['targetNewbornId', l.targetNewbornId]);
    props.push(['grownUp', l.grownUp || false]);
    props.push(['danceProclivity', (l.danceProclivity || 0).toFixed(3)]);
    if (l.parentIds && l.parentIds.length > 0) {
        props.push(['parentIds', l.parentIds.join(',')]);
    }
    out += formatBlock('lemming', l, props);
  });

  out += `__DATA__\n`;

  const binLen = GRID_W * GRID_H;
  const combined = new Uint8Array(binLen * 2);
  combined.set(elevations, 0);
  combined.set(buildingAt, binLen);

  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < combined.length; i += chunk) {
    binary += String.fromCharCode.apply(null, combined.subarray(i, i + chunk));
  }
  // Convert to base64 and split into chunks of 300 characters
  const base64Data = btoa(binary);
  const formattedB64 = base64Data.match(/.{1,300}/g).join('\n');
  out += formattedB64;

  return out;
}

export function deserializeMap(text) {
  if (!text || typeof text !== 'string') return false;

  try {
    const parts = text.split('__DATA__');
    const blocksText = parts[0];
    // Strip all whitespaces/newlines from base64 data to prevent atob failures
    const b64 = parts[1] ? parts[1].replace(/\s/g, '') : '';

    const data = {
      extrusions: [],
      cubes: [],
      lemmings: [],
      customBuildingRegistry: [],
      buildingIds: [],
      camera: {},
      map: {},
      brush: {},
    };
    const blockRegex = /(\w+)\s*{([^}]+)}/g;
    let match;
    
    while ((match = blockRegex.exec(blocksText)) !== null) {
      const type = match[1];
      const content = match[2];
      const props = {};

      const lines = content.split('\n');
      let currentComment = [];
      
      lines.forEach(line => {
        let codePart = line;
        let commentPart = '';
        
        let commentIdx = line.indexOf('//');
        // Ignore // if it's part of a URL scheme (://)
        if (commentIdx !== -1 && commentIdx > 0 && line[commentIdx - 1] === ':') {
          commentIdx = line.indexOf('//', commentIdx + 2);
        }
        
        if (commentIdx !== -1) {
          codePart = line.slice(0, commentIdx);
          commentPart = line.slice(commentIdx).trim();
        }
        
        // Full line comment
        if (commentPart && !codePart.trim()) {
          currentComment.push(commentPart);
          return;
        }
        
        // Extract regular properties
        const segments = codePart.split(';');
        segments.forEach(seg => {
          const colon = seg.indexOf(':');
          if (colon === -1) return;
          
          const key = seg.slice(0, colon).trim();
          const val = seg.slice(colon + 1).trim();
          if (key) {
            props[key] = val;
            if (currentComment.length > 0) {
              if (!props._comments) props._comments = {};
              props._comments[key] = currentComment.join('\n');
              currentComment = [];
            }
          }
        });
        
        // Trailing comment placed at the end of a line with executable code
        if (commentPart && codePart.trim()) {
          const lastKey = Object.keys(props).filter(k => k !== '_comments').pop();
          if (lastKey) {
            if (!props._comments) props._comments = {};
            props._comments[lastKey] = (props._comments[lastKey] ? props._comments[lastKey] + '\n' : '') + commentPart;
          }
        }
      });
      
      if (currentComment.length > 0) {
        if (!props._comments) props._comments = {};
        props._comments['_trailing'] = currentComment.join('\n');
      }

      if (type === 'map') Object.assign(data.map, props);
      else if (type === 'camera') Object.assign(data.camera, props);
      else if (type === 'brush') Object.assign(data.brush, props);
      else if (type === 'buildingId') {
        data.buildingIds.push({ id: props.id, x: parseInt(props.x), y: parseInt(props.y), buildingType: parseInt(props.buildingType) });
      }
      else if (type === 'customBuildings') {
        Object.keys(props).forEach(k => {
          if (k !== '_comments') data.customBuildingRegistry[parseInt(k)] = props[k];
        });
      }
      else if (type === 'cube') {
        const cube = {
          x: parseFloat(props.x), y: parseFloat(props.y),
          w: parseFloat(props.w), l: parseFloat(props.l), h: parseFloat(props.h),
          r: parseFloat(props.r), c: props.c.split(',').map(Number),
        };
        if (props.customPts) cube.customPts = props.customPts.split(',').map(Number);
        if (props.additions) {
          cube.additions = props.additions.split('|').map(str => {
            const parts = str.trim().split(',');
            const cParts = parts[4].split('_').map(Number);
            return {
              x: parseFloat(parts[0]),
              y: parseFloat(parts[1]),
              a: parseFloat(parts[2]),
              s: parseFloat(parts[3]),
              c: cParts
            };
          });
        }
        const rawDeltas = {};
        const fns = {};
        let hasAnim = false;

        if (props.dx) { rawDeltas.x = props.dx; fns.x = compileMath(props.dx); hasAnim = true; }
        if (props.dy) { rawDeltas.y = props.dy; fns.y = compileMath(props.dy); hasAnim = true; }
        if (props.dw) { rawDeltas.w = props.dw; fns.w = compileMath(props.dw); hasAnim = true; }
        if (props.dl) { rawDeltas.l = props.dl; fns.l = compileMath(props.dl); hasAnim = true; }
        if (props.dh) { rawDeltas.h = props.dh; fns.h = compileMath(props.dh); hasAnim = true; }
        if (props.dr) { rawDeltas.r = props.dr; fns.r = compileMath(props.dr); hasAnim = true; }
        if (props.dc) {
            rawDeltas.c = props.dc;
            fns.c = props.dc.split(',').map(s => compileMath(s.trim()));
            hasAnim = true;
        }

        if (hasAnim) { cube.rawDeltas = rawDeltas; cube.fns = fns; }
        if (props._comments) cube._comments = props._comments;

        data.cubes.push(cube);
      }
      else if (type === 'path') {
        const pathObj = {
          width: parseFloat(props.width), height: parseFloat(props.height), altitude: parseFloat(props.altitude),
          color: props.color.split(',').map(Number),
          points: props.points.split('|').map(p => {
              const [x,y] = p.split(',').map(Number);
              return {x, y};
          })
        };

        const rawDeltas = {};
        const fns = {};
        let hasAnim = false;

        if (props.dw) { rawDeltas.w = props.dw; fns.w = compileMath(props.dw); hasAnim = true; }
        if (props.dh) { rawDeltas.h = props.dh; fns.h = compileMath(props.dh); hasAnim = true; }
        if (props.da) { rawDeltas.a = props.da; fns.a = compileMath(props.da); hasAnim = true; }
        if (props.dc) {
            rawDeltas.c = props.dc;
            fns.c = props.dc.split(',').map(s => compileMath(s.trim()));
            hasAnim = true;
        }
        if (props.dp) {
            rawDeltas.p = props.dp;
            fns.p = props.dp.split('|').map(p => {
                const parts = p.split(',');
                return {
                    x: parts[0] && parts[0].trim() ? compileMath(parts[0].trim()) : null,
                    y: parts[1] && parts[1].trim() ? compileMath(parts[1].trim()) : null
                };
            });
            hasAnim = true;
        }

        if (hasAnim) { pathObj.rawDeltas = rawDeltas; pathObj.fns = fns; }
        if (props._comments) pathObj._comments = props._comments;

        data.extrusions.push(pathObj);
      }
      else if (type === 'lemming') {
        const lem = {
          id: props.id || Math.random().toString(36).substr(2, 9),
          partnerId: props.partnerId || null,
          x: parseFloat(props.x), y: parseFloat(props.y),
          a: parseFloat(props.a), s: parseFloat(props.s),
          c: props.c.split(',').map(Number),
          hasBuilt: props.hasBuilt === 'true',
          hasResource: props.hasResource === 'true',
          resourceId: parseInt(props.resourceId) || 0,
          isDigging: props.isDigging === 'true',
          digTimer: parseFloat(props.digTimer) || 0,
          digAccumulator: 0,
          isRaising: props.isRaising === 'true',
          raiseTimer: parseFloat(props.raiseTimer) || 0,
          raiseAccumulator: 0,
          isDancing: props.isDancing === 'true',
          danceTimer: parseFloat(props.danceTimer) || 0,
          danceRestTimer: parseFloat(props.danceRestTimer) || 0,
          danceAccumulator: 0,
          stress: parseFloat(props.stress) || 0,
          isThinking: props.isThinking === 'true',
          thinkTimer: parseFloat(props.thinkTimer) || 0,
          // Sen: Notice how grownUp is a separate property from age lmfao
          grownUp: props.grownUp === 'true',
          age: parseFloat(props.age) || 0,
          babyCooldown: parseFloat(props.babyCooldown) || 0,
          glistenTimer: parseFloat(props.glistenTimer) || 0,
          targetNewbornId: props.targetNewbornId || null,
          danceProclivity: parseFloat(props.danceProclivity) || Math.random(),
          parentIds: props.parentIds ? props.parentIds.split(',') : [],
        };
        data.lemmings.push(lem);
      }
    }

    const gw = parseInt(data.map.width || 256);
    const gh = parseInt(data.map.height || 256);
    // Loading shared/exported map data must not reset this client's view/UI.
    resizeMapState(gw, gh, { resetLocalState: false });
    mapId = /^[a-f0-9]{32}$/.test(data.map.mapId || '') ? data.map.mapId : newMapId();

    if (b64) {
      const binary = atob(b64);
      const binLen = gw * gh;
      for (let i = 0; i < binLen; i++) {
          elevations[i] = binary.charCodeAt(i);
          buildingAt[i] = binary.charCodeAt(binLen + i);
      }
    }

    if (data.customBuildingRegistry) {
       customBuildingRegistry.length = 0;
       customBuildingRegistry.push(...data.customBuildingRegistry);
    }

    durableBuildingIds.clear();
    for (const entry of data.buildingIds) {
      if (!entry.id || entry.id.length > 96 || entry.x < 0 || entry.y < 0 || entry.x >= gw || entry.y >= gh) continue;
      const cell = entry.y * gw + entry.x;
      if (buildingAt[cell] === entry.buildingType) durableBuildingIds.set(cell, entry.id);
    }

    extrusions.length = 0;
    extrusions.push(...data.extrusions);
    cubes.length = 0;
    cubes.push(...data.cubes);
    if (data.lemmings) {
        lemmings.push(...data.lemmings);
    }

    // Legacy camera/brush blocks are parsed for compatibility, but ignored here.
    // storage.js migrates them only from this browser's own legacy local save.

    mapSettings.waterLevel = parseInt(data.map.waterLevel || 86);
    if (data.map._comments) mapSettings._comments = data.map._comments;
    const wEl = typeof document !== 'undefined' ? document.getElementById('waterLevel') : null;
    if (wEl) wEl.value = mapSettings.waterLevel;

    // showGrid/showUnderground/eventNotifications in v2 files are local UI
    // preferences and must not be applied by a map payload.
    appState.enableReproduction = data.map.enableReproduction === 'true';
    appState.enableDestressShocks = data.map.enableDestressShocks === 'true';
    appState.enableDanceSmoothing = data.map.enableDanceSmoothing === 'true';
    appState.enableLemmingSwimming = data.map.enableLemmingSwimming !== 'false';

    if (data.map.isPlaying !== undefined) appState.isPlaying = data.map.isPlaying !== 'false';
    if (data.map.gameSpeed !== undefined) appState.gameSpeed = parseFloat(data.map.gameSpeed) || 1.0;
    if (data.map.loveChance !== undefined) appState.loveChance = parseFloat(data.map.loveChance);
    if (data.map.ageGapPenalty !== undefined) appState.ageGapPenalty = parseFloat(data.map.ageGapPenalty);
    if (data.map.babyChance !== undefined) appState.babyChance = parseFloat(data.map.babyChance);
    if (data.map.babyCooldown !== undefined) appState.babyCooldown = parseFloat(data.map.babyCooldown);
    if (data.map.maxBirthAge !== undefined) appState.maxBirthAge = parseFloat(data.map.maxBirthAge);
    if (data.map.deathAge !== undefined) appState.deathAge = parseFloat(data.map.deathAge);
    if (data.map.deathChance !== undefined) appState.deathChance = parseFloat(data.map.deathChance);
    if (data.map.maxAdditions !== undefined) appState.maxAdditions = parseFloat(data.map.maxAdditions);

    return true;
  } catch (e) {
    console.error("Failed to parse map text data", e);
    return false;
  }
}

export function resizeMapState(width, height, { resetLocalState = true } = {}) {
  GRID_W = width;
  GRID_H = height;
  elevations = new Uint8Array(GRID_W * GRID_H);
  buildingAt = new Uint8Array(GRID_W * GRID_H);
  durableBuildingIds.clear();
  mapId = newMapId();
  extrusions.length = 0;
  cubes.length = 0;
  lemmings.length = 0;

  if (resetLocalState) {
    Object.assign(appState, defaultAppState);
    return;
  }

  // A loaded map controls simulation settings, while view preferences survive.
  // Ephemeral references into the old map must always be discarded.
  for (const key of SHARED_SIMULATION_STATE_KEYS) appState[key] = defaultAppState[key];
  appState.gameTime = 0;
  appState.activeExtrusion = null;
  appState.editPathNodeIndex = -1;
  appState.activeCubeIndex = -1;
  appState.activeCubeHandle = -1;
  appState.queryTarget = null;
  selected.has = false;
  levelSel.active = false;
  levelSel.pointerId = null;
  paintStroke.active = false;
  paintStroke.pointerId = null;
  paintStroke.touched.clear();
}

