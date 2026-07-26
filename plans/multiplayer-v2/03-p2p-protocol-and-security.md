# P2P protocol and security

## Trust model

- Trackers and relays only introduce or carry traffic.
- WebRTC connection role does not confer timeline authority.
- Peer identity is a persistent signing key, separate from tracker peer IDs.
- Timeline controller keys and signed capabilities authorize head advancement.
- Anyone with available history may view, retain, serve, and fork it.
- Received Loro bytes are untrusted until their envelope, ancestry, authority,
  and resulting document pass validation.

## Initial wire state machine

Use one reliable ordered channel:

```text
CONNECTING
  → AUTHENTICATING
  → SYNCING_BASELINE
  → MATERIALIZING
  → READY
  → RESYNCING or CLOSED
```

Initial message families:

```text
HELLO / AUTH_PROOF
SYNC_REQUEST
DOC_SNAPSHOT
DOC_UPDATE
DOC_ACK
HEAD_UPDATE
COMMAND_REQUEST
COMMAND_RESULT
PING / PONG
ERROR
```

`Connected` or `Ready` is shown only after the receiver imports, validates,
materializes, fingerprints, persists, and acknowledges the selected frontier.

## Bootstrap barrier

1. Receiver requests a timeline/head and optionally supplies a compatible
   version vector.
2. Sender captures baseline version `V0`.
3. Sender transmits a full snapshot or update from the receiver's version.
4. Receiver imports into a temporary document and validates it.
5. Receiver atomically materializes the selected head and sends `DOC_ACK(V0)`.
6. Sender transmits changes from `V0` to current.
7. Both sides enter `READY` only after acknowledgements converge.

Edits made during bootstrap therefore cannot race ahead of the baseline.
Duplicate Loro imports are harmless; acknowledgements remain necessary because
transport delivery does not prove application or rendering success.

## Flow control

- Check every send result.
- Maintain a bounded reliable queue.
- Use buffered-amount notifications to resume.
- Coalesce small updates briefly, but preserve gesture transaction boundaries.
- Disconnect or require resynchronization when a peer cannot keep up; never
  silently discard durable state.
- Keep payload, chunk, assembly, dependency, and timeout limits.

The current fragmented-message implementation must first replace sparse-array
completion checks with an explicit received-chunk count or bitmap.

## Identity and signed history

The target design uses persistent Ed25519 player identities. Each signed history
envelope binds:

- Timeline/project identity.
- Parent and result.
- Loro update hash.
- Author identity.
- Policy epoch/capability.
- Simulation tick/checkpoint reference.
- Nonce.

Timeline policies form an append-only signed chain:

```text
controller key(s)
authorized editor capabilities
revocations
policy epoch
previous policy hash
controller signature
```

The first implementation should use one controller per timeline. Delegation and
threshold control can be added without changing immutable history.

## Authorization semantics

Authorization controls only whether a block advances a named timeline.

- Valid authorized edit at the followed live head: create a child and advance
  the signed head.
- Valid edit from history: create a new timeline.
- Valid but unauthorized edit: preserve it as the editor's fork.
- Invalid or malicious update: reject it; do not preserve it as history.
- Revocation is prospective. Previously accepted blocks remain valid.
- Offline work based on stale authority survives as a fork when it can no longer
  advance the protected timeline.

Two children of the same parent are explicit branches. Arrival order must not
silently discard either. Conflicting controller-signed heads are detectable
equivocation and must be displayed as a split.

## Serving and discovery

Any retaining peer may serve immutable blocks. Serving grants no edit authority.
A late joiner may bootstrap from a non-controller peer after verifying hashes,
signatures, ancestry, and the selected signed head.

Invites should identify a timeline rather than only a transient room:

- Timeline ID.
- Controller fingerprint.
- Trusted genesis/policy/head reference.
- Discovery endpoints.
- Optional historical node.
- Verified TURN material only when explicitly included under existing network
  safety rules.

Secrets and credentials remain in URL fragments and must never enter logs or
diagnostic artifacts.

## Threat boundaries

The design should resist:

- Tracker peer injection and controller impersonation.
- Tampered or replayed updates.
- Unauthorized head advancement.
- Oversized or dependency-amplifying Loro data.
- Silent resolution of controller equivocation.
- Partial baseline activation.
- Resource exhaustion through pending branches, assemblies, or peers.

It cannot guarantee:

- Global deletion of shared data.
- Availability with no willing retainer.
- A single global head during a network partition.
- Prevention of forking already disclosed history.
- Recovery from a stolen controller key without a defined rotation/recovery
  policy.
