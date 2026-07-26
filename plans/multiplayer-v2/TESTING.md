# Testing strategy

## Principles

- Test one layer at a time before combining it with ICE/TURN.
- Browser tests use genuinely separate browser processes and profiles.
- Assert document frontiers, durable-state fingerprints, and rendered state—not
  UI labels alone.
- A peer is ready only after import, validation, materialization, persistence,
  and acknowledgement.
- Keep diagnostics secret-free.
- Preserve mDNS/privacy protections outside the loopback-only test environment.

## Test matrix

| Capability | Unit | Local integration | Two browsers | Three peers | Cross-engine | Remote/TURN |
|---|---:|---:|---:|---:|---:|---:|
| Fragment reassembly/limits | Required | Required | Required | — | — | — |
| Loro import/materialization | Required | Required | Required | — | Required | — |
| Historical checkout/fork | Required | Required | Required | Required | Required | — |
| Baseline/update/ACK | Required | Required | Required | Required | Required | Required |
| Version-vector reconnect | Required | Required | Required | Required | Required | Required |
| Signed peer authentication | Required | — | Required | Required | Required | Required |
| Capability/revocation | Required | Required | Required | Required | — | Required |
| Unauthorized edit → fork | Required | Required | Required | Required | Required | Required |
| Competing-head visibility | Required | Required | Required | Required | — | — |
| Non-controller serving | Required | — | — | Required | Required | Required |
| Retention/unpin/GC | Required | Required | — | Required | — | — |
| Retention dimming/roster | Required | Required | — | Required | — | — |
| SimulationState round-trip | Required | Required | Required | — | Required | — |
| Checkpoint branch continuity | Required | Required | Required | Required | Required | Required |
| Deterministic replay | Required | Required | Required | Required | Required | Stress |
| TURN invite gating | Required | Mocked | — | — | — | Required |
| Full lifecycle | — | — | Required | Required | Required | Required |

## Phase-0 transport cases

- Complete single- and multi-chunk messages.
- Out-of-order chunks.
- Duplicate chunks.
- Missing first, middle, and final chunks.
- Conflicting IDs/counts/totals.
- Oversized payload and assembly reservations.
- Timeout and expired-ID cleanup.
- Exactly-once delivery.
- Backpressure and closed-channel send failure.

## Core browser lifecycle

1. Load both browsers with WebGL2.
2. Create or discover a timeline.
3. Authenticate identities.
4. Transfer and acknowledge the selected head.
5. Compare Loro frontier, durable fingerprint, and rendered fingerprint.
6. Commit one host/controller edit and compare again.
7. Submit one authorized remote edit and verify its committed result.
8. Submit one unauthorized edit and verify automatic fork.
9. Close multiplayer UI and prove the session remains active.
10. Disconnect/reconnect by known version.
11. Stop the session and verify the expected peer state.

## Timeline cases

- A→B→C preview A/B and return to C.
- Edit B to create D while C remains intact.
- Bounce from current head and return to followed head.
- Concurrent siblings remain addressable regardless of arrival order.
- Duplicate blocks/imports remain idempotent.
- Missing/corrupt block leaves active timeline unchanged.
- Head equivocation is visible and does not silently choose by arrival time.
- Reload preserves timelines, identity, policies, pins, and pending outbox.

## Retention cases

- `keep-through(C)` collects only unreferenced descendants.
- Another local branch/bookmark prevents collection of shared blocks.
- One peer's collection cannot affect another peer.
- Re-pinning retrieves verified blocks from a serving peer.
- `r/n` display changes by exactly one step per recognized withdrawal.
- Offline retention promise and online availability display separately.
- Fake/unrecognized connections do not change the denominator.
- Zero known retainers produces a warning without hiding metadata.

## Simulation cases

- Pack/unpack every `SimulationState` field exactly.
- Branch preserves entity identity and ordering.
- Both branches match through the branch tick.
- Terrain intersection uses one deterministic reconciliation.
- Checkpoint hash mismatch is rejected before activation.
- Cross-engine fixed-tick replay hashes match when deterministic replay lands.
- A signed correction checkpoint restores a deliberately diverged follower.

## Safe diagnostics

Browser-level failures may capture:

- Selected timeline and content hashes.
- Protocol phase.
- Authentication result and policy epoch.
- Last sent/acknowledged Loro version.
- Materialized durable-state fingerprint.
- Pending block/assembly counts and bounded byte totals.
- Aggregate tracker/relay counts.
- Sanitized room event messages.
- Masked screenshots.

Never capture:

- SDP.
- ICE candidate addresses.
- Private keys or room secrets.
- TURN credentials.
- Complete invite fragments.
- Full world/history payloads unless the test explicitly writes a local,
  non-shared fixture.

## Release gates

- Unit and local integration suites pass.
- Required browser lifecycle passes three consecutive times.
- No uncaught page or console errors.
- Chromium and Firefox pass the required cross-engine lane.
- Remote release claims require a forced-TURN run across separate networks.
- A phase is not considered complete because UI labels changed; convergence and
  acknowledgement invariants must pass.
