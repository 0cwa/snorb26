# Multiplayer MVP architecture

Implementation is intentionally phased. Phase 1 established ownership boundaries. Phase 2 adds a browser-local Loro semantic history; networking is still disabled.

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

## Loro semantic history

`multiplayer/loroCommandLog.js` owns a vendored Loro 1.13.8 document with two roots:

- `metadata`: schema version only.
- `commands`: append-only JSON strings containing canonical semantic command records.

Current durable commands are `terrain.raise`, `terrain.smooth`, `terrain.level`, `building.place`, and `building.remove`. Brush gestures append all samples in one Loro commit. Buildings use stable IDs; random forest choices are resolved into explicit place commands before logging.

The command schema rejects unknown fields, including terrain/building arrays. Loro never contains camera/UI state, worker state, lemmings, simulation snapshots, or full map arrays. The binary Loro snapshot is persisted locally in IndexedDB to retain merge history; it is not remote map storage.

## Host simulation snapshots

Phase 3 adds full binary snapshots (`snapshotCodec.js`) with strict dimensions, entity counts, byte lengths, host epoch, sequence, and durable-command watermark validation. Terrain and building grids remain `Uint8Array` bytes and are never base64 encoded. `SnapshotPublisher` emits at 4 Hz by default (configurable up to 8 Hz); `SnapshotReceiver` rejects stale or wrong-epoch data before applying it. The in-memory loopback copies bytes to exercise the same host/guest boundary locally.

Workers are created lazily. Guests do not create/run a worker or advance authoritative game time.

## Transport and protocol seam

Phase 4 defines `MultiplayerTransport` with reliable and transient binary channels, handler registration, backpressure reporting, and lifecycle methods. Session code can use the in-memory loopback pair or a later WebRTC adapter without knowing the concrete transport.

Every message uses a validated binary `SNRB` frame carrying protocol version, kind, room ID, host epoch, sequence, and byte payload. Reliable command/Loro payloads and transient snapshots have separate limits. Text transport payloads are rejected.

## WebRTC and tracker discovery

Phase 5 adds native `RTCPeerConnection` transport with reliable ordered command/Loro traffic and unordered, zero-retransmit snapshot traffic. Large binary messages are bounded and split into 16 KiB DataChannel chunks with all-or-nothing reassembly and expiry. Backpressure drops stale transient snapshots.

Room capabilities use 128-bit room IDs and 256-bit secrets in the URL fragment only. The tracker swarm `info_hash` is a domain-separated SHA-256 derivation, so neither the static host nor tracker receives the secret. `trackerClient.js` implements WebTorrent-compatible WSS announce offer/answer signaling directly; it does not torrent map data. No TURN or host migration is provided.

## Deferred phases

6. Room UI, invite capability, validation, and safety limits.

Host migration, deterministic distributed simulation, remote map storage, incremental snapshots, optimistic guest edits, TURN provisioning, and alternate transports remain out of scope for the MVP.
