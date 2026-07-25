import {
  appState,
  brush,
  buildingAt,
  camera,
  compileMath,
  deserializeMap,
  durableBuildingIds,
  LOCAL_UI_STATE_KEYS,
  paintStroke,
  selected,
  serializeMap,
  SHARED_SIMULATION_STATE_KEYS,
} from './state.js';
import {
  applyLocalPreferences,
  captureLocalPreferences,
  decodeLocalPreferences,
  encodeLocalPreferences,
  extractLegacyLocalPreferences,
} from './localState.js';
import {
  AuthorityRole,
  getAuthorityRole,
  isSimulationAuthority,
  setAuthorityRole,
} from './authority.js';
import { applySemanticCommand, applySemanticCommandsAtomically, validateSemanticCommand } from './multiplayer/semanticCommands.js';
import { decodeSimulationSnapshot, encodeSimulationSnapshot } from './multiplayer/snapshotCodec.js';
import { MessageKind, decodeFrame, encodeFrame } from './multiplayer/protocol.js';
import { createRoomCapability, encodeInvite, parseInviteFragment } from './multiplayer/roomCapability.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log("Running compileMath tests...\n");
  let passed = 0;
  let failed = 0;

  const test = (name, fn) => {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}\n  -> ${e.message}`);
      failed++;
    }
  };

  // Valid Math Operations
  test("allows basic valid math operations with variable t", () => {
    const fn = compileMath('t * 2 + 5');
    assert(typeof fn === 'function', 'Should return a function');
    assert(fn(10) === 25, `Expected 25, got ${fn(10)}`);
  });

  test("allows valid Math shorthand functions with pi", () => {
    const fn = compileMath('sin(pi / 2)');
    assert(typeof fn === 'function', 'Should return a function');
    assert(Math.abs(fn(0) - 1) < 0.001, `Expected close to 1, got ${fn(0)}`);
  });

  test("dynamically resolves native Math functions like sqrt and abs", () => {
    const fnSqrt = compileMath('sqrt(16)');
    assert(fnSqrt(0) === 4, 'sqrt(16) should be 4');
    
    const fnAbs = compileMath('abs(-42)');
    assert(fnAbs(0) === 42, 'abs(-42) should be 42');
  });

  test("handles case sensitivity properly", () => {
    const fnCapPi = compileMath('PI');
    assert(fnCapPi(0) === Math.PI, 'PI should evaluate to Math.PI');

    const fnCapSin = compileMath('SIN(0)');
    assert(fnCapSin(0) === 0, 'SIN(0) should be 0');
  });

  // Character Whitelist Checks
  test("blocks brackets []", () => {
    const fn = compileMath('Math["sin"](t)');
    assert(fn === null, 'Should block brackets');
  });

  test("blocks quotes", () => {
    const fn = compileMath('sin("t")');
    assert(fn === null, 'Should block double quotes');
    
    const fnSingle = compileMath("sin('t')");
    assert(fnSingle === null, 'Should block single quotes');
  });

  test("blocks braces {}", () => {
    const fn = compileMath('t + { value: 1 }');
    assert(fn === null, 'Should block braces');
  });

  test("blocks assignment =", () => {
    const fn = compileMath('t = 5');
    assert(fn === null, 'Should block equals sign');
  });

  test("blocks semicolons", () => {
    const fn = compileMath('sin(t); alert(1)');
    assert(fn === null, 'Should block semicolons');
  });

  // Word Whitelist Checks
  test("blocks non-Math global functions and objects", () => {
    const fnAlert = compileMath('alert(1)');
    assert(fnAlert === null, 'Should block alert()');

    const fnConsole = compileMath('console.log(t)');
    assert(fnConsole === null, 'Should block console.log()');

    const fnWindow = compileMath('window.location');
    assert(fnWindow === null, 'Should block window object');
  });

  test("blocks words that are not on the Math object or 't' or 'pi'", () => {
    const fn = compileMath('t + someVariable');
    assert(fn === null, 'Should block arbitrary variables');
  });

  test('classifies shared simulation and local UI state', () => {
    assert(SHARED_SIMULATION_STATE_KEYS.includes('enableReproduction'), 'simulation setting should be shared');
    assert(!SHARED_SIMULATION_STATE_KEYS.includes('showGrid'), 'view setting must not be shared');
    assert(LOCAL_UI_STATE_KEYS.includes('toolMode'), 'tool mode should be local');
    assert(LOCAL_UI_STATE_KEYS.includes('eventNotifications'), 'notifications should be local');
  });

  test('authoritative map payload excludes camera and UI state', () => {
    const payload = serializeMap();
    assert(payload.includes('version: 3;'), 'expected map format version 3');
    assert(!payload.includes('camera {'), 'camera block must not be exported');
    assert(!payload.includes('brush {'), 'brush block must not be exported');
    assert(!payload.includes('showGrid:'), 'showGrid must not be exported');
    assert(!payload.includes('showUnderground:'), 'showUnderground must not be exported');
    assert(!payload.includes('eventNotifications:'), 'notifications must not be exported');
  });

  test('map loading cannot replace local camera, brush, or view state', () => {
    const payload = serializeMap();
    const legacyPayload = payload
      .replace('version: 3;', 'version: 2;\n  showGrid: false;\n  eventNotifications: false;')
      .replace('__DATA__', 'camera { panX: -500; panY: -500; zoom: 0.1; tilt: 0.5; rotation: 2; }\n\nbrush { radius: 1; smooth: 0; }\n\n__DATA__');
    camera.panX = camera.targetPanX = 123;
    camera.zoom = camera.targetZoom = 2;
    brush.radius = 7;
    appState.showGrid = true;
    appState.eventNotifications = true;
    assert(deserializeMap(legacyPayload), 'legacy map should deserialize');
    assert(camera.targetPanX === 123, 'camera should remain local');
    assert(camera.targetZoom === 2, 'zoom should remain local');
    assert(brush.radius === 7, 'brush should remain local');
    assert(appState.showGrid === true, 'view preference should remain local');
    assert(appState.eventNotifications === true, 'notifications should remain local');
  });

  test('map loading clears transient references into the previous map', () => {
    const payload = serializeMap();
    appState.activeExtrusion = { points: [] };
    appState.activeCubeIndex = 2;
    appState.queryTarget = { type: 'cube', index: 2 };
    selected.has = true;
    paintStroke.active = true;
    paintStroke.touched.add(1);
    assert(deserializeMap(payload), 'map should deserialize');
    assert(appState.activeExtrusion === null, 'active extrusion should clear');
    assert(appState.activeCubeIndex === -1, 'active cube should clear');
    assert(appState.queryTarget === null, 'query target should clear');
    assert(!selected.has, 'selection should clear');
    assert(!paintStroke.active && paintStroke.touched.size === 0, 'paint stroke should clear');
  });

  test('map payload preserves stable building IDs', () => {
    const original = serializeMap();
    buildingAt[0] = 2;
    durableBuildingIds.set(0, 'building-persistent');
    const payload = serializeMap();
    buildingAt[0] = 0;
    durableBuildingIds.clear();
    assert(deserializeMap(payload), 'map with stable building ID should load');
    assert(buildingAt[0] === 2, 'building should survive map round-trip');
    assert(durableBuildingIds.get(0) === 'building-persistent', 'building ID should survive map round-trip');
    assert(deserializeMap(original), 'original map should restore');
  });

  test('local preferences round-trip independently', () => {
    const encoded = encodeLocalPreferences(captureLocalPreferences());
    const decoded = decodeLocalPreferences(encoded);
    assert(decoded?.version === 1, 'preferences should decode');
    camera.targetPanX = -42;
    applyLocalPreferences(decoded);
    assert(camera.targetPanX === 123, 'saved camera should be restored locally');
  });

  test('legacy local preferences can be migrated without map application', () => {
    const legacy = `map { showGrid: true; showUnderground: false; eventNotifications: true; }\ncamera { panX: 9; panY: 8; zoom: 0.5; tilt: 1; rotation: 0.2; }\nbrush { radius: 4; smooth: 0.75; }`;
    const preferences = extractLegacyLocalPreferences(legacy);
    assert(preferences.camera.panX === 9, 'legacy camera should be extracted');
    assert(preferences.brush.radius === 4, 'legacy brush should be extracted');
    assert(preferences.view.showGrid === true, 'legacy view should be extracted');
  });

  test('guest authority cannot run or commit local simulation', () => {
    setAuthorityRole(AuthorityRole.GUEST);
    assert(getAuthorityRole() === AuthorityRole.GUEST, 'role should change');
    assert(!isSimulationAuthority(), 'guest must not be simulation authority');
    setAuthorityRole(AuthorityRole.SINGLE_PLAYER);
    assert(isSimulationAuthority(), 'single-player remains authoritative');
  });

  test('validates and applies semantic terrain commands without full arrays', () => {
    const context = {
      width: 8,
      height: 8,
      elevations: new Uint8Array(64),
      buildingAt: new Uint8Array(64),
      buildingsById: new Map(),
      buildingIdsByCell: new Map(),
      durableBuildingIds: new Map(),
      customBuildingRegistry: [],
      builtInBuildingTypes: 4,
    };
    const command = validateSemanticCommand({ type: 'terrain.raise', x: 4, y: 4, radius: 2, delta: 1 }, context);
    const dirty = applySemanticCommand(command, context);
    assert(dirty.terrain, 'terrain should be dirty');
    assert(context.elevations[4 * 8 + 4] === 1, 'terrain center should rise');
    let rejected = false;
    try {
      validateSemanticCommand({ ...command, elevations: new Uint8Array(64) }, context);
    } catch { rejected = true; }
    assert(rejected, 'full terrain arrays must be rejected');
  });

  test('building semantic commands use stable IDs', () => {
    const context = {
      width: 4,
      height: 4,
      elevations: new Uint8Array(16),
      buildingAt: new Uint8Array(16),
      buildingsById: new Map(),
      buildingIdsByCell: new Map(),
      durableBuildingIds: new Map(),
      customBuildingRegistry: [],
      builtInBuildingTypes: 4,
    };
    const place = validateSemanticCommand({ type: 'building.place', x: 1, y: 2, buildingType: 2, id: 'building-stable' }, context);
    applySemanticCommand(place, context);
    assert(context.buildingAt[9] === 2, 'building should be placed');
    applySemanticCommand(validateSemanticCommand({ type: 'building.remove', id: 'building-stable' }, context), context);
    assert(context.buildingAt[9] === 0, 'stable ID should remove the building');
  });

  test('binary simulation snapshots round-trip typed terrain data', () => {
    const cells = 16 * 16;
    const snapshot = {
      hostEpoch: 3, sequence: 9, durableSequence: 4, width: 16, height: 16,
      gameTime: 12.5, waterLevel: 86, simulation: { isPlaying: true },
      elevations: Uint8Array.from({ length: cells }, (_, index) => index % 256),
      buildingAt: new Uint8Array(cells), durableBuildingIds: [],
      customBuildingRegistry: [], cubes: [], extrusions: [], lemmings: [],
    };
    const bytes = encodeSimulationSnapshot(snapshot);
    const decoded = decodeSimulationSnapshot(bytes);
    assert(bytes instanceof Uint8Array, 'snapshot transport should be binary');
    assert(decoded.sequence === 9 && decoded.elevations[255] === 255, 'snapshot should round-trip');
    let rejected = false;
    try { decodeSimulationSnapshot(bytes.subarray(0, bytes.length - 1)); } catch { rejected = true; }
    assert(rejected, 'truncated snapshot must reject');
  });

  test('binary protocol frames reject truncation and preserve payloads', () => {
    const frame = encodeFrame({ kind: MessageKind.LORO_UPDATE, roomId: 'room-test', hostEpoch: 2, sequence: 8, payload: Uint8Array.of(1, 2, 3) });
    const decoded = decodeFrame(frame);
    assert(decoded.roomId === 'room-test' && decoded.payload[2] === 3, 'frame should round-trip');
    let rejected = false;
    try { decodeFrame(frame.subarray(0, frame.length - 1)); } catch { rejected = true; }
    assert(rejected, 'truncated frame should reject');
  });

  test('room secret stays in a round-trippable URL fragment', () => {
    const capability = createRoomCapability(['wss://tracker.example.test/announce']);
    const invite = new URL(encodeInvite(capability, 'https://snorb.example/app'));
    assert(invite.search === '', 'invite must not put secrets in query parameters');
    const parsed = parseInviteFragment(invite.hash, { clear: false });
    assert(parsed.secret.length === 32 && parsed.roomId.length === 16, 'capability should round-trip');
    assert(parsed.trackerUrls[0].startsWith('wss://'), 'tracker should round-trip');
  });

  test('semantic batches reject atomically', () => {
    const context = {
      width: 4, height: 4,
      elevations: new Uint8Array(16), buildingAt: new Uint8Array(16),
      buildingsById: new Map([['duplicate', { x: 0, y: 0, buildingType: 1 }]]),
      buildingIdsByCell: new Map([[0, 'duplicate']]),
      durableBuildingIds: new Map([[0, 'duplicate']]),
      customBuildingRegistry: [], builtInBuildingTypes: 4,
    };
    const commands = [
      validateSemanticCommand({ type: 'terrain.raise', x: 1, y: 1, radius: 1, delta: 1 }, context),
      validateSemanticCommand({ type: 'building.place', x: 2, y: 2, buildingType: 5, id: 'duplicate', textureUrl: 'https://example.test/tree.png' }, context),
    ];
    let rejected = false;
    try { applySemanticCommandsAtomically(commands, context); } catch { rejected = true; }
    assert(rejected, 'conflicting batch should reject');
    assert(context.elevations.every(value => value === 0), 'terrain must roll back');
    assert(context.customBuildingRegistry.length === 0, 'registry must roll back');
  });

  console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

runTests();
