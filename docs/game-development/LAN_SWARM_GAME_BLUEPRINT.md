# LAN Swarm Game Blueprint

## 1. Game Promise

A tense asymmetric strategy duel played across two gaming PCs on a local network. The Swarm spreads hidden Presence through a fictional graph of connected devices. The Warden reads imperfect signals, contains outbreaks, and keeps critical services alive.

Each match should create a legible story: an unnoticed Seed, a costly isolation, a decoy that drew attention away from a Vault, then a final coordinated push or recovery. The excitement comes from prediction, limited resources, and asymmetric information, never technical knowledge.

## 2. Non-Negotiable Safety Boundary

This is a closed simulation. Every target is a fictional in-match `SimEntityId` registered by the authority. The game cannot name, inspect, or affect anything outside that registry.

Models and adapters use local IPC only. They have no network, shell, subprocess, browser, discovery, plugin, real-address, arbitrary-tool, radio, serial, or real-device-enumeration capability. Clients submit only typed, allowlisted game intents. They cannot alter state directly. Content packs define data, art, and deterministic rules, not executable behavior.

Containment passes only when a complete recorded match proves that GameLink was the sole cross-host connection, every client and model output resolved through the typed simulation API, and monitoring and tests found no unapproved socket, subprocess, or device enumeration.

## 3. Player Roles and Fantasy

**Swarm:** Build concealed Presence, create misleading signals, exploit routes, and coordinate pressure before the Warden understands the pattern. The Swarm should feel fast, distributed, and opportunistic.

**Warden:** Interpret uncertainty, protect important services, and decide when disruption is worth containment. The Warden should feel like an incident commander using a tactical console, not a technician.

The Swarm knows its Presence but not hidden defenses. The Warden knows the public topology but sees Presence only through alerts and investigation. Both see round timing, service condition, Crisis, and Threat Level.

## 4. Match Structure and Victory

V1 uses a fixed eight-round clock, targets 18 to 22 minutes, and begins with 12 devices across three zones.

Each round follows the same rhythm:

1. Refresh five Swarm Command and six Warden Operations.
2. Raise Threat Level on rounds 3, 5, and 7.
3. Commit Swarm actions and allocate Warden Operations.
4. Resolve actions in a fixed deterministic order.
5. Let the Warden respond using the remaining allocation.
6. Update Service Impact and Crisis, then check victory.

A device becomes Overrun when Presence equals or exceeds Stability. The Swarm wins immediately at Crisis 8. Otherwise, the Warden wins after round eight. Crisis gain is capped at three per round to preserve comeback opportunities.

## 5. Map, Device Families, and Information Model

The topology, zones, families, Stability, objectives, and links are public. Hidden state includes Presence, Hardening, deceptive effects, and queued actions.

| Family | Strategic purpose |
|---|---|
| Gate | Controls zone access and initial entry eligibility |
| Relay | Extends movement and influence |
| Beacon | Improves alert certainty |
| Vault | Holds primary or secondary objectives |
| Forge | Generates charge or resources |
| Anchor | Stabilizes nearby devices |
| Mirror | Creates decoys and uncertain readings |
| Junction | Changes route geometry |

Every map element must communicate four separate facts: ownership, condition, current activity, and information certainty. Color can reinforce these facts but cannot carry them alone. Aging or uncertain intelligence must look visibly different from verified current information.

## 6. Actions, Resources, and Deterministic Resolution

| Swarm action | Purpose |
|---|---|
| Survey | Reveal a defensive-readiness band with minor Signal |
| Seed | Add hidden Presence at an eligible Gate or beside existing Presence |
| Drift | Move Presence across one open link |
| Bloom | Concentrate Presence and create substantial Signal |
| Veil | Create a false alert without adding Presence |
| Chorus | Coordinate highly visible pressure across occupied devices in one zone |

