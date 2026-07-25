function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes);
  // Node versions without global WebCrypto are test-only; IDs remain unique enough
  // locally, while room capabilities will require WebCrypto explicitly.
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function randomId(prefix = 'id') {
  return `${prefix}-${Array.from(randomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function baselineBuildingId(x, y, buildingType) {
  return `building-${x}-${y}-${buildingType}`;
}
