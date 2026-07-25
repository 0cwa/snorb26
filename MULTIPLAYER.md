# Multiplayer MVP architecture

Implementation is intentionally phased. Phase 1 establishes ownership boundaries only; it does not include Loro or networking.

## Authority

The room creator is the fixed simulation host. Single-player follows the same authoritative path as a host. A guest must not run or commit local worker simulation output. `authority.js` is the policy seam used by `workerClient.js` to enforce this rule.

| State | Owner | Persistence / transfer |
| --- | --- | --- |
| Terrain, buildings, cubes, paths, map settings | Host-authoritative map | Map file/local map storage; later semantic Loro edits |
| Lemmings and simulation-affecting settings | Host simulation | Map/local save and later transient host snapshots; never periodic Loro writes |
| Worker events, timing, and hidden effects | Host runtime | Transient only |
| Camera, brush, selection, active tools, view flags, notifications | Each browser | `snorb_local_preferences_v1` where applicable; never map/shared payloads |

## Payload boundary

`state.js::serializeMap()` emits format version 3, the authoritative map payload. It excludes camera, brush, selection, tools, and view/UI preferences. `deserializeMap()` ignores those fields in legacy files, preventing imported or future shared data from moving a user's camera or changing local UI.

`localState.js` owns the separate local-preference codec and one-time migration from an existing browser's version 2 local save. Uploaded files never use that migration path.

## Deferred phases

1. Loro semantic command log for durable human edits.
2. Loopback host snapshots and guest rendering without guest simulation.
3. Binary transport abstraction.
4. WebRTC DataChannels and tracker-based signaling.
5. Room UI, invite capability, validation, and safety limits.

Host migration, deterministic distributed simulation, remote map storage, incremental snapshots, optimistic guest edits, TURN provisioning, and alternate transports remain out of scope for the MVP.
