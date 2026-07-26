import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const remoteBaseUrl = process.env.SNORB_BASE_URL?.trim();
const baseURL = remoteBaseUrl || 'http://127.0.0.1:4173/';

export default defineConfig({
  testDir: '.',
  testMatch: 'multiplayer.spec.js',
  timeout: 300_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: '../test-results',
  reporter: 'line',
  use: { baseURL },
  webServer: remoteBaseUrl
    ? undefined
    : [{
        command: 'python3 -m http.server 4173 --bind 127.0.0.1',
        cwd: repositoryRoot,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 15_000,
      }, {
        command: 'node tests/local-tracker.js',
        cwd: repositoryRoot,
        url: 'http://127.0.0.1:4174/health',
        reuseExistingServer: false,
        timeout: 15_000,
      }],
});
