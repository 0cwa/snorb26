import { compileMath } from './state.js'; //
import { getVisibleTileRect } from './terrainCulling.js';

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

  console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
  if (failed) process.exitCode = 1;
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