| Warden action | Purpose |
|---|---|
| Observe | Reveal Presence or improve confidence across a zone |
| Verify | Determine whether an alert is Presence or a Veil |
| Isolate | Close a device or link while increasing Service Impact |
| Patch | Add Hardening and effective Stability |
| Recover | Remove Presence from a verified or isolated target at temporary service cost |
| Restore | Return isolated or recovering service, potentially reopening routes |

The Warden allocates Operations among Watch, Response, and Continuity, with one chip reassignable after alerts. Overclock is a late-match Swarm ability granting two temporary Command while making resulting actions maximally visible. Emergency Continuity becomes available at Crisis 5, removes two Crisis, grants two Continuity, and permanently reduces later Operations by one.

Public labels map one-to-one onto internal typed actions. The authority alone checks legality, cost, order, hidden state, seeded outcomes, scoring, and victory. Exact resource and Stability values remain playtest hypotheses.

## 7. Two-PC LAN Architecture

PC A runs the sole simulation authority, deterministic reducers, replay writer, filtered projections, and isolated local Swarm model. PC B runs the Warden client and visualization.

Models and adapters communicate with the authority through local IPC only. The preconfigured, authenticated GameLink is the only component permitted to cross hosts. PC B submits Warden intents and receives only its role-appropriate projection. Neither machine elects a replacement authority.

The state path is simple: receive intent, validate it, resolve it, append the resulting event, calculate the state hash, then publish filtered updates. V1 does not need an external broker or active-active services.

## 8. Local Model Integration and Authority Limits

The Swarm model receives a compact fictional observation and proposes one schema-valid action with an allowed target and bounded parameters. It never owns hidden truth, randomness, scoring, or state mutation.

The model runtime and adapter have no network, shell, subprocess, browser, discovery, plugin, real-address, arbitrary-tool, radio, serial, or real-device-enumeration capability. Their sole communication path is constrained local IPC.

Inference runs outside the simulation tick and has a 2.5-second deadline. Invalid, malformed, or late output becomes `HOLD`. A model failure therefore costs tempo but cannot corrupt a match.

The slice requires one quantized 7B to 9B Swarm model on PC A. A future Warden model on PC B may offer advice, but the human confirms every action. Replays use accepted intents and never rerun inference.

## 9. User Interface and Accessibility

The main screen has four stable regions:

- Center: zoomable graph grouped by zone.
- Top: objective, round, Crisis, Service Impact, Threat Level, and role resource.
- Side: selected-device explanation, legal actions, cost, and expected consequence.
- Bottom: event chronicle and active countdowns.

Critical alerts persist and use text, shape, sound, and map emphasis. Tactical alerts consolidate into incidents. Alerts never steal selection.

The vertical slice supports mouse and keyboard. V1 adds remapping, scalable text, high-contrast presets, non-color state patterns, reduced motion, captioned audio, clear focus outlines, and complete keyboard navigation. Controller support follows V1.

## 10. Replay, Saves, and Observability

Every accepted intent and deterministic result enters an append-only event journal. Checkpoints record canonical state and hashes. Playback verifies the chain and must reach the original final hash without model inference.

A save package includes a manifest, event journal, checkpoints, model-decision metadata, metrics, and final verification record. Raw model text is unnecessary by default.

Track simulation timing, peer-link latency, accepted and rejected intents, `HOLD` fallbacks, model timing, checkpoint performance, reconnects, hash mismatches, cross-host connections, socket creation, subprocess attempts, and device-enumeration attempts. The match-end screen must identify the decisive Crisis sources and turning points.

## 11. Locked Vertical Slice

Build one complete Crown Hold match before expanding content:

- Fixed 10-device map across three zones.
- Gate, Relay, Beacon, and Vault only.
- Six rounds lasting 12 to 15 minutes.
- Swarm actions: Survey, Seed, Drift, Bloom.
- Warden actions: Observe, Isolate, Patch, Recover.
- Local Swarm model on PC A; human Warden on PC B.
- Basic graph, objective bar, resources, inspector, certainty cues, alerts, and chronicle.
- Typed intents, `HOLD`, checkpoints, replay, and final-state explanation.

