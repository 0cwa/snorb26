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
import { MultiplayerTransport } from './multiplayer/transport.js';
import { createRtcConfig, observeIceDiagnostics, summarizeIceStats } from './multiplayer/webrtcRoom.js';
import { setGuestRuntimeActionHandler, submitRuntimeAction, validateRuntimeAction } from './multiplayer/runtimeActions.js';
import { getVisibleTileRect } from './terrainCulling.js';
import { validateTerrainTextureSize } from './mapSizeValidation.js';
import { readFileSync } from 'node:fs';

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

  test("accepts terrain dimensions at the browser texture-size limit", () => {
    const result = validateTerrainTextureSize(2048, 2048, 2048);
    assert(result.valid, "Expected map to fit");
    assert(result.reason === null, "A valid map should have no error reason");
  });

  test("rejects terrain dimensions wider than the browser texture-size limit", () => {
    const result = validateTerrainTextureSize(2560, 1024, 2048);
    assert(!result.valid, "Expected oversized width to be rejected");
    assert(result.reason.includes("2048x2048"), "Error should name the browser limit");
  });

  test("rejects terrain dimensions taller than the browser texture-size limit", () => {
    const result = validateTerrainTextureSize(1024, 2560, 2048);
    assert(!result.valid, "Expected oversized height to be rejected");
  });

  test("rejects invalid map dimensions before a texture upload is attempted", () => {
    for (const [width, height] of [[0, 256], [-1, 256], [256.5, 256], [NaN, 256]]) {
      const result = validateTerrainTextureSize(width, height, 4096);
      assert(!result.valid, "Expected invalid dimensions to be rejected");
    }
  });

  test("rejects an unavailable or invalid browser texture-size limit", () => {
    const result = validateTerrainTextureSize(256, 256, 0);
    assert(!result.valid, "Expected invalid browser limit to be rejected");
  });

  test('culls a centered, unrotated viewport to a small tile rectangle', () => {
    const rect = getVisibleTileRect({
      gridWidth: 100, gridHeight: 100, tileWidth: 64, tileHeight: 32,
      camera: { panX: 0, panY: 0, zoom: 1, tilt: 1, rotation: 0 },
      viewportWidth: 128, viewportHeight: 64,
      maxTerrainElevation: 0, elevationStep: 6, marginTiles: 0,
    });
    assert(rect.minX === 47 && rect.maxX === 52, `Unexpected X bounds: ${JSON.stringify(rect)}`);
    assert(rect.minY === 47 && rect.maxY === 52, `Unexpected Y bounds: ${JSON.stringify(rect)}`);
    assert(rect.width === 6 && rect.height === 6, 'Bounds should be inclusive');
  });

  test('includes every map edge when a zoomed-out viewport covers the map', () => {
    const rect = getVisibleTileRect({
      gridWidth: 256, gridHeight: 256, tileWidth: 64, tileHeight: 32,
      camera: { panX: 0, panY: 0, zoom: 0.01, tilt: 1, rotation: Math.PI / 4 },
      viewportWidth: 800, viewportHeight: 600,
      maxTerrainElevation: 255, elevationStep: 6,
    });
    assert(rect.minX === 0 && rect.minY === 0, `Expected top-left map edge: ${JSON.stringify(rect)}`);
    assert(rect.maxX === 255 && rect.maxY === 255, `Expected bottom-right map edge: ${JSON.stringify(rect)}`);
  });

  test('accounts for rotation and elevation displacement conservatively', () => {
    const options = {
      gridWidth: 256, gridHeight: 256, tileWidth: 64, tileHeight: 32,
      camera: { panX: 0, panY: -300, zoom: 1, tilt: 0.5, rotation: Math.PI / 3 },
      viewportWidth: 128, viewportHeight: 64,
      maxTerrainElevation: 100, elevationStep: 12, marginTiles: 0,
    };
    const rect = getVisibleTileRect(options);
    // This vertex is raised into the viewport from 1,200 world pixels below it.
    const elevatedTile = tileForWorldPoint(0, 900, options);
    assert(elevatedTile.x >= rect.minX && elevatedTile.x <= rect.maxX, `Elevated tile X was culled: ${JSON.stringify({ rect, elevatedTile })}`);
    assert(elevatedTile.y >= rect.minY && elevatedTile.y <= rect.maxY, `Elevated tile Y was culled: ${JSON.stringify({ rect, elevatedTile })}`);
  });

  test('clamps bounds and reports valid dimensions at map edges', () => {
    const rect = getVisibleTileRect({
      gridWidth: 10, gridHeight: 8, tileWidth: 64, tileHeight: 32,
      camera: { panX: -100000, panY: -100000, zoom: 1, tilt: 1, rotation: 0 },
      viewportWidth: 32, viewportHeight: 32,
      maxTerrainElevation: 0, elevationStep: 6,
    });
    assert(rect.minX >= 0 && rect.maxX < 10 && rect.minY >= 0 && rect.maxY < 8, `Out-of-grid bounds: ${JSON.stringify(rect)}`);
    assert(rect.width === rect.maxX - rect.minX + 1 && rect.height === rect.maxY - rect.minY + 1, 'Dimensions must match inclusive bounds');
  });

  test('contains every terrain tile whose raised or base vertex is on screen', () => {
    // These cases exercise the same rotated isometric transform used by the
    // terrain shader. A culling rectangle may be bigger than necessary, but
    // it must never omit a tile that can contribute a visible vertex.
    const cases = [
      { panX: 0, panY: 0, zoom: 1, tilt: 1, rotation: 0 },
      { panX: 140, panY: -95, zoom: 1.4, tilt: 0.55, rotation: Math.PI / 4 },
      { panX: -240, panY: 180, zoom: 0.7, tilt: 1.35, rotation: Math.PI * 0.83 },
      { panX: 340, panY: -420, zoom: 2.25, tilt: 0.4, rotation: -Math.PI * 0.37 },
    ];
    for (const camera of cases) {
      const options = {
        gridWidth: 48, gridHeight: 40, tileWidth: 64, tileHeight: 32,
        camera, viewportWidth: 320, viewportHeight: 180,
        maxTerrainElevation: 255, elevationStep: 9, marginTiles: 0,
      };
      const rect = getVisibleTileRect(options);
      for (let y = 0; y < options.gridHeight; y++) {
        for (let x = 0; x < options.gridWidth; x++) {
          const isVisible = [0, 255].some((height) =>
            [[0, 0], [1, 0], [0, 1], [1, 1]].some(([cornerX, cornerY]) => {
              const point = worldPointForTileVertex(x + cornerX, y + cornerY, height, options);
              return point.x >= camera.panX - options.viewportWidth / (2 * camera.zoom)
                && point.x <= camera.panX + options.viewportWidth / (2 * camera.zoom)
                && point.y >= camera.panY - options.viewportHeight / (2 * camera.zoom)
                && point.y <= camera.panY + options.viewportHeight / (2 * camera.zoom);
            }),
          );
          if (isVisible) {
            assert(x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY,
              `Visible tile was culled: ${JSON.stringify({ x, y, rect, camera })}`);
          }
        }
      }
    }
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
    const captured = captureLocalPreferences();
    const encoded = encodeLocalPreferences(captured);
    const decoded = decodeLocalPreferences(encoded);
    assert(decoded?.version === 1, 'preferences should decode');
    camera.targetPanX = -42;
    applyLocalPreferences(decoded);
    assert(camera.targetPanX === captured.camera.panX, 'saved camera should be restored locally');
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
      hostEpoch: 3, sequence: 9, durableSequence: 4, mapId: '00000000000000000000000000000001', width: 16, height: 16,
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
    const malicious = { ...snapshot, lemmings: [{ id: '\"><img src=x onerror=alert(1)>', x: 1, y: 1, a: 0, s: 1, c: [1, 1, 1] }] };
    rejected = false;
    try { encodeSimulationSnapshot(malicious); } catch { rejected = true; }
    assert(rejected, 'unsafe network entity strings must reject');
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
    capability.hostPublicKey = crypto.getRandomValues(new Uint8Array(65));
    capability.turnConfig = {
      turnUrls: ['turn:turn.example.test:3478?transport=udp'],
      username: 'snorb',
      credential: 'secret',
    };
    const invite = new URL(encodeInvite(capability, 'https://snorb.example/app'));
    assert(invite.search === '', 'invite must not put secrets in query parameters');
    const parsed = parseInviteFragment(invite.hash, { clear: false });
    assert(parsed.secret.length === 32 && parsed.roomId.length === 16, 'capability should round-trip');
    assert(parsed.trackerUrls[0].startsWith('wss://'), 'tracker should round-trip');
    assert(parsed.turnConfig.turnUrls[0].startsWith('turn:'), 'verified TURN URL should round-trip');
    assert(parsed.turnConfig.username === 'snorb' && parsed.turnConfig.credential === 'secret', 'TURN credentials should stay in the invite fragment');
  });

  test('multiplayer setup has one state-aware join action and collapsed TURN settings', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    const roomUi = readFileSync(new URL('./multiplayer/roomUI.js', import.meta.url), 'utf8');
    assert((html.match(/id="joinRoomBtn"/g) || []).length === 1, 'room setup should expose one join action');
    assert(!html.includes('id="reconnectRoomBtn"'), 'room setup should not expose a duplicate reconnect action');
    assert(html.includes('<details class="turn-settings">'), 'TURN settings should use a disclosure widget');
    assert(!html.includes('<details class="turn-settings" open'), 'TURN settings should be collapsed by default');
    assert(html.includes('id="roomInviteOutput"') && html.includes('Hosting continues when this dialog is closed'), 'hosts should have a selectable invite and clear background-hosting guidance');
    assert(roomUi.includes("getElementById('closeRoomBtn').addEventListener('click', () => dialog.close())"), 'closing the room dialog must not leave the active session');
  });

  test('TURN configuration retains STUN and validates relay credentials', () => {
    const config = createRtcConfig({ turnUrls: ['turn:turn.example.test:3478?transport=udp'], username: 'snorb', credential: 'secret' });
    assert(config.iceServers.length === 2, 'TURN config should retain the STUN server');
    assert(config.iceServers[0].urls.includes('stun:stun.cloudflare.com:3478'), 'default ICE config should include the Cloudflare STUN fallback');
    assert(config.iceServers[1].urls[0].startsWith('turn:'), 'TURN URL should be configured');
    let rejected = false;
    try { createRtcConfig({ turnUrls: ['https://turn.example.test'], username: 'snorb', credential: 'secret' }); } catch { rejected = true; }
    assert(rejected, 'non-TURN URLs must reject');
    rejected = false;
    try { createRtcConfig({ turnUrls: ['turn:turn.example.test'], username: 'snorb' }); } catch { rejected = true; }
    assert(rejected, 'TURN config must require a password');
  });

  test('runtime actions are strictly validated and guests submit without mutation', () => {

  test('TURN configuration and ICE diagnostics are bounded and sanitized', () => {
    let rejected = false;
    try { createRtcConfig({ turnUrls: ['turn:/'], username: 'snorb', credential: 'secret' }); } catch { rejected = true; }
    assert(rejected, 'malformed TURN URLs must reject');
    rejected = false;
    try { createRtcConfig({ turnUrls: Array(5).fill('turn:turn.example.test'), username: 'snorb', credential: 'secret' }); } catch { rejected = true; }
    assert(rejected, 'TURN URL count must be capped');
    const stats = new Map([
      ['pair', { id: 'pair', type: 'candidate-pair', selected: true, state: 'succeeded', localCandidateId: 'local-secret', remoteCandidateId: 'remote-secret' }],
      ['local-secret', { id: 'local-secret', type: 'local-candidate', candidateType: 'relay', protocol: 'tcp', relayProtocol: 'tls', address: '192.0.2.1', port: 1234 }],
      ['remote-secret', { id: 'remote-secret', type: 'remote-candidate', candidateType: 'srflx', protocol: 'udp', address: '198.51.100.1', port: 5678 }],
    ]);
    const summary = summarizeIceStats(stats);
    assert(summary.local.type === 'relay' && summary.local.relayProtocol === 'tls', 'candidate summary should retain transport type only');
    assert(!JSON.stringify(summary).includes('192.0.2.1') && !JSON.stringify(summary).includes('local-secret'), 'candidate summary must omit addresses and IDs');
    const handlers = new Map();
    const fakePc = {
      iceGatheringState: 'gathering', iceConnectionState: 'checking', connectionState: 'connecting',
      getConfiguration: () => ({ iceServers: [
        { urls: ['stun:stun.example.test', 'stun:backup.example.test'] },
        { urls: 'turn:turn.example.test', username: 'private-user', credential: 'private-password' },
      ] }),
      addEventListener: (name, handler) => handlers.set(name, handler),
      removeEventListener: name => handlers.delete(name),
    };
    const events = [];
    const stop = observeIceDiagnostics(fakePc, event => events.push(event));
    handlers.get('icecandidate')({ candidate: { type: 'relay', protocol: 'udp', address: '192.0.2.1', port: 1234 } });
    handlers.get('icecandidateerror')({ errorCode: 701, errorText: 'bad\nturn response', url: 'turn:turn.example.test' });
    assert(events.some(event => event.type === 'ice-server-config' && event.stun === 2 && event.turn === 1), 'ICE diagnostics should report only server-type counts');
    assert(events.some(event => event.type === 'ice-candidate' && event.candidate.type === 'relay'), 'ICE diagnostics should report safe candidate types');
    assert(events.some(event => event.type === 'ice-gathering-state' && event.state === 'gathering'), 'initial ICE state should be reported');
    assert(events.at(-1).type === 'ice-candidate-error' && events.at(-1).code === 701 && events.at(-1).category === 'server-unreachable' && events.at(-1).serverType === 'turn', 'candidate errors should use only a safe category and server type');
    const diagnostics = JSON.stringify(events);
    assert(!diagnostics.includes('bad turn response') && !diagnostics.includes('192.0.2.1') && !diagnostics.includes('private-user') && !diagnostics.includes('turn.example.test'), 'ICE diagnostics must omit browser text, addresses, credentials, and server URLs');
    stop();
  });
    const accepted = validateRuntimeAction({ type: 'simulation.setSpeed', gameSpeed: 2 });
    assert(accepted.gameSpeed === 2, 'valid game speed should normalize');
    let rejected = false;
    try { validateRuntimeAction({ type: 'simulation.setSpeed', gameSpeed: 10 }); } catch { rejected = true; }
    assert(rejected, 'out-of-range speed must reject');
    rejected = false;
    try { validateRuntimeAction({ type: 'lemming.plop', x: 0.5, y: 1 }); } catch { rejected = true; }
    assert(rejected, 'fractional positions must reject');
    rejected = false;
    try { validateRuntimeAction({ type: 'simulation.setPlaying', isPlaying: true, state: {} }); } catch { rejected = true; }
    assert(rejected, 'unknown action fields must reject');

    const originalPlaying = appState.isPlaying;
    let request = null;
    setGuestRuntimeActionHandler(value => { request = value; });
    setAuthorityRole(AuthorityRole.GUEST);
    const result = submitRuntimeAction({ type: 'simulation.setPlaying', isPlaying: !originalPlaying });
    assert(result.pending && !result.applied && result.requestId, 'guest action should be pending with a request id');
    assert(request?.action?.isPlaying === !originalPlaying, 'guest should send a semantic action');
    assert(appState.isPlaying === originalPlaying, 'guest action must not mutate local simulation state');
    setGuestRuntimeActionHandler(null);
    setAuthorityRole(AuthorityRole.SINGLE_PLAYER);
  });

  test('replays transport readiness when handlers attach after DataChannels open', () => {
    const transport = new MultiplayerTransport();
    const info = { type: 'webrtc' };
    transport._open(info);
    let calls = 0;
    transport.setHandlers({ onOpen: received => {
      calls++;
      assert(received === info, 'late handler should receive original connection info');
    } });
    transport._open(info);
    assert(calls === 1, 'late handler should receive exactly one readiness notification');
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

function tileForWorldPoint(worldX, worldY, options) {
  const { camera, gridWidth, gridHeight, tileWidth, tileHeight } = options;
  const rx = worldX / tileWidth + worldY / (tileHeight * camera.tilt);
  const ry = -worldX / tileWidth + worldY / (tileHeight * camera.tilt);
  const cos = Math.cos(camera.rotation), sin = Math.sin(camera.rotation);
  return {
    x: Math.floor(rx * cos + ry * sin + gridWidth * 0.5),
    y: Math.floor(-rx * sin + ry * cos + gridHeight * 0.5),
  };
}

function worldPointForTileVertex(x, y, height, options) {
  const { camera, gridWidth, gridHeight, tileWidth, tileHeight, elevationStep } = options;
  const pX = x - gridWidth * 0.5;
  const pY = y - gridHeight * 0.5;
  const cos = Math.cos(camera.rotation), sin = Math.sin(camera.rotation);
  const rX = pX * cos - pY * sin;
  const rY = pX * sin + pY * cos;
  return {
    x: (rX - rY) * (tileWidth * 0.5),
    y: (rX + rY) * (tileHeight * camera.tilt * 0.5) - height * elevationStep,
  };
}

runTests();
