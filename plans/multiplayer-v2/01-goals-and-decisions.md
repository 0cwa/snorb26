# Goals and decisions

## Product goals

The design should let players:

- Join and remain with a group's current timeline.
- Bounce away at any retained point and control their own future.
- Scroll through retained map history and return to live state safely.
- View and fork history even when they cannot edit the named timeline.
- Share and serve timelines without a mandatory authoritative server.
- Stop storing a history suffix without pretending to delete other copies.
- Understand both social retention and current network availability.
- Preserve lemming continuity when a timeline branches.

## Decided architecture

### Loro is the durable source of truth

Loro owns durable authored world state. The renderer, worker typed arrays, and
indexes are deterministic projections. The current append-only JSON command
list is not sufficient because imported commands are not currently materialized
into the guest world.

### History nodes and timeline names are separate

A history node is an immutable, content-addressed Loro change/frontier with
verified metadata. A named timeline is a signed pointer to an accepted history
node. This separation permits shared ancestry, multiple named futures, safe
historical viewing, and explicit controller policy.

### Every durable gesture creates history

One completed brush gesture, building operation, settings change, or confirmed
batch should normally create:

1. One Loro transaction.
2. One immutable history node.
3. One `New timeline! 🕘` notification.

Raw pointer events, camera changes, animation frames, and other local or
ephemeral actions are not history nodes.

### Host authority is transitional

The first implementation may serialize accepted durable edits through the
current room creator, but the data model and signatures must not equate
connection host with timeline authority. In the target design, authority comes
from timeline controller keys and signed capabilities.

### Durable sync starts with one reliable channel

The first correct protocol uses one reliable ordered DataChannel. It transfers a
validated baseline or missing Loro updates and waits for an application-level
acknowledgement after materialization. Optimization is deferred until this path
passes consistently.

### Runtime simulation is not CRDT churn

Lemming movement, timers, effects, game time, and other high-frequency runtime
state do not enter Loro every frame. Branch-time simulation checkpoints preserve
continuity initially; seeded deterministic replay is a later project.

## State ownership

### Durable shared Loro state

- Map identity, dimensions, and schema version.
- Terrain.
- Buildings and stable building identities.
- Validated custom assets.
- Authored cubes and paths/extrusions.
- Water level and durable simulation rules.
- Timeline-related references to simulation checkpoints.

### Host/timeline runtime state

- Game time and current simulation tick.
- Lemmings and their behavioral state.
- Volcanoes, earthquakes, shockwaves, and other active effects.
- Runtime-generated additions and worker accumulators.
- Current play/pause control if treated as a session control.

### Browser-local state

- Camera, selection, brush, and active tool.
- View flags and notification preferences.
- Pointer/gesture state.
- Dialog state.
- Historical preview state before it is explicitly forked.

## Explicitly deferred

- Automatic semantic merging of conflicting terrain edits.
- Threshold-controlled timelines.
- Global public timeline discovery.
- Proof of storage.
- Guaranteed availability without willing retainers.
- Global deletion of previously shared data.
- Exact long-range simulation replay before deterministic simulation exists.
- Optimizing away the reliable channel before correctness is established.

## Open decisions

- Use 16×16 or 32×32 terrain chunks after measuring update size and redraw cost.
- Store signed heads in a small Loro catalog or as standalone signed,
  content-addressed declarations.
- Define roster membership and expiry for retention dimming.
- Define timeline naming collisions and explicit merge UX.
- Define storage quotas, checkpoint cadence, and unpin grace periods.
- Define collision reconciliation when a historical terrain edit intersects a
  lemming checkpoint.
