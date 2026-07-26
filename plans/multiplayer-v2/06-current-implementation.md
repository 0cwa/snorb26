# Current implementation seams

This document maps the target design to current code. It is not a claim that the
target behavior already works.

## Evidence so far

The independent-browser harness has proved:

- Two separate Chromium processes can load Snorb with WebGL2.
- A loopback WebTorrent-compatible tracker can relay one offer and answer.
- WebRTC DataChannels can connect.
- Host and guest can mutually authenticate.
- Hosting can continue while the multiplayer dialog is closed.

It has not proved:

- Initial durable-world convergence.
- Subsequent terrain or object convergence.
- Successful reconnect and stop lifecycle after synchronized play.
- Public tracker behavior.
- TURN across separate networks.
- Chromium↔Firefox multiplayer.

The first terrain baseline failed because large snapshot messages never reached
the receiver. The immediate defect is in
`multiplayer/webrtcTransport.js`: chunk storage uses a sparse array and
`chunks.every(Boolean)`, which skips holes and can treat the first chunk as
completion. Phase 0 repairs and tests this as a harness prerequisite, not as an
endorsement of the old snapshot architecture.

## Code migration map

### `multiplayer/loroCommandLog.js`

Current role:

- Stores an append-only list of JSON semantic command records.
- Re-exports complete Loro snapshots.
- Validates and persists imported records.

Target role:

- Replace with a versioned world-document adapter, materializer, update store,
  history-block store, and timeline catalog.
- Use Loro's own operation history and version vectors rather than a second
  canonical command list.

### `multiplayer/commandBus.js` and `multiplayer/semanticCommands.js`

Retain semantic validation, gesture transaction boundaries, atomic preview
logic, stable identifiers, and request limits. Change the flow so validated
edits commit into Loro first, materialize affected projections second, and
produce one history node and notification per durable gesture.

### `multiplayer/sessionController.js`

Current role:

- Combines authentication, Loro snapshot exchange, guest commands, and 4 Hz
  full-world simulation snapshots.
- Treats authentication as connected.
- Ignores some transport send failures.

Target role:

- Explicit authenticate → sync → materialize → acknowledge → ready state
  machine.
- Signed timeline/head validation.
- Bounded reliable queues and reconnect by version.
- Separate durable history sync from optional runtime checkpoints.

### `multiplayer/protocol.js`

- Add versioned message families for discovery, sync, document/history transfer,
  acknowledgements, signed heads, retention, and errors.
- Keep strict per-kind limits and canonical signed encodings.
- Bind transfer IDs and expected hashes to acknowledgements.

### `multiplayer/webrtcTransport.js`

Near-term:

- Fix sparse-array fragmented-message completion.
- Test reassembly, cleanup, limits, exactly-once delivery, and backpressure.

Target:

- Start with one reliable ordered DataChannel.
- Keep bounded fragmentation only where browser message-size portability
  requires it.
- Check every send result.

### `multiplayer/snapshotCodec.js` and `multiplayer/snapshotFlow.js`

Durable terrain, objects, and settings move to Loro. Snapshot code narrows to
versioned branch-time runtime checkpoints and, later, small correction
checkpoints.

### `state.js`

Retain map import/export as the user-facing file boundary and typed structures
as efficient projections. Add explicit current-map → Loro seeding, validated
Loro → projection materialization, and stable durable-state fingerprints.

### `tests/`

Keep separate processes/profiles, loopback-only local signaling, secret-free
artifacts, and exact fingerprints. Expand assertions to Loro frontiers and
materialized durable state. Add three-peer, cross-engine, and forced-TURN lanes
only when their respective phases require them.

## Required technical spikes

- Measure 16×16 versus 32×32 terrain chunks.
- Confirm binary map-value performance in the vendored Loro version.
- Choose canonical encodings for signed blocks, policies, heads, and frontiers.
- Measure one-gesture update sizes and browser DataChannel limits.
- Define player identity backup and key rotation.
- Inventory every hidden worker field required for exact `SimulationState`.
