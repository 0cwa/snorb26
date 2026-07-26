# Implementation roadmap

Do not implement all phases together. Each phase must be green before expanding
the protocol. Check boxes represent planned work, not completed work.

## Phase 0 — Trustworthy transport and browser harness

Purpose: separate transport failures from synchronization failures.

- [ ] Replace sparse-array chunk completion with an explicit received count or
      bitmap.
- [ ] Test missing, out-of-order, duplicate, conflicting, invalid, oversized,
      and expired chunks.
- [ ] Keep the independent-browser harness transport-neutral.
- [ ] Preserve secret-free diagnostics and exact durable-state fingerprints.
- [ ] Prove baseline, one edit, dialog closure, stop hosting, and guest
      disconnect three consecutive times.

Exit criteria:

- No partial message is emitted.
- One valid fragmented message is emitted exactly once.
- Two independent browsers complete the existing lifecycle without page errors.

## Phase 1 — Loro v2 world adapter

- [ ] Specify schema and limits.
- [ ] Implement current-world → Loro migration.
- [ ] Implement validated Loro → projection materializer.
- [ ] Add chunked terrain and stable building/asset records.
- [ ] Route one gesture through one transaction.
- [ ] Fingerprint durable Loro state and materialized state.
- [ ] Persist/reload the new document without importing the old audit log as
      authority.

Exit criteria:

- Seed/materialize/reload preserves an exact durable-state fingerprint.
- Invalid documents cannot partially change the active world.
- Loro commits precede rendering and persistence.

## Phase 2 — Local history and multiple timelines

- [ ] Create immutable content-addressed history blocks.
- [ ] Add a persisted timeline catalog with `main`.
- [ ] Preview historical frontiers in isolated state.
- [ ] Return to live without disturbing incoming history.
- [ ] Fork from current and historical frontiers.
- [ ] Add follow/independent/bounce modes.
- [ ] Show exactly one `New timeline! 🕘` notification per durable gesture.

Exit criteria:

- A→B→C can be inspected at A/B and returned to C unchanged.
- Editing B creates D without altering C.
- Shared ancestry is not duplicated.
- Multiple timelines survive reload.

## Phase 3 — Reliable Loro synchronization

- [ ] Define the wire state machine and bounded envelope format.
- [ ] Use one reliable ordered DataChannel.
- [ ] Add baseline/update transfer and application-level acknowledgements.
- [ ] Validate and materialize in a temporary document.
- [ ] Exchange version vectors for reconnect.
- [ ] Queue/backpressure every durable send.
- [ ] Remove periodic full durable-world snapshots after this path is green.

Exit criteria:

- `Connected` appears only after exact frontier/materialization ACK.
- Baseline, edit-during-bootstrap, duplicate update, reconnect, reload, and stop
  all converge in independent browsers.

## Phase 4 — Signed identities, heads, and policies

- [ ] Add persistent Ed25519 player identities.
- [ ] Canonically encode and sign history blocks, genesis, heads, capabilities,
      policy changes, and revocations.
- [ ] Authenticate peers with signed challenges.
- [ ] Validate authority at the proposed parent/policy epoch.
- [ ] Make unauthorized or stale-authority work fork automatically.
- [ ] Surface competing signed heads as branches/equivocation.

Exit criteria:

- Tracker/relay/connection host cannot forge timeline authority.
- Tampering and replay cannot advance a head.
- Revoked peers cannot advance the protected name but can still fork.

## Phase 5 — Multi-peer P2P follow and serving

- [ ] Gossip verified heads and content availability.
- [ ] Bootstrap from any retaining peer.
- [ ] Support three or more peers following one timeline.
- [ ] Support bounce, independent editing, and return.
- [ ] Keep serving authority separate from editing authority.

Exit criteria:

- One of three peers can bounce without changing the other two.
- A late peer can join through a non-controller retainer.
- Original room creator can disconnect without destroying retained history.

## Phase 6 — Retention, unpinning, and dimming

- [ ] Add signed monotonic retention declarations.
- [ ] Implement `follow`, `keep-through`, and `none`.
- [ ] Calculate dependency-safe local garbage collection.
- [ ] Add a grace period and last-retainer warning.
- [ ] Show `r/n copies pledged` separately from online sources.
- [ ] Dim decorative timeline treatment by `r/n`.
- [ ] Define recognized-roster and expiry rules.

Exit criteria:

- One peer's unpin never removes another peer's copy.
- Shared ancestry and bookmarks remain pinned.
- Re-pinning recovers from another source when available.
- Sybil swarm connections cannot alter the trusted denominator.

## Phase 7 — Exact branch-time `SimulationState`

- [ ] Inventory and serialize all worker/runtime state.
- [ ] Define bounded binary structure-of-arrays checkpoint format.
- [ ] Tie checkpoints to simulation tick and Loro frontier.
- [ ] Capture/reference a checkpoint at branch creation.
- [ ] Restore without resetting or duplicating entities.
- [ ] Define deterministic terrain/object reconciliation.
- [ ] Transfer, validate, persist, and acknowledge checkpoint blocks.

Exit criteria:

- Same-runtime round trip is exact.
- Timelines match through their branch tick.
- Changed terrain applies one documented reconciliation rule.

## Phase 8 — Deterministic simulation replay

- [ ] Introduce fixed simulation ticks.
- [ ] Replace simulation randomness with a seeded PRNG.
- [ ] Stabilize IDs, ordering, and numeric rules.
- [ ] Log external events and world-frontier changes.
- [ ] Add periodic hashes and correction checkpoints.
- [ ] Test long replay across Chromium and Firefox.

Exit criteria:

- Same checkpoint and event suffix produce identical hashes.
- Divergence is detected at a deterministic tick and recoverable.

## Phase 9 — TURN and real-network validation

- [ ] Preserve the collapsed TURN disclosure and settings persistence.
- [ ] Require relay-only success before sharing TURN configuration.
- [ ] Tie the green verification indicator to the exact tested configuration.
- [ ] Prefer short-lived credentials.
- [ ] Add Chromium↔Firefox tests across separate networks using forced relay.
- [ ] Cover follow, fork, non-controller serving, reconnect, and stop.

Exit criteria:

- Forced relay carries the complete lifecycle.
- Unverified/expired TURN configuration is never shared as verified.
- Closing multiplayer UI does not affect transport.
- No artifact leaks SDP, keys, credentials, or complete invites.

## Dependency map

```text
0 harness
└── 1 Loro world
    └── 2 local timelines
        └── 3 reliable sync
            └── 4 signatures/policy
                └── 5 multi-peer P2P
                    └── 6 retention

1 + 2 ── 7 SimulationState ── 8 deterministic replay
3 + 4 + 5 ── 9 real-network/TURN validation
```