The slice passes when the PC A model-controlled Swarm and PC B human Warden join and complete a match without a facilitator, at least one valid model intent is accepted, at least one malformed or late model output resolves deterministically to `HOLD`, the replay reaches the same final hash, and both players can explain why the winner won.

## 12. Milestone Roadmap

| Stage | Scope | Exit gate |
|---|---|---|
| Paper prototype | Core graph, hidden tokens, four families, short facilitated matches | Players identify objectives and predict immediate effects |
| Vertical slice | Locked two-PC Crown Hold build | Complete, explainable, hash-identical model-versus-human match |
| Alpha | Eight-round structure, all actions and families, tutorials, several maps | Stable first-session comprehension and 40% to 60% role balance |
| V1 | Refined content, replay viewer, accessibility presets, progression | 45% to 55% balance and strong rematch interest |
| Post-V1 | Controller, spectators, replay branching, cooperative and team modes | Each feature proves demand without weakening the duel |

## 13. Playtest and Balance Gates

Require these gates before V1:

- At least 80% identify objective, ownership, and contested state within five seconds.
- At least 70% predict an action’s immediate result.
- At least 80% explain why the match ended.
- Critical events are noticed within three seconds.
- Matched role win rate stays between 45% and 55%.
- At least 50% request a rematch; 25% open replay after a close loss.
- Every acceptance run includes one accepted valid model intent.
- Every acceptance run proves a malformed or late model output becomes deterministic `HOLD`.
- Recorded matches replay to the same final hash.
- GameLink is the only cross-host connection.
- Every model and client output resolves through the typed simulation API.
- Monitoring and tests report no unapproved socket, subprocess, or device enumeration.
- No information depends only on color, sound, motion, or hover.

## 14. Technical and Product Risks

The largest product risks are opaque hidden information, alert overload, runaway Swarm momentum, overly attractive isolation, and matches decided before players recognize the turning point. Address them through certainty cues, incident consolidation, capped Crisis gain, visible Service Impact, and post-match explanations.

Technical risks include model latency, renderer contention, disconnect handling, replay-version compatibility, and platform-specific isolation. Benchmark representative hardware early. Preserve deterministic `HOLD`, pause safely on authority loss, and pin replays to engine and content versions.

Assumption: both PCs provide roughly eight physical CPU cores, 32 GB RAM, and 12 GB graphics memory. Final engine, operating systems, schema, and transport remain implementation choices.

## 15. Build Checklist

- [ ] Implement canonical state, seeded resolution, and victory rules.
- [ ] Define generated schemas for intents, events, projections, and saves.
- [ ] Build the 10-device Crown Hold content pack.
- [ ] Implement the eight vertical-slice actions.
- [ ] Connect the Swarm model and adapter through constrained local IPC.
- [ ] Remove network, shell, subprocess, browser, discovery, plugin, real-address, arbitrary-tool, radio, serial, and real-device-enumeration capabilities from model processes.
- [ ] Restrict cross-host communication to the authenticated GameLink.
- [ ] Build the Warden graph, inspector, alerts, and chronicle.
- [ ] Add checkpoints, hash verification, replay, and result explanation.
- [ ] Complete two-PC join, reconnect, pause, and match-end flows.
- [ ] Accept one valid model intent in the end-to-end slice test.
- [ ] Prove one malformed or late model output becomes deterministic `HOLD`.
- [ ] Verify replay reaches the original final hash.
- [ ] Monitor a complete match for unapproved sockets, subprocesses, and device enumeration.
- [ ] Run comprehension, safety, latency, determinism, and balance gates.
- [ ] Expand to V1 only after the slice gates pass.
- [ ] Keep controller, team modes, spectators, and replay branching post-V1.
