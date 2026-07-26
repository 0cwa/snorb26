import { test, expect, chromium, firefox } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const CONNECT_TIMEOUT = 60_000;
const localTrackerUrl = process.env.SNORB_BASE_URL ? null : 'ws://127.0.0.1:4174/announce';
const chromiumLaunchOptions = localTrackerUrl ? {
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
} : {};

function redact(value) {
  return String(value)
    .replace(/#[^\s"']+/g, '#[redacted]')
    .replace(/(room|key|host|hostKey|turnCredential)=[^&\s]+/gi, '$1=[redacted]');
}

function safeRequestUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid URL]';
  }
}

function observePage(page, name) {
  const events = [];
  page.on('console', message => {
    if (message.type() === 'error') events.push({ type: 'console', text: redact(message.text()) });
  });
  page.on('pageerror', error => events.push({ type: 'pageerror', text: redact(error.message) }));
  page.on('requestfailed', request => events.push({
    type: 'requestfailed',
    text: `${safeRequestUrl(request.url())}: ${redact(request.failure()?.errorText || 'unknown')}`,
  }));
  return { name, events };
}

async function assertSnorbLoaded(page, baseURL) {
  const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `Snorb document failed with HTTP ${response?.status()}`).toBe(true);
  await page.waitForFunction(() => Boolean(window.snorb?.state?.elevations));
  await expect(page.locator('#scene')).toBeVisible();
  expect(await page.locator('#scene').evaluate(canvas => Boolean(canvas.getContext('webgl2'))), 'WebGL2 must be available').toBe(true);
  await expect(page.locator('#multiplayerIndicator')).toHaveText('Multiplayer: Single-player');
}

async function attachFailureArtifacts(testInfo, peers) {
  const trackerStats = localTrackerUrl
    ? await fetch('http://127.0.0.1:4174/health', { signal: AbortSignal.timeout(2_000) })
      .then(response => response.json())
      .catch(() => null)
    : null;
  for (const peer of peers) {
    if (!peer.page || peer.page.isClosed()) continue;
    const roomEvents = await peer.page.locator('#roomEventLog > li').evaluateAll(items => items.slice(-100).map(item => ({
      level: item.dataset.level || 'info',
      text: item.textContent || '',
    }))).catch(() => []);
    const status = await peer.page.locator('#roomStatus').textContent({ timeout: 2_000 }).catch(() => null);
    const diagnostic = {
      browser: peer.name,
      status: redact(status || ''),
      roomEvents: roomEvents.map(entry => ({ ...entry, text: redact(entry.text) })),
      browserEvents: peer.events,
      trackerStats,
    };
    const diagnosticPath = testInfo.outputPath(`${peer.name}-diagnostics.json`);
    await writeFile(diagnosticPath, JSON.stringify(diagnostic, null, 2));
    await testInfo.attach(`${peer.name}-diagnostics`, {
      path: diagnosticPath,
      contentType: 'application/json',
    });
  }
}

async function terrainFingerprint(page) {
  return page.evaluate(() => {
    const { GRID_W, GRID_H, elevations } = window.snorb.state;
    const index = Math.floor(GRID_H / 2) * GRID_W + Math.floor(GRID_W / 2);
    let hash = 2166136261;
    for (const elevation of elevations) hash = Math.imul(hash ^ elevation, 16777619) >>> 0;
    return { index, value: elevations[index], hash };
  });
}

