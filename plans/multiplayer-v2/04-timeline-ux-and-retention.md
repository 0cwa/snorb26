# Timeline UX and retention

## Core interaction model

```text
A ── B ── C ── D       Group timeline → D
      └── E ── F        Alice's timeline → F
          └── G         Experiment → G
```

- **Follow** subscribes to a named timeline's valid signed head.
- **Independent** keeps the selected local head without automatically following
  another timeline.
- **Bounce to my own timeline** creates a controlled timeline at the node being
  viewed and switches to it.
- **Edit history** always forks; it never rewrites descendants.
- **Return to live** discards the isolated preview and materializes the current
  followed head.

Following does not grant edit authority. A player can return to any available
timeline later without deleting their personal fork.

## Edit outcomes

Every completed durable gesture creates an immutable child and displays:

> New timeline! 🕘

Secondary text explains the outcome:

- `Advanced Group timeline`
- `Forked from Group timeline`
- `Created your timeline because Group timeline is read-only`
- `Created a branch from 14:32`

The notification appears only after the history node is committed successfully.
One gesture produces exactly one notification. It uses a polite live region,
does not depend on animation, and respects reduced-motion preferences.

A future clock animation may briefly show movement from the parent into the new
child. The first implementation only needs the emoji and a small transition.

## Retention semantics

P2P deletion is local unpinning:

```text
follow                 retain ancestry and future accepted heads
keep-through(frontier) retain ancestry through this point, not descendants
none                   make no retention promise for this timeline
```

The user-facing action should be:

> Stop storing after this point

with an explanation:

> Other players may still keep and share this history.

After a grace period, the local client may collect descendant blocks only when
they are not reachable from another local timeline, bookmark, preview, pending
edit, or retention rule.

## Signed retention declarations

```js
{
  timelineId,
  playerId,
  mode: "follow" | "keep-through" | "none",
  frontier,
  revision,
  signature
}
```

The latest valid revision from each recognized player describes intent, not
proof of storage.

Short-lived availability announcements separately describe what an online peer
can currently serve. Retention and availability must never be conflated.

## Dimming

For a recognized roster of `n` players and `r` retainers:

```text
visual strength = r / n
```

With four players, each withdrawal dims the timeline treatment by 25 percentage
points: `4/4`, `3/4`, `2/4`, `1/4`, then an outlined `0/4` state.

Do not reduce essential text below accessible contrast. Dim the timeline rail,
thumbnail, clock, or decorative background and show explicit status:

> 3/4 copies pledged · 2 sources online

Unknown or stale declarations are shown as unknown, not silently treated as
withdrawals. The denominator must use recognized player keys rather than raw
swarm connections, otherwise Sybil identities can manipulate the display.

## Edge cases

- Unauthorized edits automatically become personal forks.
- Controller offline: followers can view, retain, serve, and fork, but cannot
  advance the protected name without delegated authority.
- Two edits from one parent remain sibling branches.
- Conflicting valid head declarations are visible controller conflict.
- Last retainer withdrawing receives a loss-risk warning but may proceed.
- Known metadata with unavailable blocks remains visible as unavailable.
- Re-pinning downloads missing blocks from a source when one exists.
- Switching timelines during sync completes or cancels temporary import before
  changing the visible world.
- Restart preserves identity, locally retained timelines, policies, heads,
  bookmarks, and retention declarations.

## Acceptance criteria

- Two independent browsers follow the same timeline and advance together.
- A player bounces, edits independently, and leaves the group head unchanged.
- The player can later return to the group while retaining the personal branch.
- Editing a historical point always forks.
- Unauthorized work is preserved without advancing the protected head.
- Each durable gesture produces exactly one accessible notification.
- One withdrawal among `n` recognized players changes visual strength by
  exactly one `1/n` step.
- Unpinning one peer never deletes another peer's blocks.
- Retention status and online sources are displayed independently.
