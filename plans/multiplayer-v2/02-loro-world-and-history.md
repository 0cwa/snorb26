# Loro world and history model

## World document

The proposed materialized Loro schema is:

```text
WorldDoc
├── meta
│   ├── schemaVersion
│   ├── projectId
│   ├── mapId
│   ├── width
│   └── height
├── settings
├── terrainChunks
├── buildings
├── assets
├── cubes
└── paths
```

### Terrain

Terrain is stored in fixed binary chunks keyed by chunk coordinates:

```text
terrainChunks["3:5"] = Uint8Array(chunkWidth * chunkHeight)
```

One gesture writes every affected chunk at most once in one transaction.
Per-cell CRDT objects would be unnecessarily expensive. Additive counters are
not correct for smoothing, leveling, clamping, or edits whose result depends on
neighboring cells.

Chunk replacement remains safe while accepted advancement of a protected
timeline is serialized. Concurrent edits to the same parent produce sibling
history nodes instead of silently resolving by arrival order.

### Buildings and assets

Buildings use stable identities and deterministic occupancy:

```js
{
  id,
  cell,
  type,
  assetId
}
```

Assets map stable identifiers to validated URLs. Numeric custom-asset indexes
should not be authoritative because peer-local ordering can diverge.

### Cubes and paths

Initially store each authored cube or path as one compact record keyed by a
stable ID. Nested mergeable maps or movable lists are warranted only if true
simultaneous point-level editing becomes a product requirement.

## Projection rule

The active Loro document is authoritative. Existing arrays and indexes are
projections:

```text
validated Loro state
        ↓
elevations / buildingAt / object arrays
        ↓
worker synchronization and renderer buffers
```

Local edits follow the same direction:

```text
validated semantic intent
        ↓
Loro transaction and commit
        ↓
materialize affected state
        ↓
render and persist
```

No accepted durable edit may exist only in the typed arrays. A failed commit or
validation must leave the active world unchanged.

## History representation

Loro already maintains an append-only operation history. Snorb adds verified,
content-addressed envelopes and named heads around that history.

A history block should canonically bind:

```text
block format and schema version
parent content ID(s)
parent Loro frontier(s)
resulting Loro frontier
exact Loro update bytes/hash
author identity
timeline policy epoch
world/simulation tick
optional checkpoint content ID
human-readable edit metadata
nonce
author signature
```

The content ID is the hash of the canonical encoded block. Forks reference
shared ancestors and store only new deltas.

## Named timelines

A timeline is a signed reference, not a copied document:

```js
{
  timelineId,
  name,
  genesis,
  previousHead,
  head,
  policyId,
  revision,
  controllerSignature
}
```

Following means accepting valid future head declarations. Bouncing creates a
new timeline whose genesis references the node currently being viewed.

Concurrent children of one parent remain separate. An explicit merge creates a
new history block with the chosen parents; it never rewrites them.

## Historical viewing

Never detach or check out the live syncing document for UI preview. Instead:

1. Clone or fork the retained archive at the requested frontier.
2. Materialize the preview into isolated projection state.
3. Keep incoming live updates in the live document.
4. Discard the preview to return to live.
5. If the user edits the preview, create a new named timeline from that
   frontier.

## Incremental updates and persistence

- New peers receive a full validated Loro snapshot of the selected head.
- Returning peers provide a version vector and receive missing updates when
  compatible.
- Local update subscriptions or exports from a previous version vector produce
  incremental payloads.
- Persistence stores versioned snapshots and update segments in IndexedDB.
- Content-addressed blocks are shared across local forks.
- Named heads, bookmarks, unsent edits, and retention choices pin reachable
  blocks against garbage collection.
- Shallow snapshots or compaction must never discard history reachable from a
  retained named timeline without an explicit archival policy.

## Validation

Before an incoming update becomes visible:

1. Enforce byte, dependency, object-count, and pending-block limits.
2. Verify content hash and signature.
3. Verify parent availability and timeline policy.
4. Import into a temporary Loro document.
5. Validate roots, schema, dimensions, chunks, records, and URLs.
6. Materialize and calculate a durable-state fingerprint.
7. Persist the immutable block.
8. Atomically activate it only when the selected signed head accepts it.
