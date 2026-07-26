# Multiplayer v2 planning

Status: design proposal. This folder records the intended direction and phased
work; it does not describe the current implementation as complete.

The central idea is to make Loro the authoritative durable-world model and its
history the basis of a peer-to-peer timeline graph. Every durable edit creates
an immutable child reality. Named timelines are signed pointers to accepted
heads, so players can follow a group, bounce into an independent timeline, view
or fork retained history, and control who may advance a timeline without
controlling who may see it.

## Documents

1. [Design gates](00-design-gates.md)
2. [Goals and decisions](01-goals-and-decisions.md)
3. [Loro world and history model](02-loro-world-and-history.md)
4. [P2P protocol and security](03-p2p-protocol-and-security.md)
5. [Timeline UX and retention](04-timeline-ux-and-retention.md)
6. [Simulation history](05-simulation-history.md)
7. [Current implementation seams](06-current-implementation.md)
8. [Implementation roadmap](TASKS.md)
9. [Testing strategy](TESTING.md)

## Short version

- Loro owns durable terrain, buildings, authored objects, assets, and settings.
- Existing typed arrays and renderer structures become projections of Loro.
- One gesture produces one Loro transaction and one immutable history node.
- A named timeline is a signed head pointer, not a mutable copy of the world.
- Following advances with the accepted head; bouncing creates a personal head
  from the exact node currently being viewed.
- Authorization controls advancement of a named timeline. It never prevents
  viewing or forking history already received.
- The first network protocol uses one reliable ordered channel, version-vector
  updates, explicit materialization acknowledgements, and bounded backpressure.
- P2P deletion means locally unpinning history, not erasing another peer's copy.
- Lemming history initially uses exact branch-time checkpoints. Deterministic
  fixed-tick replay is a later phase.

## Current implementation reality

The present multiplayer implementation has proved local signaling, WebRTC
DataChannels, and mutual authentication in two independent browser processes.
It has not completed durable state synchronization end to end. Loro currently
acts as an append-only command audit log, while separate full-world snapshots
remain the visible state path.

The current transport also has a known fragmented-message reassembly defect:
`Array.prototype.every` is used on a sparse chunk array, so the first received
chunk can incorrectly finalize and discard a multi-chunk message. Phase 0 fixes
and tests that defect before the architecture is replaced.

## Non-negotiable invariants

- A durable edit is committed to Loro before it is accepted or rendered.
- Received data is verified and validated in a temporary document before it can
  replace the visible world.
- "Connected" means the selected head was imported, materialized, and
  acknowledged—not merely that WebRTC or authentication succeeded.
- Trackers, relays, and whichever peer opened a connection have no timeline
  authority by virtue of that role.
- No peer can globally delete data another peer has already received.
- Unauthorized work is preserved as a fork rather than discarded.
- History is never rewritten; corrections, merges, and reversions create new
  history nodes.
