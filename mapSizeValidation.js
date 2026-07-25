// WebGL2 only guarantees a 2048x2048 texture. Keep this check independent of
// WebGL so callers can validate a requested map before replacing app state.
export function validateTerrainTextureSize(width, height, maxTextureSize) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return { valid: false, reason: 'Map dimensions must be positive whole numbers.' };
  }

  if (!Number.isSafeInteger(maxTextureSize) || maxTextureSize < 1) {
    return { valid: false, reason: 'Unable to determine this browser\x27s maximum terrain texture size.' };
  }

  if (width > maxTextureSize || height > maxTextureSize) {
    return {
      valid: false,
      reason: `This browser supports terrain maps up to ${maxTextureSize}x${maxTextureSize}.`,
    };
  }

  return { valid: true, reason: null };
}
