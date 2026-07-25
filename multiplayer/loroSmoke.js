import {
  appendLoroTransaction,
  exportLoroSnapshot,
  getLoggedCommands,
  initializeLoroCommandLog,
} from './loroCommandLog.js';

const result = document.getElementById('result');
try {
  await initializeLoroCommandLog('00000000000000000000000000000001');
  const marker = `smoke-${Date.now()}`;
  await appendLoroTransaction([{
    v: 1,
    commandId: marker,
    actorId: 'browser-smoke',
    sequence: 1,
    command: { type: 'terrain.raise', x: 1, y: 1, radius: 1, delta: 1 },
  }]);
  const bytes = await exportLoroSnapshot();
  const commands = await getLoggedCommands();
  if (!(bytes instanceof Uint8Array) || !commands.some(entry => entry.commandId === marker)) {
    throw new Error('Loro binary round-trip failed');
  }
  result.textContent = `passed:${bytes.byteLength}`;
  document.documentElement.dataset.status = 'passed';
  console.info(`LORO_SMOKE_PASSED:${bytes.byteLength}`);
} catch (error) {
  console.error(error);
  result.textContent = `failed:${error.message}`;
  document.documentElement.dataset.status = 'failed';
  console.error(`LORO_SMOKE_FAILED:${error.message}`);
}