test('host and guest complete a multiplayer lifecycle', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const guestBrowserType = process.env.SNORB_GUEST_BROWSER === 'firefox' ? firefox : chromium;
  const guestBrowserName = guestBrowserType === firefox ? 'guest-firefox' : 'guest-chromium';
  let hostBrowser;
  let guestBrowser;
  let hostContext;
  let guestContext;
  const peers = [];

  try {
    [hostBrowser, guestBrowser] = await Promise.all([
      chromium.launch(chromiumLaunchOptions),
      guestBrowserType.launch(guestBrowserType === chromium ? chromiumLaunchOptions : undefined),
    ]);
    [hostContext, guestContext] = await Promise.all([
      hostBrowser.newContext(),
      guestBrowser.newContext(),
    ]);
    const [host, guest] = await Promise.all([
      hostContext.newPage(),
      guestContext.newPage(),
    ]);
    peers.push(
      { page: host, ...observePage(host, 'host-chromium') },
      { page: guest, ...observePage(guest, guestBrowserName) },
    );

    await Promise.all([
      assertSnorbLoaded(host, baseURL),
      assertSnorbLoaded(guest, baseURL),
    ]);
    console.log('[browser-test] both browsers loaded with WebGL2');

    await host.locator('#multiplayerIndicator').click();
    await expect(host.locator('#roomDialog')).toHaveAttribute('open', '');
    if (localTrackerUrl) {
      await host.locator('.room-network-settings > summary').click();
      await host.locator('#roomTracker').fill(localTrackerUrl);
    }
    await host.locator('#hostRoomBtn').click();
    await expect(host.locator('#roomInviteOutput')).not.toHaveValue('');
    const invite = await host.locator('#roomInviteOutput').inputValue();
    const inviteUrl = new URL(invite);
    expect(inviteUrl.origin).toBe(new URL(baseURL).origin);
    const inviteParams = new URLSearchParams(inviteUrl.hash.slice(1));
    for (const key of ['room', 'key', 'host', 'hostKey', 'tracker']) {
      expect(inviteParams.has(key), `Invite is missing ${key}`).toBe(true);
    }
    if (localTrackerUrl) expect(inviteParams.getAll('tracker')).toEqual([localTrackerUrl]);
    console.log('[browser-test] host created a valid invite');

    await guest.locator('#multiplayerIndicator').click();
    await guest.locator('#roomInviteInput').fill(invite);
    await guest.locator('#joinRoomBtn').click();
    await expect(guest.locator('#roomInviteState')).toHaveText('Invite ready.');
    console.log('[browser-test] guest loaded the invite and started joining');

    await Promise.all([
      expect(host.locator('#multiplayerIndicator')).toHaveText('Multiplayer: Hosting · 1 peer', { timeout: CONNECT_TIMEOUT }),
      expect(guest.locator('#multiplayerIndicator')).toHaveText('Multiplayer: Connected', { timeout: CONNECT_TIMEOUT }),
    ]);
    console.log('[browser-test] both peers authenticated');
    await expect(host.locator('#roomStatus')).toHaveText('Peer authenticated');
    await expect(guest.locator('#roomStatus')).toHaveText('Peer authenticated');

    await host.locator('#closeRoomBtn').click();
    expect(await host.locator('#roomDialog').evaluate(dialog => dialog.open)).toBe(false);
    await expect(host.locator('#multiplayerIndicator')).toHaveText('Multiplayer: Hosting · 1 peer');

    const hostTerrainBefore = await terrainFingerprint(host);
    await expect.poll(
      () => terrainFingerprint(guest),
      { timeout: 10_000, intervals: [100, 250, 500] },
    ).toEqual(hostTerrainBefore);

    let terrainChange = null;
    await expect.poll(async () => {
      if (terrainChange) return true;
      terrainChange = await host.evaluate(() => {
        const { GRID_W, GRID_H, elevations } = window.snorb.state;
        const x = Math.floor(GRID_W / 2);
        const y = Math.floor(GRID_H / 2);
        const index = y * GRID_W + x;
        const before = elevations[index];
        const delta = before >= 254 ? -1 : 1;
        const result = window.snorb.tools.brushApplyDelta(x, y, delta);
        return result?.applied ? { index, before, delta, after: elevations[index] } : null;
      });
      return Boolean(terrainChange);
    }, { timeout: 10_000, intervals: [100, 250, 500] }).toBe(true);

    const hostTerrain = await terrainFingerprint(host);
    expect(terrainChange).not.toBeNull();
    expect(terrainChange.after).toBe(terrainChange.before + terrainChange.delta);
    expect(hostTerrain.value).toBe(terrainChange.after);
    expect(hostTerrain.hash).not.toBe(hostTerrainBefore.hash);
    await expect.poll(
      () => terrainFingerprint(guest),
      { timeout: 10_000, intervals: [100, 250, 500] },
    ).toEqual(hostTerrain);
    console.log('[browser-test] terrain synchronized to guest');

    await host.locator('#multiplayerIndicator').click();
    await expect(host.locator('#leaveRoomBtn')).toHaveText('Stop hosting');
    await host.locator('#leaveRoomBtn').click();
    await expect(host.locator('#multiplayerIndicator')).toHaveText('Multiplayer: Single-player');
    await expect(guest.locator('#multiplayerIndicator')).toHaveText('Multiplayer: Reconnect needed', { timeout: 40_000 });

    for (const peer of peers) {
      expect(
        peer.events.filter(event => event.type === 'pageerror' || event.type === 'console'),
        `${peer.name} emitted an uncaught or console error`,
      ).toEqual([]);
    }
  } catch (error) {
    await attachFailureArtifacts(testInfo, peers);
    throw error;
  } finally {
    await Promise.allSettled([hostContext?.close(), guestContext?.close()]);
    await Promise.allSettled([hostBrowser?.close(), guestBrowser?.close()]);
  }
});
