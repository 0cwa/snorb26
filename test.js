import {
  appState,
  brush,
  camera,
  compileMath,
  deserializeMap,
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

  console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

runTests();
