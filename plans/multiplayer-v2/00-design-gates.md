# Design gates before implementation

These decisions must be resolved before their dependent phases begin. They
override any roadmap wording that appears to assume an undecided format or
behavior.

## Gate A — Canonical signed encoding

Resolve before Phase 2 stores real history.

Avoid a circular definition between block IDs and signatures:

```text
payloadHash = SHA-256(domain || canonicalUnsignedPayload)
signature   = Sign(authorKey, domain || payloadHash)
envelopeId  = SHA-256(domain || payloadHash || signerId || signature)
```

The unsigned payload contains canonical, deterministically ordered parents,
frontiers, update hash, policy reference, checkpoint reference, tick, and
semantic metadata. The signature is outside that payload.

Choose and test one canonical binary encoding for blocks, policies, heads,
frontiers, and retention declarations. Phase 2 may use an explicitly temporary
local format only if it also defines migration before storing user history.

## Gate B — Loro writer identities

Resolve before multiple documents, tabs, devices, or forks can write.

- Every independent Loro writer gets a unique Loro peer ID.
- Persistent signing identity is not automatically reused as a Loro peer ID.
- Forks, restored documents, and concurrent tabs must not emit operations under
  the same writer identity.
- Tests must cover simultaneous tabs and fork/import behavior.

## Gate C — Timeline catalog format

Resolve at the start of Phase 2.

Choose between a separate small Loro catalog and standalone signed declarations.
Moving a named head must not advance or contaminate the world frontier it points
to. Record the migration and conflict semantics before persisting multiple
timelines.

## Gate D — Unauthorized automatic-fork identity

Resolve before authorization tests.

An automatically created fork needs deterministic rules:

- Controller: the editing player's persistent identity.
- ID: collision-resistant derivation from parent content ID, controller ID, and
  a nonce.
- Default name: local human-readable label plus a short stable suffix.
- Offline publication: signed blocks and head declarations remain in a durable
  outbox until peers acknowledge them.
- A rejected invalid edit is not converted into a fork; only valid work lacking
  advancement authority is preserved.

## Gate E — Trusted transfer envelopes

Resolve before Phase 3 networking.

Raw Loro snapshots or updates must not bypass history verification. Document
bytes travel inside a verified history/checkpoint envelope bound to:

- A trusted genesis and policy chain.
- The selected signed head.
- Parent dependencies.
- Expected content/update hashes.
- Schema and resource limits.

The wire protocol also needs explicit messages for genesis/policy retrieval,
block requests, missing dependencies, checkpoints, and signed head
announcements.

## Gate F — Finite bootstrap cutover

Resolve before the READY state can ship.

Bootstrap must converge on a finite cut:

1. Capture baseline `V0`.
2. Transfer and acknowledge `V0`.
3. Capture cutover head/version `H1/V1`.
4. Queue later live updates.
5. Transfer through `H1/V1`.
6. Require materialization acknowledgement of `H1/V1`.
7. Enter READY and drain the queued live suffix.

Changing the selected timeline or an unrecoverable dependency during sync
cancels and restarts bootstrap. A continuously moving head must not prevent
readiness indefinitely.

## Gate G — Transitional live simulation

Resolve before removing the current runtime snapshot path.

Phase 3 removes periodic durable-world snapshots only. Until branch checkpoints
and deterministic replay exist, retain or replace them with a bounded
runtime-only stream for lemmings and active effects. Terrain, buildings, assets,
and authored settings must not travel in that stream.

Add separate readiness and convergence criteria for:

- Durable Loro world state.
- Current live runtime view.
- Branch-time simulation checkpoint.

## Gate H — P2P topology after creator departure

Resolve before Phase 5 claims creator-independent serving.

Gossip alone is insufficient if all connections are host-and-spoke. Specify:

- Peer discovery after initial room join.
- Mesh or bounded partial-mesh connection rules.
- Deterministic duplicate-connection resolution.
- Reconnection and source selection.
- Limits preventing connection explosion.
- A late-join test that obtains history from a retainer after the original
  creator is gone.

## Gate I — Retention roster

Resolve before calculating `r/n`.

Define recognized member identity, admission, removal, expiry, partition
behavior, and stale/unknown declarations before implementing dimming. Raw swarm
connections never count toward `n`. Retention remains informational and cannot
grant authority or trigger another peer's garbage collection.

## Gate J — Phase-specific browser gates

Cross-engine and remote requirements apply when their feature first exists:

- Phase 0: Chromium local lifecycle; Firefox may remain diagnostic.
- Phase 1–2: cross-engine unit/local materialization and history where feasible.
- Phase 3: Chromium↔Firefox becomes required for durable sync.
- Phase 4–6: cross-engine signatures, forks, serving, and retention are required.
- Phase 7–8: cross-engine checkpoint/replay is required.
- Phase 9: remote forced-TURN is required before making real-network claims.

Each phase uses the applicable subset rather than treating every final release
gate as a prerequisite for early local work.
