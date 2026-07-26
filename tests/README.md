# Browser multiplayer test

The Playwright smoke test launches two browser instances as separate processes
and profiles. It covers WebGL2 startup, authentication, host-to-guest terrain
synchronization, background hosting while the room dialog is closed, and
explicit host shutdown. A failing lifecycle assertion is a regression signal, not
a reason to skip the test.

The local Chromium processes disable WebRTC host-candidate mDNS obfuscation so
their separate profiles can reach each other directly without requiring a test
TURN service. Signaling stays on a loopback-only test tracker, so local
candidates and SDP are not sent outside the machine. These launch-only settings
do not affect production browsers.

Prerequisites are Node.js 20 or newer, npm, and Python 3 for the local static
server. Install dependencies and the workspace-local browser builds once:

```sh
npm install
```

Then install the browsers:

```sh
npm run test:browser:install
```

Run against a local static server managed by Playwright:

```sh
npm run test:browser
```

Chromium-to-Firefox interoperability can be exercised separately. This lane is
more sensitive to the host network and generally needs a verified TURN relay:

```sh
SNORB_GUEST_BROWSER=firefox npm run test:browser
```

To exercise a remote deployment instead of starting the local server:

```sh
SNORB_BASE_URL=https://example.test/snorb/ npm run test:browser
```

Local runs use the loopback tracker in `local-tracker.js`. Remote runs use the
tracker configured by Snorb, so tracker or ICE outages can fail their connection
stage. Sanitized per-browser JSON diagnostics are written beneath `test-results/`
on failure. The harness does not create or retain screenshots in the repository.
Invite secrets and raw WebSocket frames are not logged.
