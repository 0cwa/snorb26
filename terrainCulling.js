/**
 * Return an inclusive, conservative rectangle of terrain tile indices that can
 * intersect the viewport. The calculation includes a guard band: drawing an
 * extra edge tile is preferable to a terrain gap while the camera moves.
 *
 * `elevationStep` must be the effective world-space elevation step used by
 * the terrain draw (including any camera-tilt/parallax adjustment).
 */
export function getVisibleTileRect({
  gridWidth,
  gridHeight,
  tileWidth,
  tileHeight,
  camera,
  viewportWidth,
  viewportHeight,
  maxTerrainElevation,
  elevationStep,
  marginTiles = 2,
}) {
  if (!Number.isInteger(gridWidth) || !Number.isInteger(gridHeight) || gridWidth < 1 || gridHeight < 1) {
    throw new RangeError('gridWidth and gridHeight must be positive integers');
  }
  if (!(tileWidth > 0) || !(tileHeight > 0) || !(viewportWidth >= 0) || !(viewportHeight >= 0)) {
    throw new RangeError('tile and viewport dimensions must be non-negative, with positive tile dimensions');
  }
  if (!(camera?.zoom > 0) || !(camera?.tilt > 0) || !Number.isFinite(camera.panX) || !Number.isFinite(camera.panY) || !Number.isFinite(camera.rotation)) {
    throw new RangeError('camera must contain finite panX, panY, rotation, and positive zoom and tilt');
  }
  if (!(maxTerrainElevation >= 0) || !(elevationStep >= 0) || !(marginTiles >= 0)) {
    throw new RangeError('maxTerrainElevation, elevationStep, and marginTiles must be non-negative');
  }

  // Screen space is a translated/scaled version of world space, so invert the
  // viewport first. Elevation moves terrain upward in screen/world Y; allow
  // its full displacement below the viewport when considering base vertices.
  const halfViewWidth = viewportWidth / (2 * camera.zoom);
  const halfViewHeight = viewportHeight / (2 * camera.zoom);
  const worldMinX = camera.panX - halfViewWidth;
  const worldMaxX = camera.panX + halfViewWidth;
  const worldMinY = camera.panY - halfViewHeight;
  const worldMaxY = camera.panY + halfViewHeight + maxTerrainElevation * elevationStep;

  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  const vertices = [
    [worldMinX, worldMinY], [worldMinX, worldMaxY],
    [worldMaxX, worldMinY], [worldMaxX, worldMaxY],
  ];
  let minVertexX = Infinity, minVertexY = Infinity;
  let maxVertexX = -Infinity, maxVertexY = -Infinity;

  for (const [worldX, worldY] of vertices) {
    // Invert isometric projection, then invert the map rotation.
    const rx = worldX / tileWidth + worldY / (tileHeight * camera.tilt);
    const ry = -worldX / tileWidth + worldY / (tileHeight * camera.tilt);
    const vertexX = rx * cos + ry * sin + gridWidth * 0.5;
    const vertexY = -rx * sin + ry * cos + gridHeight * 0.5;
    minVertexX = Math.min(minVertexX, vertexX);
    minVertexY = Math.min(minVertexY, vertexY);
    maxVertexX = Math.max(maxVertexX, vertexX);
    maxVertexY = Math.max(maxVertexY, vertexY);
  }

  // Tile (x, y) owns the vertex square [x, x + 1] × [y, y + 1]. The extra
  // boundary tile and margin account for contact, rasterization, and animation.
  const margin = Math.ceil(marginTiles);
  const minX = clamp(Math.floor(minVertexX) - 1 - margin, 0, gridWidth - 1);
  const minY = clamp(Math.floor(minVertexY) - 1 - margin, 0, gridHeight - 1);
  const maxX = clamp(Math.ceil(maxVertexX) + margin, 0, gridWidth - 1);
  const maxY = clamp(Math.ceil(maxVertexY) + margin, 0, gridHeight - 1);

  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
