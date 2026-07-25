// Authority policy only; networking is deliberately deferred.
// Single-player uses the same simulation-authority path as a future room host.
export const AuthorityRole = Object.freeze({
  SINGLE_PLAYER: 'single-player',
  HOST: 'host',
  GUEST: 'guest',
});

export const GUEST_ALLOWED_TOOLS = new Set([
  'pan',
  'orbit',
  'raise',
  'lower',
  'smooth',
  'level',
  'build',
  'custom-build',
  'forest',
  'demolish',
  'plop-lemming',
  'cleave-lemming',
]);

let role = AuthorityRole.SINGLE_PLAYER;

export function getAuthorityRole() {
  return role;
}

export function setAuthorityRole(nextRole) {
  if (!Object.values(AuthorityRole).includes(nextRole)) {
    throw new TypeError(`Unknown authority role: ${nextRole}`);
  }
  role = nextRole;
}

export function isSimulationAuthority() {
  return role !== AuthorityRole.GUEST;
}

export function mayRunLocalSimulation() {
  return isSimulationAuthority();
}
