# Simulation history

## Why trajectories alone are insufficient

Lemming movement is not a simple path function. It depends on terrain and
object collisions, other lemmings, births and deaths, relationships, resources,
digging and raising, disasters, random choices, hidden timers, and runtime
effects.

Vectors, splines, or polynomial trajectories can be disposable preview caches,
but they cannot be authoritative simulation history. A tensor is useful as a
compact state layout, not as the transition rule.

The useful model is:

```text
S(t + 1) = F(S(t), world frontier at t, ordered events, seeded randomness)
```

## First implementation: branch-time checkpoints

Preserve the current visual behavior initially:

1. Extract a complete serializable `SimulationState`.
2. At every durable edit or explicit timeline fork, capture or reference the
   exact simulation checkpoint for that tick.
3. Bind the checkpoint content ID and world frontier into the history block.
4. Restore the checkpoint when entering the branch.
5. Continue running the current worker.

Movement is identical through the branch tick. The new timeline diverges only
after its changed world or events affect the simulation.

## Checkpoint contents

Use a versioned, bounded, content-addressed binary structure-of-arrays format:

- Stable ordered lemming identities.
- Positions, directions, speeds, colors, and ages.
- Relationships, parents, partners, targets, and resources.
- Behavioral flags and all timers/accumulators.
- Digging, raising, dancing, thinking, stress, swimming, lava, and related
  state.
- Simulation tick and simulation time.
- PRNG algorithm and internal state once introduced.
- Active volcanoes, earthquakes, shockwaves, and other hidden effects.
- Runtime simulation settings.
- Mutable cube additions and their timing.
- The exact Loro world frontier plus any simulation-produced durable mutations.

The existing multiplayer snapshot does not capture all hidden worker state and
therefore is not an exact branch-restoration format.

## Terrain reconciliation

An edit at the branch tick may place a lemming inside changed terrain or remove
support under it. The format must record a deterministic reconciliation rule.
The initial rule should be simple, explicit, and tested—for example, move to the
nearest valid position within a bounded radius or mark the entity for the
existing fall/collision path. Do not let browsers choose independently.

## Later implementation: deterministic replay

To reduce checkpoint frequency:

- Advance simulation on a fixed tick.
- Replace every simulation `Math.random()` with a centralized seeded PRNG.
- Use stable entity IDs and explicit event ordering.
- Define stable numeric or quantization rules where cross-engine floating-point
  differences can accumulate.
- Record external inputs and world-frontier changes.
- Produce periodic hashes.
- Retain occasional signed correction checkpoints.

Then a branch can usually store:

```text
nearest checkpoint
+ Loro world frontier
+ PRNG state
+ ordered event suffix
```

Rendering may interpolate between fixed ticks, preserving smooth motion without
making display frames part of authoritative history.

## Acceptance criteria

- Packing and restoring `SimulationState` in one runtime is exact.
- Branching does not reset, duplicate, or reorder lemmings.
- Old and new timelines match through the branch tick.
- A map edit applies the documented reconciliation rule identically.
- Checkpoints are content-addressed, deduplicated, bounded, and verified before
  use.
- A peer acknowledges the checkpoint and selected world frontier before
  displaying the live branch.
- Later deterministic replay produces stable hashes in Chromium and Firefox and
  can recover from a signed correction checkpoint.
